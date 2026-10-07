"use strict";

/**
 * 数据统计本地存储（userData/data-stats/<分组>/<平台>/）：
 *   daily.json  每日总量快照 { "YYYY-MM-DD": { fans, plays, likes, comments, favorites, shares } }
 *   works.json  作品列表 + 发布增长封闭记录
 *   meta.json   { lastCollectAt, lastError, workCount }
 *
 * 日趋势口径：所有平台统一为「当日总量快照」；抖音/视频号额外回填粉丝历史（只补缺日期）。
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const METRIC_KEYS = ["fans", "plays", "likes", "comments", "favorites", "shares"];

function baseDir() {
  return path.join(app.getPath("userData"), "data-stats");
}

function safeSeg(name) {
  return String(name || "未命名").replace(/[\\/:*?"<>|]/g, "_");
}

function accountDir(group, platform) {
  return path.join(baseDir(), safeSeg(group), safeSeg(platform));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function todayStr(now = Date.now()) {
  const d = new Date(now + 8 * 3600e3);
  return d.toISOString().slice(0, 10);
}

/* ---------------- daily ---------------- */

function readDaily(group, platform) {
  return readJson(path.join(accountDir(group, platform), "daily.json"), {});
}

function writeDaily(group, platform, daily) {
  writeJson(path.join(accountDir(group, platform), "daily.json"), daily);
}

/**
 * 合并一次采集到 daily：写入当日总量快照；fansHistory 只回填缺失日期。
 */
function mergeDaily(group, platform, overview, fansHistory, now = Date.now()) {
  const daily = readDaily(group, platform);
  const today = todayStr(now);
  const snap = {};
  for (const k of METRIC_KEYS) {
    const v = Number(overview && overview[k]);
    if (Number.isFinite(v)) snap[k] = v;
  }
  daily[today] = { ...daily[today], ...snap };
  for (const point of fansHistory || []) {
    if (!point || !point.date) continue;
    if (!daily[point.date]) daily[point.date] = {};
    if (daily[point.date].fans == null) {
      daily[point.date].fans = Number(point.value) || 0;
    }
  }
  writeDaily(group, platform, daily);
  return daily;
}

/* ---------------- works（发布增长） ---------------- */

function readWorks(group, platform) {
  return readJson(path.join(accountDir(group, platform), "works.json"), {
    works: [],
  });
}

function writeWorks(group, platform, data) {
  writeJson(path.join(accountDir(group, platform), "works.json"), data);
}

const WORK_STAT_KEYS = ["play", "like", "comment", "share", "favorite", "fansDelta"];

function pickStats(w) {
  const out = {};
  for (const k of WORK_STAT_KEYS) out[k] = w[k] == null ? null : w[k];
  return out;
}

/**
 * 合并作品列表，实现「发布增长」口径：
 * - 新出现的作品：登记基线（首次见到时的值），并封闭「比它早且尚未封闭」的最近一条
 * - 已有作品：更新当前累计值
 * - 展示时优先用封闭值（closedStats），未封闭用当前值
 */
