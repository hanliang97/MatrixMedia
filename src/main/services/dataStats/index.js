"use strict";

/**
 * 数据统计 IPC 入口。
 *
 * - stats:collect       采集一组账号（串行队列，账号间间隔防风控），进度经 stats:progress 推送
 * - stats:get-data      读取单账号本地数据（daily + works + meta）
 * - stats:get-overview  全账号按日聚合（所有账号总览页）
 *
 * 采集全程使用平台页面上下文 fetch（复用分组 partition 登录态），不做任何签名构造。
 */

const { ipcMain } = require("electron");
const { collectAccount } = require("./collector");
const store = require("./store");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let collecting = false;
let cancelled = false;

async function collectAccounts(accounts, sender) {
  const results = [];
  const total = accounts.length;
  const startedAt = Date.now();
  for (let i = 0; i < total; i++) {
    if (cancelled) break;
    const acc = accounts[i];
    const progress = (status, extra = {}) => {
      try {
        sender.send("stats:progress", {
          index: i,
          total,
          group: acc.group,
          platform: acc.platform,
          status,
          ...extra,
        });
      } catch (_) {
        /* 窗口可能已关闭 */
      }
    };
    progress("running");
    try {
      const data = await collectAccount({
        partition: acc.partition,
        platform: acc.platform,
      });
      store.mergeDaily(acc.group, acc.platform, data.overview, data.fansHistory);
      store.mergeWorks(acc.group, acc.platform, data.works);
      store.writeMeta(acc.group, acc.platform, {
        lastCollectAt: Date.now(),
        lastError: "",
        workCount: data.works.length,
      });
      results.push({
        group: acc.group,
        platform: acc.platform,
        success: true,
        workCount: data.works.length,
      });
      progress("success");
    } catch (err) {
      const message = (err && err.message) || String(err);
      store.writeMeta(acc.group, acc.platform, {
        lastCollectAt: Date.now(),
        lastError: message,
      });
      results.push({
        group: acc.group,
        platform: acc.platform,
        success: false,
        error: message,
      });
      progress("failed", { error: message });
    }
    if (i < total - 1) await sleep(2000); // 账号间间隔
  }
  // 任务日志落盘（拉取记录弹窗用）
  store.appendCollectLog({
    startedAt,
    finishedAt: Date.now(),
    cancelled,
    results,
  });
  return { results, cancelled };
}

function registerDataStatsIpc() {
  ipcMain.handle("stats:collect", async (event, args) => {
    if (collecting) {
      return { results: [], error: "已有采集任务进行中" };
    }
    const accounts = Array.isArray(args && args.accounts) ? args.accounts : [];
    if (!accounts.length) return { results: [], error: "没有可采集的账号" };
    collecting = true;
    cancelled = false;
    try {
      return await collectAccounts(accounts, event.sender);
    } finally {
      collecting = false;
    }
  });

  ipcMain.handle("stats:cancel", async () => {
    cancelled = true;
    return { ok: true };
  });

  ipcMain.handle("stats:get-data", async (_event, args) => {
    const { group, platform } = args || {};
    return store.readAccount(group, platform);
  });

  ipcMain.handle("stats:get-overview", async () => {
    return store.readOverview();
  });

  ipcMain.handle("stats:get-logs", async () => {
    return store.readCollectLogs();
  });

  /**
   * 发布状态匹配（视频管理「获取状态」）：
   * 输入若干条发布记录，按「分组 × 平台」聚合后各跑一次采集，
   * 在作品列表里按标题匹配——命中即说明发布成功，返回作品链接。
   *
   * @param {Array<{key, group, platform, partition, title}>} args.tasks
   * @returns {{ matches: Record<string, {found: boolean, url?: string, workId?: string}>, errors: Array }}
   */
  ipcMain.handle("stats:match-works", async (_event, args) => {
    const tasks = Array.isArray(args && args.tasks) ? args.tasks : [];
    const matches = {};
    const errors = [];
    // 按平台聚合，每平台只采集一次（顺带写入本地快照，数据页同步受益）
    const groupsMap = new Map();
    for (const t of tasks) {
      if (!t || !t.partition || !t.platform || !t.key) continue;
      const gk = `${t.partition}`;
      if (!groupsMap.has(gk)) {
        groupsMap.set(gk, {
          partition: t.partition,
          platform: t.platform,
          group: t.group || "",
          tasks: [],
        });
      }
      groupsMap.get(gk).tasks.push(t);
    }

    const normalizeTitle = (s) =>
      String(s || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

    for (const { partition, platform, group, tasks: groupTasks } of groupsMap.values()) {
      try {
        const data = await collectAccount({ partition, platform });
        // 顺带落库（与「同步数据」同效果）
        store.mergeDaily(group, platform, data.overview, data.fansHistory);
        store.mergeWorks(group, platform, data.works);
        store.writeMeta(group, platform, {
          lastCollectAt: Date.now(),
          lastError: "",
          workCount: data.works.length,
        });
        const byTitle = new Map();
        for (const w of data.works || []) {
          const key = normalizeTitle(w.title);
          if (key && !byTitle.has(key)) byTitle.set(key, w);
        }
        for (const t of groupTasks) {
          const hit = byTitle.get(normalizeTitle(t.title));
          matches[t.key] = hit
            ? { found: true, url: hit.url || "", workId: hit.workId }
            : { found: false };
        }
      } catch (err) {
        const message = (err && err.message) || String(err);
        errors.push({ group, platform, error: message });
        for (const t of groupTasks) {
          matches[t.key] = { found: false, error: message };
        }
      }
      await sleep(2000); // 平台间间隔
    }
    return { matches, errors };
  });
}

module.exports = { registerDataStatsIpc };
