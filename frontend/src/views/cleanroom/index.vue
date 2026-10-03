<template>
  <section class="page" data-module="cleanroom">
    <header class="page-head">
      <div>
        <h2>洁净区环境监测管理</h2>
        <p class="page-desc">维护环境监测记录，围绕监测点位、洁净级别、悬浮粒子数、沉降菌数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记环境监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出洁净区环境监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button v-if="column === '监测点位'" class="link" type="button" @click="openDetail(row.id)">
              {{ row[column] ?? '—' }}
            </button>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="busy"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无洁净区环境监测数据，可先登记环境监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条洁净区环境监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记弹窗：字段一次写全，悬浮粒子数与沉降菌数写进同一条新记录 -->
    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal-card">
        <h3 class="modal-title">登记环境监测记录</h3>
        <div class="form-grid">
          <label v-for="field in editableFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input v-model="draft[field]" :placeholder="field === '悬浮粒子数' ? particleHint : `请输入${field}`" />
          </label>
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" :disabled="busy" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" :disabled="busy" @click="submitCreate">保存登记</button>
        </div>
      </div>
    </div>

    <!-- 详情面板：与列表读同一条监测记录；悬浮粒子数多处共用这一份 -->
    <aside v-if="detailRow" class="detail-drawer">
      <div class="detail-head">
        <h3>监测记录详情 #{{ detailRow.id }}</h3>
        <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
      </div>

      <dl class="detail-list">
        <template v-for="field in detailFields" :key="field">
          <dt>{{ field }}</dt>
          <dd :class="{ 'warn-text': field === '当前状态' && detailRow.status === '超标预警' }">
            {{ field === '当前状态' ? detailRow.status : (detailRow[field] ?? '—') }}
          </dd>
        </template>
      </dl>

      <section class="measure-block">
        <h4>实测录入（悬浮粒子数与沉降菌数一次写全，保存在本记录内）</h4>
        <div class="form-grid">
          <label class="form-item">
            <span>悬浮粒子数（{{ PARTICLE_UNIT }}）</span>
            <input v-model="measure['悬浮粒子数']" :placeholder="particleHint" />
          </label>
          <label class="form-item">
            <span>沉降菌数（个/皿）</span>
            <input v-model="measure['沉降菌数']" placeholder="非负整数" />
          </label>
          <label class="form-item">
            <span>温度读数（℃）</span>
            <input v-model="measure['温度读数']" placeholder="如 22.5" />
          </label>
          <label class="form-item">
            <span>相对湿度（%）</span>
            <input v-model="measure['相对湿度']" placeholder="如 50" />
          </label>
        </div>
        <button class="btn" type="button" :disabled="busy" @click="saveMeasure">保存实测</button>
      </section>

      <section class="detail-actions">
        <h4>状态流转（{{ statuses.join(' → ') }}，倒序拒收）</h4>
        <button
          v-for="action in actions"
          :key="action"
          class="btn"
          type="button"
          :class="{ primary: action === '标记超标' }"
          :disabled="busy || !canRun(action)"
          :title="actionHint(action)"
          @click="runAction(action, detailRow)"
        >
          {{ action }}
        </button>
      </section>

      <p v-if="detailError" class="error-text">{{ detailError }}</p>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  listCleanroom,
  PARTICLE_MAX,
  PARTICLE_MIN,
  PARTICLE_UNIT,
  registerMonitoring,
  runCleanroomAction,
  saveMeasurement,
  getCleanroom,
  emptyDraft,
  type CleanroomDraft,
} from '@/api/cleanroom-service'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cleanroom')
// 悬浮粒子数、沉降菌数与其它字段都从同一条记录读出，列表与详情共用一份。
const columns = ["监测点位", "洁净级别", "悬浮粒子数", "沉降菌数", "温度读数", "相对湿度", "监测日期"]
const detailFields = [...columns, "当前状态"]
const editableFields: (keyof CleanroomDraft)[] = ["监测点位", "洁净级别", "悬浮粒子数", "沉降菌数", "温度读数", "相对湿度", "监测日期"]
const actions = ["提交监测", "判定达标", "标记超标"]
const statuses = ["待监测", "监测中", "已达标", "超标预警"]
const particleHint = `${PARTICLE_MIN}~${PARTICLE_MAX.toLocaleString()}，越界按无效值`

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["监测点位", "洁净级别", "悬浮粒子数"]
const busy = ref(false)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待监测点位', value: countByStatus('待监测') },
  { label: '监测中点位', value: countByStatus('监测中') },
  { label: '超标点位数', value: countByStatus('超标预警') },
])

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

