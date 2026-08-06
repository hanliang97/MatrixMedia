<script setup>
import { ref, computed, onMounted } from 'vue'

const GIST_ID = '9bd67e622baa655abf30cc151f0fcf5a'
const OPENS_FILE = 'events.json'
const PUBLISH_FILE = 'publish-events.json'
const CACHE_KEY = 'mm_home_count_cache'
const CACHE_TTL = 5 * 60 * 1000

const opensTotal = ref(null)
const opens7d = ref(null)
const pubTotal = ref(null)
const pub7d = ref(null)
const loading = ref(true)
const error = ref(false)

const dOpenT = computed(() => opensTotal.value === null ? '—' : opensTotal.value.toLocaleString())
const dOpen7 = computed(() => opens7d.value === null ? '—' : opens7d.value.toLocaleString())
const dPubT = computed(() => pubTotal.value === null ? '—' : pubTotal.value.toLocaleString())
const dPub7 = computed(() => pub7d.value === null ? '—' : pub7d.value.toLocaleString())

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

function countArr(files, name) {
  try {
    const f = files && files[name]
    const arr = JSON.parse((f && f.content) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch (_) { return [] }
}
function since7d(arr) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000
  return arr.filter((e) => new Date(e.ts).getTime() >= cutoff).length
}

async function load() {
  loading.value = true
  error.value = false
  const cached = readCache()
  if (cached && cached.data) {
    apply(cached.data)
    loading.value = false
    refresh().catch(() => {})
    return
  }
  await refresh()
  loading.value = false
}

function apply(d) {
  opensTotal.value = d.opensTotal
  opens7d.value = d.opens7d
  pubTotal.value = d.pubTotal
  pub7d.value = d.pub7d
}

async function refresh() {
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) { error.value = true; return }
    const data = await res.json()
    const files = data.files || {}
    const opens = countArr(files, OPENS_FILE)
    const pubs = countArr(files, PUBLISH_FILE)
    const d = {
      opensTotal: opens.length,
      opens7d: since7d(opens),
      pubTotal: pubs.length,
      pub7d: since7d(pubs)
    }
    apply(d)
    writeCache(d)
    error.value = false
  } catch (_) {
    error.value = true
  }
}

onMounted(() => { load() })
</script>

<template>
  <div class="hoc">
    <a class="hoc-badge" href="/MatrixMedia/community" title="查看社区打开与发布统计">
      <span class="hoc-dot" :class="{ 'hoc-dot--live': !loading && !error }"></span>
      <span v-if="loading" class="hoc-text">软件打开次数加载中…</span>
      <span v-else-if="error" class="hoc-text">软件打开次数 · 点击查看详情</span>
      <span v-else class="hoc-text">
        软件打开次数：已累计 <strong>{{ dOpenT }}</strong> 次 · 近 7 天 <strong>{{ dOpen7 }}</strong> 次
        <span class="hoc-sep">|</span>
        累计代发视频 <strong>{{ dPubT }}</strong> · 近 7 天 <strong>{{ dPub7 }}</strong> 次
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
.hoc-sep { opacity: 0.4; margin: 0 4px; }
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
