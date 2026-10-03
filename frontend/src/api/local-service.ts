import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

// 业务台账上以「状态」结尾的字段，与流转状态保持同值，一次写全。
function applyStatusFields(row: EntryRow, meta: ModuleMeta, status: string): EntryRow {
  const statusFields = meta.statusField
    ? [meta.statusField]
    : meta.fields.filter((field) => field.endsWith('状态') && field !== meta.statusField)
  if (statusFields.length === 0) {
    return row
  }
  const mirrored: EntryRow = { ...row }
  for (const field of statusFields) {
    mirrored[field] = status
  }
  return mirrored
}

function isPending(meta: ModuleMeta, status: string): boolean {
  if (meta.pendingStatuses) {
    return meta.pendingStatuses.includes(status)
  }
  return status !== meta.statuses[meta.statuses.length - 1]
}

function isAbnormal(meta: ModuleMeta, status: string, action: string): boolean {
  if (meta.abnormalStatuses) {
    return meta.abnormalStatuses.includes(status)
  }
  return NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 追加一条台账记录，编号沿用该台账既有前缀自增，不覆盖任何历史行。
function appendLedgerEntry(targetKey: string, fields: EntryRow): number {
  const rows = listRows(targetKey)
  const id = nextId(rows)
  const row: EntryRow = { ...fields, id }
  saveRows(targetKey, [...rows, row])
  return id
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

// 洁净区环境监测的每次合法流转，都在变更控制台账里留痕，编号沿用 CHAN-XXXX。
function writeCleanroomLedger(meta: ModuleMeta, row: EntryRow, action: string, target: string): void {
  if (meta.ledgerKey !== 'changecontrol' || meta.key !== 'cleanroom') {
    return
  }
  const rows = listRows('changecontrol')
  let serial = rows.length
  serial = rows.reduce((max, ledgerRow) => {
    const code = String(ledgerRow['变更编号'] ?? '')
    const matched = /^CHAN-(\d+)$/.exec(code)
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0) + 1
  const point = String(row['监测点位'] ?? row.id)
  const particle = String(row['悬浮粒子数'] ?? '').trim()
  const settle = String(row['沉降菌数'] ?? '').trim()
  const readings = particle === '' && settle === ''
    ? '实测数据待录入'
    : `悬浮粒子数 ${particle || '—'} 粒/m³，沉降菌数 ${settle || '—'} 个/皿`
  const ledgerRow = {
    id: -1,
    status: '待评估',
    pending: true,
    abnormal: false,
    变更编号: `CHAN-${String(serial).padStart(4, '0')}`,
    变更类别: '环境监测',
    涉及工序: point,
    变更内容: `环境监测记录 #${row.id}（${point}）执行「${action}」，状态流转为「${target}」；${readings}`,
    风险评估: target === '超标预警' ? '监测结果超标，需评估纠偏与再监测措施' : '常规状态流转，待质量部门评估',
    审批人: '系统自动登记',
    生效日期: todayText(),
    变更状态: '待评估',
  } satisfies EntryRow
  appendLedgerEntry('changecontrol', ledgerRow)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)

  // 状态按老次序流转：登记了 actionSources 的模块只允许从指定状态向前走，倒序、跳步一律拒收。
  const sources = meta.actionSources?.[action]
  if (sources) {
    if (current === target) {
      // 同一点位重复标记只算一次：不流转、不重复落台账。
      return { ok: false, message: `${meta.entity}已经是「${target}」，该点位已标记过，无需重复操作` }
    }
    if (!sources.includes(current)) {
      return {
        ok: false,
        message: `状态只能按 ${meta.statuses.join(' → ')} 的次序向前流转，当前「${current}」不能执行「${action}」`,
      }
    }
  } else if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 状态字段与业务状态字段一次写全，列表和详情读到的都是同一条记录。
  const withStatus = applyStatusFields(rows[index], meta, target)
  const updated: EntryRow = {
    ...withStatus,
    status: target,
    pending: isPending(meta, target),
    abnormal: isAbnormal(meta, target, action),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  writeCleanroomLedger(meta, updated, action, target)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」`, id }
}

// 通用新增：一次写全全部字段，状态从首个状态起步。
export function createEntry(
  key: string,
  values: Record<string, string>,
): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const id = nextId(rows)
  const initial = meta.statuses[0]
  const row: EntryRow = { id, status: initial, pending: isPending(meta, initial), abnormal: false }
  for (const field of meta.fields) {
    row[field] = values[field] ?? ''
  }
  const withStatus = applyStatusFields(row, meta, initial)
  saveRows(key, [...rows, withStatus])
  return { ok: true, message: `${meta.entity}已登记，编号 ${id}`, id }
}

// 通用局部更新：落在同一条记录上，不新增明细；状态字段始终与流转状态对齐。
export function patchEntry(
  key: string,
  id: number,
  values: Record<string, string | number>,
): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current: EntryRow = { ...rows[index], ...values }
  const aligned = applyStatusFields(current, meta, String(current.status))
  const next = [...rows]
  next[index] = aligned
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已保存`, id }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => isPending(meta, String(row.status))).length,
      abnormal: entries.filter((row) =>
        meta.abnormalStatuses
          ? meta.abnormalStatuses.includes(String(row.status))
          : row.abnormal,
      ).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