// ---- 登记弹窗 ----
const createOpen = ref(false)
const createError = ref('')
const draft = reactive<CleanroomDraft>(emptyDraft())

function openCreate() {
  Object.assign(draft, emptyDraft())
  createError.value = ''
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function submitCreate() {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    const result = registerMonitoring({ ...draft })
    if (!result.ok) {
      createError.value = result.message
      return
    }
    createOpen.value = false
    reload()
    if (result.id !== undefined) {
      openDetail(result.id)
    }
  } finally {
    busy.value = false
  }
}

// ---- 详情面板：始终从落库的那条监测记录重读，杜绝残留明细 ----
const detailId = ref<number | null>(null)
const detailError = ref('')
const measure = reactive({ 悬浮粒子数: '', 沉降菌数: '', 温度读数: '', 相对湿度: '' })

const detailRow = computed<EntryRow | null>(() =>
  detailId.value === null ? null : getCleanroom(detailId.value) ?? null,
)

function openDetail(id: number) {
  detailId.value = id
  detailError.value = ''
  fillMeasure()
}

function closeDetail() {
  detailId.value = null
}

function fillMeasure() {
  const row = getCleanroom(detailId.value ?? -1)
  measure['悬浮粒子数'] = row ? String(row['悬浮粒子数'] ?? '') : ''
  measure['沉降菌数'] = row ? String(row['沉降菌数'] ?? '') : ''
  measure['温度读数'] = row ? String(row['温度读数'] ?? '') : ''
  measure['相对湿度'] = row ? String(row['相对湿度'] ?? '') : ''
}

function saveMeasure() {
  if (busy.value || detailId.value === null) {
    return
  }
  busy.value = true
  try {
    const result = saveMeasurement(detailId.value, { ...measure })
    if (!result.ok) {
      detailError.value = result.message
      return
    }
    detailError.value = ''
    reload()
    fillMeasure()
  } finally {
    busy.value = false
  }
}

// ---- 动作流转：同一动作连点多次，幂等保护 + 忙等只放行一次 ----
function runAction(action: string, row: EntryRow) {
  if (busy.value) {
    return
  }
  errorMessage.value = ''
  detailError.value = ''
  busy.value = true
  try {
    const result = runCleanroomAction(action, row)
    if (!result.ok) {
      if (detailId.value === Number(row.id)) {
        detailError.value = result.message
      } else {
        errorMessage.value = result.message
      }
      return
    }
    reload()
    if (detailId.value === Number(row.id)) {
      fillMeasure()
    }
  } finally {
    busy.value = false
  }
}

function canRun(action: string): boolean {
  if (!detailRow.value) {
    return false
  }
  const sources = meta.actionSources?.[action]
  return sources ? sources.includes(String(detailRow.value.status)) : true
}

function actionHint(action: string): string {
  if (canRun(action)) {
    return ''
  }
  const sources = meta.actionSources?.[action] ?? []
  return `当前状态不能执行「${action}」，需先处于：${sources.join('、')}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listCleanroom(filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '洁净区环境监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 640px;
  max-width: calc(100vw - 48px);
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
}
.modal-title { margin: 0 0 12px; font-size: 16px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-item input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.detail-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  max-width: calc(100vw - 32px);
  height: 100vh;
  overflow-y: auto;
  background: #fff;
  border-left: 1px solid var(--border);
  box-shadow: -10px 0 30px rgba(15, 23, 42, 0.12);
  padding: 16px 18px;
  z-index: 15;
}
.detail-head { display: flex; justify-content: space-between; align-items: center; }
.detail-head h3 { margin: 0; font-size: 15px; }
.detail-list {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 10px;
  margin: 12px 0;
  font-size: 13px;
}
.detail-list dt { color: var(--muted); }
.detail-list dd { margin: 0; }
.warn-text { color: #b42318; font-weight: 600; }
.measure-block { border-top: 1px dashed var(--border); padding-top: 12px; margin-bottom: 12px; }
.measure-block h4, .detail-actions h4 { margin: 0 0 8px; font-size: 13px; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px dashed var(--border); padding-top: 12px; }
.detail-actions h4 { width: 100%; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
