"use strict";

const fs = require("fs");
const path = require("path");

const REGISTRY_FILE_NAME = "active-publish-windows.json";
const DATA_DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
const DATA_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 默认孤儿任务超时阈值：4 小时 10 分钟（大于 CLI_PUBLISH_TIMEOUT_MS=4h）
const DEFAULT_ORPHAN_MAX_AGE_MS = (4 * 60 + 10) * 60 * 1000;
// 同日重发复用 id 时的防误覆盖窗口（新任务 lastPublishAt 晚于旧条目 startedAt + 15s）
const RETRY_GRACE_MS = 15 * 1000;

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  if (num === process.pid) return true;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === "EPERM");
  }
}

function writeJsonAtomic(filePath, data, { mode } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2, 8)}.tmp`;
  const opts = mode != null ? { encoding: "utf8", mode } : { encoding: "utf8" };
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), opts);
  fs.renameSync(tmpPath, filePath);
}

function formatLocalDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function candidateDatesForEntry(entry, pushDataDir) {
  const dates = new Set();
  if (entry && typeof entry.recordDate === "string" && DATA_DATE_RE.test(entry.recordDate)) {
    dates.add(entry.recordDate);
  }
  const startedAt = Number((entry && entry.startedAt) || 0);
  if (startedAt > 0) {
    const dayMs = 24 * 60 * 60 * 1000;
    dates.add(formatLocalDate(startedAt));
    dates.add(formatLocalDate(startedAt - dayMs));
    dates.add(formatLocalDate(startedAt + dayMs));
  }
  if (dates.size === 0 && pushDataDir && fs.existsSync(pushDataDir)) {
    try {
      const files = fs
        .readdirSync(pushDataDir)
        .filter((f) => DATA_DAY_FILE_RE.test(f))
        .sort()
        .reverse()
        .slice(0, 3);
      for (const f of files) dates.add(f.replace(".json", ""));
    } catch (_) {}
  }
  return [...dates];
}

function isInProgressStatus(record) {
  if (!record || typeof record !== "object") return false;
  const raw = String(record.publishStatus || "").toLowerCase();
  if (raw === "publishing" || raw === "drafting") return true;
  if (
    !raw &&
    !(Number(record.publishSuccessCount) > 0) &&
    !(Number(record.publishFailCount) > 0)
  ) {
    return true;
  }
  return false;
}

function matchRecordForEntry(record, entry) {
  if (!record || !entry) return false;
  if (entry.recordId) {
    return String(record.id || "") === String(entry.recordId);
  }
  if (!entry.pt || !entry.selectedFile) return false;
  if (String(record.pt || "") !== String(entry.pt)) return false;
  if (String(record.selectedFile || "") !== String(entry.selectedFile)) {
    return false;
  }
  if (entry.phone && String(record.phone || "") !== String(entry.phone)) {
    return false;
  }
  return true;
}

/**
 * 将已退出 PID 的窗口索引条目回写到 pushData（publishing/drafting → failed）。
 * 严格跳过仍由存活进程持有的 recordId，以及 lastPublishAt 晚于 entry.startedAt + 15s 的同日重发记录。
 */
function reconcileDeadEntriesToPushData({
  deadEntries = [],
  aliveEntries = [],
  activeLocalRecordIds = [],
  pushDataDir = "",
  nowMs = Date.now(),
} = {}) {
  let reconciled = 0;
  if (!pushDataDir || !Array.isArray(deadEntries) || deadEntries.length === 0) {
    return { reconciled };
  }
  if (!fs.existsSync(pushDataDir)) return { reconciled };

  const aliveRecordIds = new Set(
    [
      ...(Array.isArray(aliveEntries)
        ? aliveEntries.map((e) => e && e.recordId)
        : []),
      ...(activeLocalRecordIds ? [...activeLocalRecordIds] : []),
    ]
      .filter(Boolean)
      .map((id) => String(id))
  );

  for (const entry of deadEntries) {
    if (!entry) continue;
    if (entry.recordId && aliveRecordIds.has(String(entry.recordId))) {
      continue;
    }
    const dates = candidateDatesForEntry(entry, pushDataDir);
    const entryStartedAt = Number(entry.startedAt || 0);
    let matched = false;
    for (const dateStr of dates) {
      const dayFile = path.join(pushDataDir, `${dateStr}.json`);
      if (!fs.existsSync(dayFile)) continue;
      let list;
      try {
        list = JSON.parse(fs.readFileSync(dayFile, "utf8"));
      } catch (_) {
        continue;
      }
      if (!Array.isArray(list)) continue;

      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        if (!matchRecordForEntry(rec, entry)) continue;
        if (!isInProgressStatus(rec)) {
          matched = true;
          break;
        }
        if (rec.id && aliveRecordIds.has(String(rec.id))) {
          matched = true;
          break;
        }
        const recLastAt = Number(rec.lastPublishAt || 0);
        if (entryStartedAt > 0 && recLastAt > entryStartedAt + RETRY_GRACE_MS) {
          // 同日重发复用 id：新任务已在旧死进程之后启动，禁止误覆盖
          matched = true;
          break;
        }
        list[i] = {
          ...rec,
          publishStatus: "failed",
          publishFailCount: (Number(rec.publishFailCount) || 0) + 1,
          lastPublishMessage: `发布进程已异常退出（PID ${entry.pid || "未知"}），未收到完成回执`,
          lastPublishAt: nowMs,
        };
        changed = true;
        reconciled++;
        matched = true;
        break;
      }
      if (changed) {
        try {
          writeJsonAtomic(dayFile, list);
        } catch (err) {
          console.warn(
            "[publish-reconcile] 回写 pushData 失败:",
            err && err.message ? err.message : err
          );
        }
      }
      if (matched) break;
    }
  }

  return { reconciled };
}

/**
 * 综合巡检与修复陈旧的 publishing / drafting 记录：
 * 1) 依据 active-publish-windows.json 中已死亡 PID 精确回写对应 pushData 记录，并清理死条目；
 * 2) 兜底清理超过 maxAgeMs（默认 4h10m）且无存活窗口持有的孤儿 publishing / drafting 记录
 *    （仅处理带有明确时间戳 lastPublishAt / createTime > 0 的记录，保护无时间戳单测夹具）。
 */
function reconcileStalePushData({
  userDataDir = "",
  documentsDir = "",
  pushDataDir = "",
  activeLocalRecordIds = [],
  nowMs = Date.now(),
  maxAgeMs = DEFAULT_ORPHAN_MAX_AGE_MS,
} = {}) {
  const result = { deadReconciled: 0, orphanReconciled: 0, prunedRegistry: 0 };
  try {
    const effectiveUserDataDir = String(userDataDir || "");
    const effectiveDocsDir = String(documentsDir || "");
    const effectivePushDataDir =
      pushDataDir ||
      (effectiveDocsDir
        ? path.join(effectiveDocsDir, "MatrixMedia", "data", "pushData")
        : "");

    let aliveEntries = [];
    if (effectiveUserDataDir) {
      const regFile = path.join(effectiveUserDataDir, REGISTRY_FILE_NAME);
      if (fs.existsSync(regFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(regFile, "utf8"));
          const list = Array.isArray(parsed) ? parsed : [];
          const deadEntries = [];
          for (const e of list) {
            if (!e) continue;
            if (isPidAlive(e.pid)) aliveEntries.push(e);
            else deadEntries.push(e);
          }
          if (deadEntries.length > 0) {
            const r = reconcileDeadEntriesToPushData({
              deadEntries,
              aliveEntries,
              activeLocalRecordIds,
              pushDataDir: effectivePushDataDir,
              nowMs,
            });
            result.deadReconciled = r.reconciled;
            result.prunedRegistry = deadEntries.length;
            writeJsonAtomic(regFile, aliveEntries, { mode: 0o600 });
          }
        } catch (_) {}
      }
    }

    if (!effectivePushDataDir || !fs.existsSync(effectivePushDataDir)) {
      return result;
    }

    const aliveRecordIds = new Set(
      [
        ...aliveEntries.map((e) => e && e.recordId),
        ...(activeLocalRecordIds ? [...activeLocalRecordIds] : []),
      ]
        .filter(Boolean)
        .map((id) => String(id))
    );

    const dayFiles = fs
      .readdirSync(effectivePushDataDir)
      .filter((f) => DATA_DAY_FILE_RE.test(f))
      .sort()
      .reverse()
      .slice(0, 14);

    for (const fileName of dayFiles) {
      const fullPath = path.join(effectivePushDataDir, fileName);
      let list;
      try {
        list = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      } catch (_) {
        continue;
      }
      if (!Array.isArray(list)) continue;
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        if (!rec || typeof rec !== "object") continue;
        const st = String(rec.publishStatus || "").toLowerCase();
        if (st !== "publishing" && st !== "drafting") continue;
        if (rec.id && aliveRecordIds.has(String(rec.id))) continue;
        const ts = Number(rec.lastPublishAt || rec.createTime || 0);
        // 无时间戳的记录（如历史/测试夹具）不做龄期兜底，防止误改
        if (!(ts > 0)) continue;
        if (nowMs - ts <= maxAgeMs) continue;
        list[i] = {
          ...rec,
          publishStatus: "failed",
          publishFailCount: (Number(rec.publishFailCount) || 0) + 1,
          lastPublishMessage: "发布任务超时且无活跃发布窗口，已自动标记失败",
          lastPublishAt: nowMs,
        };
        changed = true;
        result.orphanReconciled++;
      }
      if (changed) {
        writeJsonAtomic(fullPath, list);
      }
    }
  } catch (err) {
    console.warn(
      "[publish-reconcile] 巡检陈旧发布记录失败:",
      err && err.message ? err.message : err
    );
  }
  return result;
}

module.exports = {
  DEFAULT_ORPHAN_MAX_AGE_MS,
  writeJsonAtomic,
  isPidAlive,
  reconcileDeadEntriesToPushData,
  reconcileStalePushData,
};
