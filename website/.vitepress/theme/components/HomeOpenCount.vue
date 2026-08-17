<script setup>
import { ref, computed, onMounted } from "vue";
import { loadGistEvents, OPENS_FILE } from "../utils/gistStats";

const opensTotal = ref(null);
const opens7d = ref(null);
const loading = ref(true);
const error = ref(false);

const dOpenT = computed(() =>
  opensTotal.value === null ? "—" : opensTotal.value.toLocaleString()
);
const dOpen7 = computed(() =>
  opens7d.value === null ? "—" : opens7d.value.toLocaleString()
);

function since7d(arr) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  return arr.filter((e) => new Date(e.ts).getTime() >= cutoff).length;
}

async function load() {
  loading.value = true;
  const opensRes = await loadGistEvents(OPENS_FILE);
  const opens = opensRes.events;
  if (!opens.length && opensRes.error) {
    error.value = true;
  } else {
    error.value = false;
    opensTotal.value = opens.length;
    opens7d.value = since7d(opens);
  }
  loading.value = false;
}

onMounted(() => {
  load();
});
</script>

<template>
  <div class="hoc">
    <a class="hoc-badge" href="/MatrixMedia/community" title="查看社区打开统计">
      <span
        class="hoc-dot"
        :class="{ 'hoc-dot--live': !loading && !error }"
      ></span>
      <span v-if="loading" class="hoc-text">软件打开次数加载中…</span>
      <span v-else-if="error" class="hoc-text"
        >软件打开次数 · 点击查看详情</span
      >
      <span v-else class="hoc-text">
        软件打开次数：已累计 <strong>{{ dOpenT }}</strong> 次 · 近 7 天
        <strong>{{ dOpen7 }}</strong> 次
      </span>
    </a>
  </div>
</template>

<style scoped>
.hoc {
  display: flex;
  justify-content: center;
  margin: 0 0 18px;
}
.hoc-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 13px;
  line-height: 1.4;
  text-decoration: none;
  transition: opacity 0.2s;
}
.hoc-badge:hover {
  opacity: 0.85;
}
.hoc-text strong {
  font-weight: 700;
}
.hoc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
}
.hoc-dot--live {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 0 var(--vp-c-brand-1);
  animation: hoc-pulse 1.8s infinite;
}
@keyframes hoc-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(15, 118, 110, 0.45);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(15, 118, 110, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(15, 118, 110, 0);
  }
}
</style>
