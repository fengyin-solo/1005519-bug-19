import {
  CLEANROOM_KEY,
  buildCleanroomRow,
  todayText,
  validateCleanroomTransition,
  validateDraft,
  validateReadingsPatch,
  type CleanroomReadings,
} from '@/data/cleanroom'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']
// 终态语义本身即异常的状态。
const ABNORMAL_STATUSES = ['超标预警', '不合格', '验证失败', '已失效', '已升级']

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

/** 详情面板与列表读同一份存储，避免面板/明细各读一份造成状态对不上。 */
export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function resolveAbnormal(action: string, target: string): boolean {
  if (ABNORMAL_STATUSES.includes(target)) {
    return true
  }
  return NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
}

/** 通用次序校验：只允许沿状态表向前流转，倒序与重复流转都拒收。 */
function validateOrderedTransition(meta: ModuleMeta, current: string, target: string): string | null {
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex < 0 || targetIndex < 0) {
    return null // 历史未知状态不拦，兼容既有记录
  }
  if (targetIndex <= currentIndex) {
    return `${meta.entity}当前为「${current}」，状态只能按既定次序向前流转，不能回退或重复流转到「${target}」`
  }
  return null
}

/**
 * 标记超标时同步记一条变更控制台账。
 * 台账条目带确定编号 CHAN-ENV-{监测记录id}，重复标记同一监测记录不会新增第二条，
 * 从台账侧也保证“这个点位重复标记只算一次”。
 */
function appendExceedanceLedger(monitor: EntryRow, readings: CleanroomReadings): boolean {
  const changeRows = [...listRows('changecontrol')]
  const changeNo = `CHAN-ENV-${monitor.id}`
  if (changeRows.some((row) => row['变更编号'] === changeNo)) {
    return false
  }
  const point = String(monitor['监测点位'] ?? '')
  const particle =
    readings.悬浮粒子数 !== undefined && readings.悬浮粒子数.trim() !== ''
      ? Number(readings.悬浮粒子数)
      : monitor['悬浮粒子数'] ?? ''
  const bacteria =
    readings.沉降菌数 !== undefined && readings.沉降菌数.trim() !== ''
      ? Number(readings.沉降菌数)
      : monitor['沉降菌数'] ?? ''
  const row: EntryRow = {
    id: nextId(changeRows),
    status: '待评估',
    pending: true,
    abnormal: true,
    变更编号: changeNo,
    变更类别: '洁净区超标预警',
    涉及工序: '洁净区环境监测',
    变更内容: `监测点位「${point}」环境监测标记超标，悬浮粒子数 ${particle}、沉降菌数 ${bacteria}，需评估并采取纠正预防措施`,
    风险评估: '待评估',
    审批人: '',
    生效日期: todayText(),
    变更状态: '待评估',
  }
  saveRows('changecontrol', [...changeRows, row])
  return true
}

/**
 * 状态动作。洁净区模块的关键点：
 * - 悬浮粒子数/沉降菌数与状态在同一笔事务里写进同一条记录，不产生残留明细；
 * - 状态只按既有次序向前流转，倒序、跳序、重复标记一律拒收；
 * - 标记超标幂等，并同步（幂等）追加变更控制台账。
 */
export function runAction(
  key: string,
  id: number,
  action: string,
  readings: CleanroomReadings = {},
): ActionResult {
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
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 洁净区使用带分支的严格次序（待监测→监测中→已达标/超标预警）。
  const orderError =
    key === CLEANROOM_KEY
      ? validateCleanroomTransition(current, target)
      : validateOrderedTransition(meta, current, target)
  if (orderError) {
    return { ok: false, message: orderError }
  }

  // 实测读数先校验后落库：悬浮粒子数越界按无效值拒收，状态也不允许改动。
  if (key === CLEANROOM_KEY) {
    const readingError = validateReadingsPatch(readings)
    if (readingError) {
      return { ok: false, message: readingError }
    }
  }

  const targetIndex = meta.statuses.indexOf(target)
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: targetIndex >= 0 ? targetIndex < 2 : rows[index].pending,
    abnormal: resolveAbnormal(action, target),
  }

  if (key === CLEANROOM_KEY) {
    if (readings.悬浮粒子数 !== undefined && readings.悬浮粒子数.trim() !== '') {
      updated['悬浮粒子数'] = Number(readings.悬浮粒子数)
    }
    if (readings.沉降菌数 !== undefined && readings.沉降菌数.trim() !== '') {
      updated['沉降菌数'] = Number(readings.沉降菌数)
    }
    updated['监测状态'] = target
  }

  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  let appended = false
  if (key === CLEANROOM_KEY && target === '超标预警') {
    appended = appendExceedanceLedger(updated, readings)
  }

  const suffix = appended ? '，并已同步登记到变更控制台账' : ''
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${suffix}` }
}

/**
 * 登记一条完整记录。目前落地了洁净区模块：
 * 悬浮粒子数、沉降菌数等字段一次校验、一次写全，避免明细字段缺失。
 */
export function createEntry(key: string, draft: unknown): ActionResult & { id?: number } {
  const meta = moduleMeta(key)
  if (key !== CLEANROOM_KEY) {
    return { ok: false, message: `${meta.entity}登记入口尚未接入审批流` }
  }
  const data = draft as Parameters<typeof validateDraft>[0]
  const error = validateDraft(data)
  if (error) {
    return { ok: false, message: error }
  }
  const rows = listRows(key)
  const id = nextId(rows)
  const row = buildCleanroomRow(id, data)
  saveRows(key, [...rows, row])
  return { ok: true, message: `环境监测记录已登记，编号 ${id}，当前状态「待监测」`, id }
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
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
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
