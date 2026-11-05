"use strict";

import fs from "fs";
import path from "path";
import { app } from "electron";
import { changeData } from "../server/utils.js";
import { normalizeAccountRecordFields } from "../../shared/accountIdentity.js";

/**
 * 账号记录「分组新模型」一次性迁移。
 *
 * 给存量账号记录补齐 group / accountName / accountKey 三个新字段：
 *   group       = phone "-" 前缀
 *   accountName = phone "-" 后缀（无后缀 = 分组名）
 *   accountKey  = phone "-" 前缀（保证存量登录态 partition 逐字节不变）
 *
 * 顺带把数据统计目录里按历史「phone 全值」建的分组目录改名为「分组名」，
 * 保持统计历史连续（如 "主号组-皇汉科技AI" → "主号组"）。
 *
 * 每进程只执行一次（幂等：字段已存在时不改写）。在主进程启动、CLI 入口、
 * 内置服务 changeData 入口三处调用，覆盖 GUI / CLI / HTTP 三条链路。
 */

let migrated = false;

/** safeSeg 与 dataStats/store.js 保持一致 */
function safeSeg(name) {
  return String(name || "未命名").replace(/[\\/:*?"<>|]/g, "_");
}

/**
 * 数据统计目录按分组名归并（历史目录键是 phone 全值）。
 * 只在目标目录不存在时改名，避免覆盖；失败静默（不影响账号迁移主流程）。
 */
function migrateStatsGroupDirs() {
  try {
    if (!app || typeof app.getPath !== "function") return 0;
    const baseDir = path.join(app.getPath("userData"), "data-stats");
    if (!fs.existsSync(baseDir)) return 0;
    let renamed = 0;
    for (const name of fs.readdirSync(baseDir)) {
      if (!name.includes("-")) continue;
      const prefix = safeSeg(name.split("-")[0]);
      if (!prefix || prefix === name) continue;
      const from = path.join(baseDir, name);
      const to = path.join(baseDir, prefix);
      if (!fs.statSync(from).isDirectory() || fs.existsSync(to)) continue;
      fs.renameSync(from, to);
      renamed += 1;
    }
    if (renamed > 0) {
      console.log(`[account-migration] 数据统计目录已按分组名归并 ${renamed} 个`);
    }
    return renamed;
  } catch (e) {
    console.warn("[account-migration] 数据统计目录归并失败（不影响使用）:", e && e.message);
    return 0;
  }
}

/**
 * @returns {{ changed: number, skipped: boolean }}
 */
export function ensureAccountRecordsMigrated() {
  if (migrated) return { changed: 0, skipped: true };
  migrated = true;
  migrateStatsGroupDirs();
  let changed = 0;
  try {
    const result = changeData({
      fileName: "account",
      type: "get",
      item: { page: 1, pageSize: 9999 },
    });
    const data = (result && result.data) || {};
    for (const dateKey of Object.keys(data)) {
      const rows = data[dateKey] || [];
      for (const row of rows) {
        if (!normalizeAccountRecordFields(row)) continue;
        const res = changeData({
          fileName: "account",
          type: "update",
          item: {
            id: row.id,
            date: row.date || dateKey,
            group: row.group,
            accountName: row.accountName,
            accountKey: row.accountKey,
          },
        });
        if (res && res.success !== false) changed += 1;
      }
    }
    if (changed > 0) {
      console.log(`[account-migration] 已为 ${changed} 条账号记录补齐分组新字段`);
    }
  } catch (e) {
    // 迁移失败不阻断启动：所有读取路径对缺新字段的记录都有 phone 前缀回退
    console.warn(
      "[account-migration] 账号记录迁移失败（按历史规则回退运行）:",
      e && e.message
    );
  }
  return { changed, skipped: false };
}
