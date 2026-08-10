<script setup>
import { ref, computed, onMounted } from 'vue'

import { loadGistEvents, GIST_ID, OPENS_FILE } from '../utils/gistStats'

const loading = ref(false)
const error = ref('')
const events = ref([])
const updatedAt = ref(null)
const configOk = computed(() => !!GIST_ID)

const total = computed(() => events.value.length)
const opens7d = computed(() => countSince(7))
const opens30d = computed(() => countSince(30))
const opens1d = computed(() => countSince(1))

function countSince(days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000
  return events.value.filter((e) => new Date(e.ts).getTime() >= cutoff).length
}

const platformDist = computed(() => distBy('platform'))
const versionDist = computed(() => distBy('version'))
const modeDist = computed(() => distBy('mode'))

function distBy(key) {
  const m = {}
  for (const e of events.value) {
    const k = e[key] || 'unknown'
    m[k] = (m[k] || 0) + 1
  }
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: total.value ? Math.round((count / total.value) * 100) : 0 }))
}

const recent = computed(() =>
  [...events.value].sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 200)
)

function fmtDate(s) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function fetchGist(force = false) {
  if (!configOk.value) {
    error.value = '未配置 GIST_ID（维护者请在 gistStats.js 中填入）'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await loadGistEvents(OPENS_FILE, { force })
    if (res.error && !res.events.length) {
      error.value = `数据加载失败：${res.error}`
    } else {
      events.value = res.events
      updatedAt.value = res.updatedAt
      error.value = res.stale ? '当前展示的是本地缓存数据（远端暂时不可用）' : ''
    }
  } finally {
    loading.value = false
  }
}

function refresh() {
  return fetchGist(true)
}

onMounted(() => { fetchGist() })
</script>

<template>
  <div class="aub">
    <div v-if="!configOk" class="aub-empty">
      ⚠️ 维护者尚未配置 GIST_ID。请在
      <code>website/.vitepress/theme/components/ActiveUsersBoard.vue</code> 顶部填入公开 Gist id，
      并在 Electron 端设置相同的 <code>MATRIXMEDIA_GIST_ID</code> 与
      <code>MATRIXMEDIA_GIST_TOKEN</code>。
    </div>

    <template v-else>
      <div class="aub-toolbar">
        <button class="aub-btn" @click="refresh" :disabled="loading">
          {{ loading ? '加载中…' : '刷新数据' }}
        </button>
        <span v-if="updatedAt" class="aub-updated">
          数据更新于 {{ fmtDate(updatedAt) }}（5 分钟缓存）
        </span>
        <span v-if="error" class="aub-error">{{ error }}</span>
      </div>

      <div class="aub-stats">
        <div class="aub-stat"><div class="aub-stat-num">{{ total }}</div><div class="aub-stat-label">累计打开次数</div></div>
        <div class="aub-stat"><div class="aub-stat-num">{{ opens1d }}</div><div class="aub-stat-label">近 24 小时</div></div>
        <div class="aub-stat"><div class="aub-stat-num">{{ opens7d }}</div><div class="aub-stat-label">近 7 天</div></div>
        <div class="aub-stat"><div class="aub-stat-num">{{ opens30d }}</div><div class="aub-stat-label">近 30 天</div></div>
      </div>

      <div class="aub-cols">
        <div class="aub-card">
          <div class="aub-card-title">平台分布</div>
          <div class="aub-bars">
            <div v-for="d in platformDist" :key="d.name" class="aub-bar">
              <span class="aub-bar-name">{{ d.name }}</span>
              <span class="aub-bar-track"><span class="aub-bar-fill" :style="{ width: d.pct + '%' }"></span></span>
              <span class="aub-bar-num">{{ d.count }} ({{ d.pct }}%)</span>
            </div>
            <div v-if="!platformDist.length" class="aub-empty-row">暂无数据</div>
          </div>
        </div>
        <div class="aub-card">
          <div class="aub-card-title">版本分布</div>
          <div class="aub-bars">
            <div v-for="d in versionDist" :key="d.name" class="aub-bar">
              <span class="aub-bar-name">{{ d.name }}</span>
              <span class="aub-bar-track"><span class="aub-bar-fill" :style="{ width: d.pct + '%' }"></span></span>
              <span class="aub-bar-num">{{ d.count }} ({{ d.pct }}%)</span>
            </div>
            <div v-if="!versionDist.length" class="aub-empty-row">暂无数据</div>
          </div>
        </div>
        <div class="aub-card">
          <div class="aub-card-title">使用方式</div>
          <div class="aub-bars">
            <div v-for="d in modeDist" :key="d.name" class="aub-bar">
              <span class="aub-bar-name">{{ d.name === 'cli' ? 'CLI' : 'GUI' }}</span>
              <span class="aub-bar-track"><span class="aub-bar-fill" :style="{ width: d.pct + '%' }"></span></span>
              <span class="aub-bar-num">{{ d.count }} ({{ d.pct }}%)</span>
            </div>
            <div v-if="!modeDist.length" class="aub-empty-row">暂无数据</div>
          </div>
        </div>
      </div>

      <div class="aub-card aub-table-card">
        <div class="aub-card-title">最近打开记录（最多 200 条，按时间倒序）</div>
        <div class="aub-table-wrap">
          <table class="aub-table">
            <thead>
              <tr>
                <th>时间</th><th>平台</th><th>架构</th><th>版本</th><th>方式</th><th>语言</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in recent" :key="i">
                <td>{{ fmtDate(e.ts) }}</td>
                <td>{{ e.platform }}</td>
                <td>{{ e.arch }}</td>
                <td>{{ e.version }}</td>
                <td>{{ e.mode === 'cli' ? 'CLI' : 'GUI' }}</td>
                <td>{{ e.locale }}</td>
              </tr>
              <tr v-if="!recent.length"><td colspan="6" class="aub-empty-row">暂无数据</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.aub { margin: 1.5rem 0; }
