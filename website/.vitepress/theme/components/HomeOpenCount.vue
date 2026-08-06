<script setup>
import { ref, computed, onMounted } from 'vue'

const GIST_ID = '9bd67e622baa655abf30cc151f0fcf5a'
const GIST_FILENAME = 'events.json'
const CACHE_KEY = 'mm_opens_count_cache'
const CACHE_TTL = 5 * 60 * 1000

const total = ref(null)
const opens7d = ref(null)
const loading = ref(true)
const error = ref(false)

const displayTotal = computed(() => (total.value === null ? '—' : total.value.toLocaleString()))
const display7d = computed(() => (opens7d.value === null ? '—' : opens7d.value.toLocaleString()))

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || !obj.t) return null
    if (Date.now() - obj.t > CACHE_TTL) return null
    return obj
  } catch (_) { return null }
}
function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })) } catch (_) {}
}

async function load() {
  loading.value = true
  error.value = false
  const cached = readCache()
  if (cached && cached.data) {
    total.value = cached.data.total
    opens7d.value = cached.data.opens7d
    loading.value = false
    refresh().catch(() => {})
    return
  }
  await refresh()
  loading.value = false
}

async function refresh() {
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) { error.value = true; return }
    const data = await res.json()
    const file = data.files && data.files[GIST_FILENAME]
    const arr = JSON.parse((file && file.content) || '[]')
    const t = Array.isArray(arr) ? arr.length : 0
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000
    const w7 = arr.filter((e) => new Date(e.ts).getTime() >= cutoff).length
    total.value = t
    opens7d.value = w7
    writeCache({ total: t, opens7d: w7 })
  } catch (_) {
    error.value = true
  }
}

onMounted(() => { load() })
</script>

<template>
  <div class="hoc">
    <a class="hoc-badge" href="/MatrixMedia/community" title="查看社区打开统计">
      <span class="hoc-dot" :class="{ 'hoc-dot--live': !loading && !error }"></span>
      <span v-if="loading" class="hoc-text">统计加载中…</span>
      <span v-else-if="error" class="hoc-text">已发布 · 点击查看统计</span>
      <span v-else class="hoc-text">
        已累计打开 <strong>{{ displayTotal }}</strong> 次 · 近 7 天 <strong>{{ display7d }}</strong> 次
      </span>
    </a>
  </div>
</template>

<style scoped>
.hoc { display: flex; justify-content: center; margin: 0 0 18px; }
.hoc-badge {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 13px; line-height: 1.4;
  text-decoration: none;
  transition: opacity .2s;
}
.hoc-badge:hover { opacity: .85; }
.hoc-text strong { font-weight: 700; }
.hoc-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--vp-c-text-3);
}
.hoc-dot--live {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 0 var(--vp-c-brand-1);
  animation: hoc-pulse 1.8s infinite;
}
@keyframes hoc-pulse {
  0% { box-shadow: 0 0 0 0 rgba(15,118,110,.45); }
  70% { box-shadow: 0 0 0 6px rgba(15,118,110,0); }
  100% { box-shadow: 0 0 0 0 rgba(15,118,110,0); }
}
</style>
