"use strict";

import fs from "fs";
import path from "path";
import { ipcMain } from "electron";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "./puppeteerFile";
import { changeData } from "../server/utils";
import { normalizeCreativeStatement } from "../../shared/creativeStatement.js";
import { isRemotePublishFile, resolvePublishFile } from "./resolvePublishFile";
import { normalizeVideoRecordMetadata } from "../../shared/videoMetadata.js";
import { scheduledKey } from "./scheduledDedupe.js";
import { resolvePublishCompletion, resolvePublishProgress } from "../../shared/publishResult.js";

const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 1000;
const scheduledTimers = new Map();
let schedulerStarted = false;
let refreshInterval = null;

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayYmd(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateParts(value) {
  const text = String(value || "").trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    return { ok: false, error: "定时发布时间格式应为 YYYY-MM-DD HH:mm:ss" };
  }
  const nums = m.slice(1).map((v) => Number(v));
  const [year, month, day, hour, minute, second] = nums;
  const dt = new Date(year, month - 1, day, hour, minute, second, 0);
  const valid =
    dt.getFullYear() === year &&
    dt.getMonth() === month - 1 &&
    dt.getDate() === day &&
    dt.getHours() === hour &&
    dt.getMinutes() === minute &&
    dt.getSeconds() === second;
  if (!valid) {
    return { ok: false, error: "定时发布时间不是有效日期" };
  }
  return { ok: true, text, value: dt.getTime() };
}

export function parsePublishAt(value, nowMs = Date.now()) {
  const parsed = parseDateParts(value);
  if (!parsed.ok) return parsed;
  if (parsed.value <= nowMs) {
    return { ok: false, error: "定时发布时间必须是未来时间" };
  }
  return { ok: true, value: parsed.value, text: parsed.text };
}

export function createScheduledRecord(
  recordItem,
  publishAtText,
  nowMs = Date.now()
) {
  const parsed = parsePublishAt(publishAtText, nowMs);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return {
    ...recordItem,
    date: recordItem.date || todayYmd(nowMs),
    scheduledTask: true,
    scheduledPublishAt: parsed.value,
    scheduledPublishAtText: parsed.text,
    publishStatus: "scheduled",
    publishAttemptCount: Number(recordItem.publishAttemptCount) || 1,
    republishCount: Number(recordItem.republishCount) || 0,
    publishSuccessCount: Number(recordItem.publishSuccessCount) || 0,
    publishFailCount: Number(recordItem.publishFailCount) || 0,
    lastPublishMessage: "等待定时发布",
    lastPublishAt: nowMs,
  };
}

export function isExpiredScheduledRecord(record, nowMs = Date.now()) {
  return (
    !!record &&
    record.scheduledTask === true &&
    record.publishStatus === "scheduled" &&
    Number(record.scheduledPublishAt) <= nowMs
  );
}

export function buildTaskPayloadFromRecord(record) {
  const cfg = ptConfig[record.pt] || {};
  if (record.textType === "article") {
    return {
      taskId: Date.now() + Math.random(),
      bookName: record.bookName || record.textOtherName || "",
      textType: "article",
      data: {
        title: record.bt || record.textOtherName || "",
        content: record.content || "",
        articleFilePath: record.articleFilePath || record.filePath || "",
        coverPath: record.coverPath || "",
        category: record.category || "前端",
        tags: record.bq || record.tags || "前端 Electron",
        summary: record.summary || "",
      },
      textOtherName: record.textOtherName || record.bt || "",
      selectedFile:
        record.selectedFile ||
        path.basename(record.articleFilePath || record.filePath || ""),
      url: record.uploadUrl || cfg.upload || record.url,
      show: false,
      mmCliSuppressWindow: true,
      closeWindowAfterPublish: true,
      useragent: record.useragent || cfg.useragent,
      partition: record.partition,
      pt: record.pt,
      phone: record.phone,
      date: record.date,
      coverPath: record.coverPath || "",
    };
  }
  const metadata = normalizeVideoRecordMetadata(record);
  return {
    taskId: Date.now() + Math.random(),
    bookName: record.bookName || record.textOtherName || "",
    textType: record.textType || "local",
    data: {
      textOtherName: record.textOtherName || "",
      title: metadata.title,
      description: metadata.description,
      shortTitle: metadata.shortTitle,
      tags: metadata.tags,
      ...metadata.legacy,
      creativeStatement: normalizeCreativeStatement(record.creativeStatement),
      // 定时视频发布透传封面（dy/ks/sph 读 data.data.coverPath，
      // 缺失会静默跳过自定义封面；文章分支一直有传，视频分支上游漏了）
      coverPath: record.coverPath || "",
    },
    textOtherName: record.textOtherName || "",
    selectedFile: record.selectedFile || path.basename(record.filePath || ""),
    url: record.uploadUrl || cfg.upload || record.url,
    show: false,
    mmCliSuppressWindow: false,
    publishMode: record.publishMode || "publish",
    publishToDraft: record.publishMode === "draft",
    publishOptions: record.publishOptions || {},
    closeWindowAfterPublish: true,
    useragent: record.useragent || cfg.useragent,
    partition: record.partition,
    filePath: record.filePath,
    pt: record.pt,
    phone: record.phone,
    date: record.date,
  };
}

