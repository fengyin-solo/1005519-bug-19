import {
  createEntry,
  getEntry,
  listEntries,
  patchEntry,
  runAction,
} from '@/api/local-service'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

const MODULE_KEY = 'cleanroom'

// 悬浮粒子数按 GMP/ISO 洁净区限值口径取一个稳妥的物理上限（粒/m³）：
// 超出 0 ~ 10,000,000 或不是非负整数的，一律按无效值处理，拒绝落库。
export const PARTICLE_MIN = 0
export const PARTICLE_MAX = 10_000_000
export const PARTICLE_UNIT = '粒/m³'

const INTEGER_PATTERN = /^\d+$/

// 沉降菌数以个/皿计，只接受非负整数。
function parseCount(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const text = String(raw ?? '').trim()
  if (!INTEGER_PATTERN.test(text)) {
    return { ok: false, message: '请输入非负整数' }
  }
  return { ok: true, value: Number(text) }
}

export function particleError(raw: string): string {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return '悬浮粒子数不能为空'
  }
  const parsed = parseCount(text)
  if (!parsed.ok) {
    return `悬浮粒子数无效：${parsed.message}`
  }
  if (parsed.value < PARTICLE_MIN || parsed.value > PARTICLE_MAX) {
    return `悬浮粒子数超出有效范围（${PARTICLE_MIN}~${PARTICLE_MAX.toLocaleString()} ${PARTICLE_UNIT}），按无效值处理`
  }
  return ''
}

function settleError(raw: string): string {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return '沉降菌数不能为空'
  }
  const parsed = parseCount(text)
  if (!parsed.ok) {
    return `沉降菌数无效：${parsed.message}`
  }
  return ''
}

export type CleanroomDraft = {
  监测点位: string
  洁净级别: string
  悬浮粒子数: string
  沉降菌数: string
  温度读数: string
  相对湿度: string
  监测日期: string
}

export function emptyDraft(): CleanroomDraft {
  return {
    监测点位: '',
    洁净级别: '',
    悬浮粒子数: '',
    沉降菌数: '',
    温度读数: '',
    相对湿度: '',
    监测日期: new Date().toISOString().slice(0, 10),
  }
}

// 登记：字段一次写全；点位必填。历史洁净级别不做任何枚举校验，新旧值原样保留。
export function registerMonitoring(draft: CleanroomDraft): ActionResult {
  const point = draft['监测点位'].trim()
  if (!point) {
    return { ok: false, message: '监测点位不能为空' }
  }
  // 登记阶段粒子数可暂缺；填了就得在有效范围内，超范围按无效值拒收。
  const particleText = draft['悬浮粒子数'].trim()
  if (particleText !== '') {
    const error = particleError(particleText)
    if (error) {
      return { ok: false, message: error }
    }
  }
  const settleText = draft['沉降菌数'].trim()
  if (settleText !== '') {
    const error = settleError(settleText)
    if (error) {
      return { ok: false, message: error }
    }
  }
  const values: Record<string, string> = {
    监测点位: point,
    洁净级别: draft['洁净级别'].trim(),
    悬浮粒子数: particleText,
    沉降菌数: settleText,
    温度读数: draft['温度读数'].trim(),
    相对湿度: draft['相对湿度'].trim(),
    监测日期: draft['监测日期'].trim() || new Date().toISOString().slice(0, 10),
  }
  return createEntry(MODULE_KEY, values)
}

// 悬浮粒子数与沉降菌数写进同一条记录：一次 patch 原子落库，不新增任何明细行。
export function saveMeasurement(
  id: number,
  draft: Pick<CleanroomDraft, '悬浮粒子数' | '沉降菌数' | '温度读数' | '相对湿度'>,
): ActionResult {
  const particleErrorText = particleError(draft['悬浮粒子数'])
  if (particleErrorText) {
    return { ok: false, message: particleErrorText }
  }
  const settleErrorText = settleError(draft['沉降菌数'])
  if (settleErrorText) {
    return { ok: false, message: settleErrorText }
  }
  const existing = getEntry(MODULE_KEY, id)
  if (!existing) {
    return { ok: false, message: `没有找到编号为 ${id} 的环境监测记录` }
  }
  return patchEntry(MODULE_KEY, id, {
    悬浮粒子数: draft['悬浮粒子数'].trim(),
    沉降菌数: draft['沉降菌数'].trim(),
    温度读数: draft['温度读数'].trim(),
    相对湿度: draft['相对湿度'].trim(),
  })
}

// 判定达标 / 标记超标前，必须已有落在有效范围内的实测读数；
// 否则面板上显示的超标没有数据支撑，按无效值拦截。
function ensureReadings(row: EntryRow): string {
  const particleErrorText = particleError(String(row['悬浮粒子数'] ?? ''))
  if (particleErrorText) {
    return particleErrorText
  }
  const settleErrorText = settleError(String(row['沉降菌数'] ?? ''))
  if (settleErrorText) {
    return settleErrorText
  }
  return ''
}

// 页面上所有动作统一走这里：幂等由 runAction 负责（重复标记不产生第二条明细/台账）。
export function runCleanroomAction(action: string, row: EntryRow): ActionResult {
  if (action === '判定达标' || action === '标记超标') {
    const error = ensureReadings(row)
    if (error) {
      return { ok: false, message: error }
    }
  }
  return runAction(MODULE_KEY, Number(row.id), action)
}

export function listCleanroom(filters: Record<string, string> = {}): PageResult {
  return listEntries(MODULE_KEY, filters)
}

export function getCleanroom(id: number): EntryRow | undefined {
  return getEntry(MODULE_KEY, id)
}
