/**
 * 统计数据读取（GitHub Gist）
 *
 * 为什么不用 api.github.com：
 * 未认证的 GitHub REST API 限额是「每 IP 每小时 60 次」，官网访客共享出口 IP 时
 * 很容易触发 403 rate limit exceeded。改为读取 gist 的 raw 文件：
 *   https://gist.githubusercontent.com/<owner>/<gistId>/raw/<file>
 * raw 走 CDN（Cache-Control: max-age=300）、带 CORS，且不受 60/h 的 API 限额约束。
 *
 * 策略：raw 优先 → 失败回退 REST API → 再失败用本地过期缓存（stale）兜底。
 * 同一页面内并发请求做去重，localStorage 缓存 5 分钟。
 */

export const GIST_OWNER = 'hanliang97'
export const GIST_ID = '9bd67e622baa655abf30cc151f0fcf5a'
export const OPENS_FILE = 'events.json'
export const PUBLISH_FILE = 'publish-events.json'

const RAW_BASE = `https://gist.githubusercontent.com/${GIST_OWNER}/${GIST_ID}/raw`
const API_URL = `https://api.github.com/gists/${GIST_ID}`
const CACHE_PREFIX = 'mm_gist_file_'
const CACHE_TTL = 5 * 60 * 1000

const inflight = new Map()

function cacheKey(file) {
  return `${CACHE_PREFIX}${file}`
}

function readCache(file) {
  try {
    const raw = localStorage.getItem(cacheKey(file))
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || !obj.t || !Array.isArray(obj.data)) return null
    return { data: obj.data, t: obj.t, fresh: Date.now() - obj.t <= CACHE_TTL }
  } catch (_) {
    return null
  }
}

function writeCache(file, data) {
  try {
    localStorage.setItem(cacheKey(file), JSON.stringify({ t: Date.now(), data }))
  } catch (_) {}
}

function parseArray(text) {
  try {
    const arr = JSON.parse(text || '[]')
    return Array.isArray(arr) ? arr : []
  } catch (_) {
    return []
  }
}

async function fetchRaw(file) {
  const res = await fetch(`${RAW_BASE}/${file}`)
  if (!res.ok) throw new Error(`raw ${res.status}`)
  return parseArray(await res.text())
}

async function fetchApi(file) {
  const res = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`api ${res.status}`)
  const data = await res.json()
  const f = data.files && data.files[file]
  return parseArray((f && f.content) || '[]')
}

/**
 * 读取 gist 中某个事件文件。
 * @param {string} file 文件名，如 events.json
 * @param {{force?: boolean}} [opts] force=true 时跳过新鲜缓存强制刷新
 * @returns {Promise<{events: any[], updatedAt: string, stale: boolean, error: string}>}
 */
export async function loadGistEvents(file, opts = {}) {
  const cached = readCache(file)
  if (!opts.force && cached && cached.fresh) {
    return {
      events: cached.data,
      updatedAt: new Date(cached.t).toISOString(),
      stale: false,
      error: ''
    }
  }

  const key = `${file}:${opts.force ? 'force' : 'auto'}`
  if (inflight.has(key)) return inflight.get(key)

  const task = (async () => {
    let lastErr = ''
    for (const fn of [fetchRaw, fetchApi]) {
      try {
        const events = await fn(file)
        writeCache(file, events)
        return { events, updatedAt: new Date().toISOString(), stale: false, error: '' }
      } catch (e) {
        lastErr = (e && e.message) || String(e)
      }
    }
    // 全部失败：用过期缓存兜底，保证页面不空白
    if (cached) {
      return {
        events: cached.data,
        updatedAt: new Date(cached.t).toISOString(),
        stale: true,
        error: lastErr
      }
    }
    return { events: [], updatedAt: null, stale: false, error: lastErr || '加载失败' }
  })()

  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}
