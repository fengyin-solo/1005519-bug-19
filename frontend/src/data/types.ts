/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 每个动作只允许从哪些当前状态发起：缺省则沿用通用的「非目标态即可」老规则。
  actionSources?: Record<string, string[]>
  // 业务台账里与流转状态保持一致的状态字段，每次写库一起更新，避免状态两份对不上。
  statusField?: string
  // 看板统计：哪些状态算待处理、哪些状态算异常；缺省沿用通用算法。
  pendingStatuses?: string[]
  abnormalStatuses?: string[]
  // 合法状态流转后，需要把动作追加到哪个业务台账（如超标标记落入变更控制）。
  ledgerKey?: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  // 新增/命中记录时带回编号，页面可以据此打开详情。
  id?: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