function updateRecord(record, patch, isFinal = true) {
  if (!record || !record.id || !record.date) return;
  return changeData({
    fileName: "pushData",
    type: "update",
    expectedTaskId: record.taskId,
    item: {
      id: record.id,
      date: record.date,
      publishSettled: isFinal,
      ...patch,
    },
  });
}

function listScheduledRecords() {
  const result = changeData({
    fileName: "pushData",
    type: "get",
    item: {
      page: 1,
      pageSize: 10000,
    },
  });
  const data = (result && result.data) || {};
  const rows = [];
  Object.keys(data).forEach((date) => {
    (data[date] || []).forEach((item) => {
      if (
        item &&
        item.scheduledTask === true &&
        item.publishStatus === "scheduled"
      ) {
        rows.push({ ...item, date: item.date || date });
      }
    });
  });
  return rows;
}

function finishScheduledRecord(record, payload) {
  if (payload && payload.skipped) {
    updateRecord(record, {
      publishStatus: "skipped",
      publishSettled: true,
      publishSuccessCount: 0,
      publishFailCount: 0,
      lastPublishMessage:
        (payload && payload.message) || "用户关闭窗口，已跳过发布",
      lastPublishAt: Date.now(),
    });
    return;
  }
  const completion = resolvePublishCompletion(payload);
  const succeeded = ["success", "draft"].includes(completion.recordStatus);
  // 失败/异常时主进程已在发布页截了图，落库后视频管理里可点开回看
  const failScreenshot =
    (payload && payload.failScreenshot) || record.failScreenshot;
  updateRecord(record, {
    publishStatus: completion.recordStatus,
    publishSettled: true,
    publishSuccessCount: succeeded ? 1 : 0,
    publishFailCount: ["failed", "login_required"].includes(completion.recordStatus) ? 1 : 0,
    publishAbnormalCount: completion.recordStatus === "abnormal" ? 1 : 0,
    ...(succeeded ? {} : { failScreenshot }),
    lastPublishMessage: completion.message,
    lastPublishAt: Date.now(),
  });
}

function executeScheduledRecord(record) {
  if (!record || !record.id) return;
  executeScheduledRecordAsync(record).catch((e) => {
    console.error("[scheduledPublish] 执行定时发布失败:", e && e.message);
    updateRecord(record, {
      publishStatus: "failed",
      publishFailCount: 1,
      lastPublishMessage: (e && e.message) || "定时发布执行失败",
      lastPublishAt: Date.now(),
    });
  });
}

