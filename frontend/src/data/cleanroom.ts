import type { EntryRow } from './types'

// 洁净区环境监测的领域规则集中放这里：
// 列表、实测面板、登记表单、变更台账共用同一份取值与校验口径，
// 避免“页面显示一套、落库另一套”。

export const CLEANROOM_KEY = 'cleanroom'

// ISO 14644-1 各级别悬浮粒子（≥0.5μm，个/m³）的常规量级远低于该上限，
// 超出该范围视为录入无效值直接拒收；负数、非数字同样无效。
export const PARTICLE_LIMIT = 100_000_000
// 沉降菌按培养皿计数（CFU/皿），超过该范围按无效值处理。
export const SETTLE_BACTERIA_LIMIT = 1_000

// 允许的洁净级别仅作录入建议；历史记录里的新旧级别（旧版十万级/三十万级等）
// 不做迁移、不做改写，原样保留、原样展示。
export const CLEANLINESS_LEVELS = ['A级', 'B级', 'C级', 'D级']

export type CleanroomDraft = {
  监测点位: string
  洁净级别: string
  悬浮粒子数: string
  沉降菌数: string
  温度读数?: string
  相对湿度?: string
  监测日期?: string
}

// 登记时必须一次写全的字段：点位、级别、悬浮粒子数、沉降菌数、监测日期。
export const REQUIRED_FIELDS: (keyof CleanroomDraft)[] = [
  '监测点位',
  '洁净级别',
  '悬浮粒子数',
  '沉降菌数',
  '监测日期',
]

function parseCount(raw: string): number {
  const value = Number(raw)
  return Number.isFinite(value) ? value : NaN
}

/** 校验悬浮粒子数：非负整数且不超量程，越界按无效值拒收。 */
export function validateParticleCount(raw: string): string | null {
  const value = parseCount(raw)
  if (!Number.isFinite(value)) {
    return '悬浮粒子数必须是数字'
  }
  if (!Number.isInteger(value) || value < 0) {
    return '悬浮粒子数必须是非负整数'
  }
  if (value > PARTICLE_LIMIT) {
    return `悬浮粒子数超出允许范围（0～${PARTICLE_LIMIT.toLocaleString('en-US')} 个/m³），按无效值处理`
  }
  return null
}

/** 校验沉降菌数：非负整数且不超量程。 */
export function validateSettleBacteria(raw: string): string | null {
  const value = parseCount(raw)
  if (!Number.isFinite(value)) {
    return '沉降菌数必须是数字'
  }
  if (!Number.isInteger(value) || value < 0) {
    return '沉降菌数必须是非负整数'
  }
  if (value > SETTLE_BACTERIA_LIMIT) {
    return `沉降菌数超出允许范围（0～${SETTLE_BACTERIA_LIMIT.toLocaleString('en-US')} CFU/皿），按无效值处理`
  }
  return null
}

function validateOptionalNumber(raw: string | undefined, label: string): string | null {
  if (raw === undefined || raw.trim() === '') {
    return null
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    return `${label}必须是数字`
  }
  return null
}

/** 登记校验：必填项齐全，计量字段合法。通过后才允许落库，保证一次写全。 */
export function validateDraft(draft: CleanroomDraft): string | null {
  for (const field of REQUIRED_FIELDS) {
    if (!String(draft[field] ?? '').trim()) {
      return `请填写${field}`
    }
  }
  return (
    validateParticleCount(draft.悬浮粒子数) ??
    validateSettleBacteria(draft.沉降菌数) ??
    validateOptionalNumber(draft.温度读数, '温度读数') ??
    validateOptionalNumber(draft.相对湿度, '相对湿度')
  )
}

/**
 * 校验实测面板提交的部分读数。只校验本次实际填写的字段：
 * 悬浮粒子数多处共用本规则，越界一律按无效值拒收。
 */
export function validateReadingsPatch(patch: Partial<CleanroomDraft>): string | null {
  if (patch.悬浮粒子数 !== undefined && patch.悬浮粒子数.trim() !== '') {
    const error = validateParticleCount(patch.悬浮粒子数)
    if (error) {
      return error
    }
  }
  if (patch.沉降菌数 !== undefined && patch.沉降菌数.trim() !== '') {
    const error = validateSettleBacteria(patch.沉降菌数)
    if (error) {
      return error
    }
  }
  return null
}

export type CleanroomReadings = Partial<Pick<CleanroomDraft, '悬浮粒子数' | '沉降菌数'>>

// 状态按既有次序流转：待监测 → 监测中 →（已达标 | 超标预警）；
// 已达标若复测确认超标，允许改判到超标预警（仍是向前流转）。
// 倒序一律拒收，跳序（如待监测直接判定达标）同样拒收。
const CLEANROOM_TRANSITIONS: Record<string, string[]> = {
  待监测: ['监测中'],
  监测中: ['已达标', '超标预警'],
  已达标: ['超标预警'],
  超标预警: [],
}

/** 返回 null 表示流转合法；否则返回拒收原因。历史未知状态不拦，兼容既有记录。 */
export function validateCleanroomTransition(current: string, target: string): string | null {
  if (!CLEANROOM_TRANSITIONS[current]) {
    return null
  }
  if (!CLEANROOM_TRANSITIONS[current].includes(target)) {
    return `环境监测记录当前为「${current}」，不能直接流转到「${target}」，请按「待监测 → 监测中 → 已达标/超标预警」的次序操作`
  }
  return null
}

export function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 依据登记草稿构造一条完整记录，悬浮粒子数与沉降菌数落在同一条上。 */
export function buildCleanroomRow(id: number, draft: CleanroomDraft): EntryRow {
  const status = '待监测'
  return {
    id,
    status,
    pending: true,
    abnormal: false,
    监测点位: draft.监测点位.trim(),
    洁净级别: draft.洁净级别.trim(),
    悬浮粒子数: Number(draft.悬浮粒子数),
    沉降菌数: Number(draft.沉降菌数),
    温度读数: draft.温度读数?.trim() ? Number(draft.温度读数) : '',
    相对湿度: draft.相对湿度?.trim() ? Number(draft.相对湿度) : '',
    监测日期: draft.监测日期 ?? todayText(),
    监测状态: status,
  }
}
