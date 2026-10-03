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
          <td
            v-for="column in columns"
            :key="column"
            :class="{ 'link-cell': column === '监测点位' }"
            @click="column === '监测点位' && openDetail(row)"
          >
            {{ row[column] ?? '—' }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="busyKey === `${row.id}:${action}`"
              @click="runRowAction(action, row)"
            >
              {{ busyKey === `${row.id}:${action}` ? '处理中…' : action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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

    <!-- 登记表单：悬浮粒子数、沉降菌数与其他字段一次校验、一次写全到同一条记录 -->
    <div v-if="createVisible" class="modal-mask" @click.self="closeCreate">
      <div class="modal-card">
        <h3 class="modal-title">登记环境监测记录</h3>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label class="form-item">
            <span>监测点位</span>
            <input v-model="createForm.监测点位" placeholder="如：灌装线A层流罩" />
          </label>
          <label class="form-item">
            <span>洁净级别</span>
            <input
              v-model="createForm.洁净级别"
              list="cleanliness-levels"
              placeholder="可选择或直接填写，历史新旧级别均原样保留"
            />
            <datalist id="cleanliness-levels">
              <option v-for="level in cleanlinessLevels" :key="level" :value="level" />
            </datalist>
          </label>
          <label class="form-item">
            <span>悬浮粒子数（个/m³）</span>
            <input v-model="createForm.悬浮粒子数" inputmode="numeric" placeholder="非负整数" />
          </label>
          <label class="form-item">
            <span>沉降菌数（CFU/皿）</span>
            <input v-model="createForm.沉降菌数" inputmode="numeric" placeholder="非负整数" />
          </label>
          <label class="form-item">
            <span>温度读数（℃）</span>
            <input v-model="createForm.温度读数" inputmode="decimal" placeholder="选填" />
          </label>
          <label class="form-item">
            <span>相对湿度（%）</span>
            <input v-model="createForm.相对湿度" inputmode="decimal" placeholder="选填" />
          </label>
          <label class="form-item">
            <span>监测日期</span>
            <input v-model="createForm.监测日期" type="date" />
          </label>
          <p v-if="createError" class="error-text form-error">{{ createError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
            <button class="btn primary" type="submit" :disabled="createBusy">
              {{ createBusy ? '提交中…' : '提交登记' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 详情/实测面板：与列表读同一份存储，动作与读数原子写入同一条记录 -->
    <div v-if="detailVisible" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card detail-card">
        <h3 class="modal-title">环境监测记录详情 · 编号 {{ detailRow?.id }}</h3>
        <template v-if="detailRow">
          <dl class="detail-grid">
            <div v-for="field in columns" :key="field">
              <dt>{{ field }}</dt>
              <dd>{{ detailRow[field] ?? '—' }}</dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>{{ detailRow.status }}</dd>
            </div>
          </dl>

          <fieldset class="reading-box">
            <legend>实测读数（随动作一并写入本记录）</legend>
            <label class="form-item">
              <span>悬浮粒子数（个/m³）</span>
              <input v-model="readings.悬浮粒子数" inputmode="numeric" placeholder="不修改请留空" />
            </label>
            <label class="form-item">
              <span>沉降菌数（CFU/皿）</span>
              <input v-model="readings.沉降菌数" inputmode="numeric" placeholder="不修改请留空" />
            </label>
          </fieldset>

          <p v-if="detailError" class="error-text form-error">{{ detailError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
            <button
              v-for="action in actions"
              :key="action"
              class="btn"
              :class="{ primary: action === '标记超标' }"
              type="button"
              :disabled="detailBusyKey === action"
              @click="runDetailAction(action)"
            >
              {{ detailBusyKey === action ? '处理中…' : action }}
            </button>
          </div>
          <p class="detail-hint">状态按「待监测 → 监测中 → 已达标 / 超标预警」次序流转，倒序操作将被拒收。</p>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { CLEANLINESS_LEVELS, todayText, type CleanroomDraft } from '@/data/cleanroom'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cleanroom')
const columns = ["监测点位", "洁净级别", "悬浮粒子数", "沉降菌数", "温度读数", "相对湿度", "监测日期", "监测状态"]
const actions = ["提交监测", "判定达标", "标记超标"]
const statuses = ["待监测", "监测中", "已达标", "超标预警"]
const cleanlinessLevels = CLEANLINESS_LEVELS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const busyKey = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待监测点位', value: rows.value.filter((row) => row.status === '待监测').length },
  { label: '监测中点位', value: rows.value.filter((row) => row.status === '监测中').length },
  { label: '超标点位数', value: rows.value.filter((row) => row.status === '超标预警').length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runRowAction(action: string, row: EntryRow) {
  if (busyKey.value) {
    return
  }
  errorMessage.value = ''
  busyKey.value = `${row.id}:${action}`
  const result = applyAction(meta.key, Number(row.id), action)
  busyKey.value = ''
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  syncDetail(Number(row.id))
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '洁净区环境监测列表读取失败'
  }
}

// ---------- 登记 ----------

function emptyDraft(): CleanroomDraft {
  return {
    监测点位: '',
    洁净级别: '',
    悬浮粒子数: '',
    沉降菌数: '',
    温度读数: '',
    相对湿度: '',
    监测日期: todayText(),
  }
}

const createVisible = ref(false)
const createBusy = ref(false)
const createError = ref('')
const createForm = ref<CleanroomDraft>(emptyDraft())

function openCreate() {
  createForm.value = emptyDraft()
  createError.value = ''
  createVisible.value = true
}

function closeCreate() {
  if (createBusy.value) {
    return
  }
  createVisible.value = false
}

function submitCreate() {
  if (createBusy.value) {
    return
  }
  createError.value = ''
  createBusy.value = true
  const result = createEntry(meta.key, { ...createForm.value })
  createBusy.value = false
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createVisible.value = false
  reload()
}

// ---------- 详情 / 实测面板 ----------

const detailVisible = ref(false)
const detailRow = ref<EntryRow | null>(null)
const detailError = ref('')
const detailBusyKey = ref('')
const readings = ref<{ 悬浮粒子数: string; 沉降菌数: string }>({ 悬浮粒子数: '', 沉降菌数: '' })

function openDetail(row: EntryRow) {
  detailError.value = ''
  readings.value = { 悬浮粒子数: '', 沉降菌数: '' }
  detailRow.value = getEntry(meta.key, Number(row.id)) ?? row
  detailVisible.value = true
}

function closeDetail() {
  if (detailBusyKey.value) {
    return
  }
  detailVisible.value = false
  detailRow.value = null
}

// 动作完成后从同一份存储重新读取，面板与明细始终一致。
function syncDetail(id?: number) {
  if (!detailVisible.value) {
    return
  }
  const targetId = id ?? Number(detailRow.value?.id)
  const latest = getEntry(meta.key, targetId)
  if (latest) {
    detailRow.value = latest
  }
}

function runDetailAction(action: string) {
  if (detailBusyKey.value || !detailRow.value) {
    return
  }
  detailError.value = ''
  detailBusyKey.value = action
  const result = applyAction(meta.key, Number(detailRow.value.id), action, { ...readings.value })
  detailBusyKey.value = ''
  if (!result.ok) {
    detailError.value = result.message
    return
  }
  readings.value = { 悬浮粒子数: '', 沉降菌数: '' }
  reload()
  syncDetail()
}

onMounted(reload)
</script>

<style scoped>
.link-cell {
  color: var(--brand);
  cursor: pointer;
}
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
  width: 520px;
  max-height: 86vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.detail-card {
  width: 640px;
}
.modal-title {
  margin: 0 0 14px;
  font-size: 16px;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.form-item span {
  color: var(--muted);
}
.form-item input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.form-error {
  margin: 4px 0 0;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin: 0 0 12px;
}
.detail-grid dt {
  color: var(--muted);
  font-size: 12px;
}
.detail-grid dd {
  margin: 2px 0 0;
  font-size: 13px;
}
.reading-box {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.reading-box legend {
  color: var(--muted);
  font-size: 12px;
  padding: 0 4px;
}
.detail-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.btn:disabled,
.link:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