function mergeWorks(group, platform, newWorks, now = Date.now()) {
  const data = readWorks(group, platform);
  const byId = new Map(data.works.map((w) => [w.workId, w]));
  // 首次全量导入时不做封闭：封闭语义是「两次采集之间出现了新发布」，
  // 首次导入没有历史基线，全部登记为未封闭
  const isFirstImport = data.works.length === 0;

  // 接口返回按发布时间倒序；先升序处理，便于「上一条」封闭逻辑
  const sorted = [...(newWorks || [])]
    .filter((w) => w && w.workId)
    .sort((a, b) => (a.publishTime || 0) - (b.publishTime || 0));

  for (const w of sorted) {
    const existing = byId.get(w.workId);
    if (existing) {
      Object.assign(existing, pickStats(w), { updatedAt: now });
      if (w.title) existing.title = w.title;
      if (w.url) existing.url = w.url;
      continue;
    }
    // 新作品：封闭比它早的最近一条未封闭作品（仅非首次导入时）
    if (!isFirstImport) {
      const earlier = data.works
        .filter((x) => !x.closedStats && (x.publishTime || 0) < (w.publishTime || 0))
        .sort((a, b) => (b.publishTime || 0) - (a.publishTime || 0))[0];
      if (earlier) {
        earlier.closedStats = pickStats(earlier);
        earlier.closedAt = now;
      }
    }
    const row = {
      workId: w.workId,
      title: w.title || "(无标题)",
      url: w.url || "",
      publishTime: w.publishTime || 0,
      ...pickStats(w),
      baselineStats: pickStats(w),
      closedStats: null,
      closedAt: null,
      firstSeenAt: now,
      updatedAt: now,
    };
    data.works.push(row);
    byId.set(row.workId, row);
  }

  // 展示按发布时间倒序
  data.works.sort((a, b) => (b.publishTime || 0) - (a.publishTime || 0));
  writeWorks(group, platform, data);
  return data;
}

/* ---------------- meta ---------------- */

function writeMeta(group, platform, patch) {
  const file = path.join(accountDir(group, platform), "meta.json");
  const meta = readJson(file, {});
  writeJson(file, { ...meta, ...patch });
}

/* ---------------- 采集日志 ---------------- */

const MAX_COLLECT_LOGS = 100;

function collectLogFile() {
  return path.join(baseDir(), "collect-logs.json");
}

/** 追加一次采集任务记录（新记录在前，最多保留 100 次） */
function appendCollectLog(taskLog) {
  const logs = readJson(collectLogFile(), []);
  logs.unshift(taskLog);
  writeJson(collectLogFile(), logs.slice(0, MAX_COLLECT_LOGS));
}

function readCollectLogs() {
  return readJson(collectLogFile(), []);
}

/* ---------------- 读取与聚合 ---------------- */

/** 单账号完整数据（平台页用） */
function readAccount(group, platform) {
  return {
    group,
    platform,
    daily: readDaily(group, platform),
    works: readWorks(group, platform).works,
    meta: readJson(path.join(accountDir(group, platform), "meta.json"), {}),
  };
}

/** 列出已采集的账号 */
function listAccounts() {
  const out = [];
  const root = baseDir();
  if (!fs.existsSync(root)) return out;
  for (const group of fs.readdirSync(root)) {
    const gDir = path.join(root, group);
    if (!fs.statSync(gDir).isDirectory()) continue;
    for (const platform of fs.readdirSync(gDir)) {
      const pDir = path.join(gDir, platform);
      if (!fs.statSync(pDir).isDirectory()) continue;
      out.push({
        group,
        platform,
        meta: readJson(path.join(pDir, "meta.json"), {}),
      });
    }
  }
  return out;
}

/** 全账号按日聚合（所有账号总览页用）；accounts 附最新快照供平台分布/分组表使用 */
function readOverview() {
  const merged = {};
  const accounts = listAccounts().map((acc) => {
    const daily = readDaily(acc.group, acc.platform);
    const dates = Object.keys(daily).sort();
    const latest = dates.length ? daily[dates[dates.length - 1]] : null;
    for (const [date, snap] of Object.entries(daily)) {
      if (!merged[date]) {
        merged[date] = { fans: 0, plays: 0, likes: 0, comments: 0, favorites: 0, shares: 0 };
      }
      for (const k of METRIC_KEYS) {
        merged[date][k] += Number(snap[k]) || 0;
      }
    }
    return { ...acc, latest };
  });
  return { daily: merged, accounts };
}

module.exports = {
  METRIC_KEYS,
  mergeDaily,
  mergeWorks,
  readDaily,
  readAccount,
  readOverview,
  listAccounts,
  writeMeta,
  appendCollectLog,
  readCollectLogs,
  todayStr,
};