async function executeScheduledRecordAsync(record) {
  if (!record || !record.id) return;

  let cleanupDownload = null;
  let publishFilePath = record.filePath;

  if (record.textType !== "article") {
    if (!publishFilePath) {
      updateRecord(record, {
        publishStatus: "failed",
        publishFailCount: 1,
        lastPublishMessage: "本地视频文件不存在",
        lastPublishAt: Date.now(),
      });
      return;
    }

    if (isRemotePublishFile(publishFilePath)) {
      try {
        const resolved = await resolvePublishFile(publishFilePath);
        publishFilePath = resolved.localPath;
        cleanupDownload = resolved.cleanup;
      } catch (e) {
        updateRecord(record, {
          publishStatus: "failed",
          publishFailCount: 1,
          lastPublishMessage: `下载视频失败: ${e && e.message ? e.message : e}`,
          lastPublishAt: Date.now(),
        });
        return;
      }
    } else if (!fs.existsSync(publishFilePath)) {
      updateRecord(record, {
        publishStatus: "failed",
        publishFailCount: 1,
        lastPublishMessage: "本地视频文件不存在",
        lastPublishAt: Date.now(),
      });
      return;
    }
  }

  if (
    record.textType === "article" &&
    !String(record.content || "").trim() &&
    (!record.articleFilePath || !fs.existsSync(record.articleFilePath))
  ) {
    updateRecord(record, {
      publishStatus: "failed",
      publishFailCount: 1,
      lastPublishMessage: "文章正文文件不存在",
      lastPublishAt: Date.now(),
    });
    return;
  }

  try {
    const taskPayload = buildTaskPayloadFromRecord({
      ...record,
      filePath: publishFilePath,
    });
    const taskId = taskPayload.taskId;
    const started = updateRecord(record, {
      publishStatus: "publishing",
      taskId,
      publishSettled: false,
      lastPublishMessage: "定时任务开始发布",
      lastPublishAt: Date.now(),
    });
    if (!started || !started.success) return;
    const activeRecord = { ...record, taskId };

    await new Promise((resolve) => {
      let publishSettled = false;
      const finish = () => {
        if (publishSettled) return;
        publishSettled = true;
        resolve();
      };
      const transport = {
        reply(channel, payload) {
          if (publishSettled) return;
          if (payload && payload.taskId != null && payload.taskId !== taskId)
            return;
          if (channel === "puppeteerFile-progress") {
            if (!payload || payload.taskId !== taskId) return;
            const progress = resolvePublishProgress(payload);
            if (!progress) return;
            updateRecord(activeRecord, {
              publishStatus: progress.recordStatus,
              lastPublishMessage: progress.message,
              lastPublishAt: Date.now(),
            }, false);
          } else if (channel === "puppeteerFile-done") {
            finishScheduledRecord(activeRecord, payload);
            finish();
          } else if (channel === "puppeteer-noLogin") {
            // 登录失效单独标状态：任务本身没错，补扫码后可重新排期
            updateRecord(activeRecord, {
              publishStatus: "login_required",
              publishSettled: true,
              publishFailCount: Number(record.publishFailCount || 0) + 1,
              lastPublishMessage:
                "登录态失效，需重新扫码登录后重排（本次未发布）",
              lastPublishAt: Date.now(),
            });
            finish();
          }
        },
      };
      runPuppeteerTask(taskPayload, transport, () => {});
    });
  } finally {
    if (cleanupDownload) cleanupDownload();
  }
}

export function schedulePublishRecord(record, nowMs = Date.now()) {
  if (!record || !record.id || record.publishStatus !== "scheduled") return;
  const key = `${record.date || ""}:${record.id}`;
  if (scheduledTimers.has(key)) {
    clearTimeout(scheduledTimers.get(key));
    scheduledTimers.delete(key);
  }
  if (isExpiredScheduledRecord(record, nowMs)) {
    updateRecord(record, {
      publishStatus: "expired",
      lastPublishMessage: "任务过期，未执行发布",
      lastPublishAt: nowMs,
    });
    return;
  }
  const delay = Math.min(
    Number(record.scheduledPublishAt) - nowMs,
    MAX_TIMER_DELAY_MS
  );
  const timer = setTimeout(() => {
    scheduledTimers.delete(key);
    if (Number(record.scheduledPublishAt) > Date.now()) {
      schedulePublishRecord(record);
      return;
    }
    executeScheduledRecord(record);
  }, delay);
  scheduledTimers.set(key, timer);
}

export function refreshScheduledPublishScheduler() {
  const nowMs = Date.now();
  // 同一轮触发里同一任务只处理一次：历史数据里可能存在同键重复记录
  // （isDuplicate 不覆盖 scheduledTask），这里做兜底防止双发。
  const inFlight = new Set();
  listScheduledRecords().forEach((record) => {
    const key = scheduledKey(record);
    if (key && inFlight.has(key)) {
      console.warn(`[scheduled] 同键任务已在本轮处理，跳过重复记录: ${key}`);
      return;
    }
    if (key) inFlight.add(key);
    schedulePublishRecord(record, nowMs);
  });
}

export function startScheduledPublishScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  refreshScheduledPublishScheduler();
  refreshInterval = setInterval(() => {
    refreshScheduledPublishScheduler();
  }, REFRESH_INTERVAL_MS);
}

export function registerScheduledPublishIpc() {
  ipcMain.on("scheduledPublish:refresh", () => {
    refreshScheduledPublishScheduler();
  });
}

export function stopScheduledPublishScheduler() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  scheduledTimers.forEach((timer) => clearTimeout(timer));
  scheduledTimers.clear();
  schedulerStarted = false;
}