.aub-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.aub-btn {
  border: 1px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 14px;
}
.aub-btn:disabled { opacity: 0.6; cursor: default; }
.aub-updated { font-size: 13px; color: var(--vp-c-text-2); }
.aub-error { font-size: 13px; color: var(--vp-c-danger-1, #dc2626); }
.aub-empty {
  padding: 14px 16px; border: 1px dashed var(--vp-c-divider); border-radius: 8px;
  color: var(--vp-c-text-2); font-size: 14px; line-height: 1.7;
}
.aub-stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.aub-stat {
  flex: 1 1 140px; border: 1px solid var(--vp-c-divider); border-radius: 10px;
  padding: 18px; text-align: center; background: var(--vp-c-bg);
}
.aub-stat-num { font-size: 28px; font-weight: 700; color: var(--vp-c-brand-1); }
.aub-stat-label { font-size: 13px; color: var(--vp-c-text-2); margin-top: 4px; }
.aub-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 20px; }
.aub-card { border: 1px solid var(--vp-c-divider); border-radius: 10px; padding: 16px; background: var(--vp-c-bg); }
.aub-card-title { font-weight: 600; margin-bottom: 12px; color: var(--vp-c-text-1); }
.aub-bars { display: flex; flex-direction: column; gap: 8px; }
.aub-bar { display: grid; grid-template-columns: 80px 1fr 90px; gap: 8px; align-items: center; font-size: 13px; }
.aub-bar-name { color: var(--vp-c-text-2); }
.aub-bar-track { height: 8px; background: var(--vp-c-divider); border-radius: 4px; overflow: hidden; }
.aub-bar-fill { display: block; height: 100%; background: var(--vp-c-brand-1); }
.aub-bar-num { color: var(--vp-c-text-2); text-align: right; }
.aub-empty-row { color: var(--vp-c-text-3); font-size: 13px; padding: 6px 0; }
.aub-table-wrap { overflow-x: auto; }
.aub-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.aub-table th, .aub-table td { padding: 8px 10px; border-bottom: 1px solid var(--vp-c-divider); text-align: left; white-space: nowrap; }
.aub-table th { color: var(--vp-c-text-2); font-weight: 600; }
.aub-table td { color: var(--vp-c-text-1); }
.aub-table tbody tr:hover { background: var(--vp-c-bg-soft); }
</style>
