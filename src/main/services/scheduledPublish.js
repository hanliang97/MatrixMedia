"use strict";

import fs from "fs";
import path from "path";
import { ipcMain } from "electron";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "./puppeteerFile";
import { changeData } from "../server/utils";

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
  const nums = m.slice(1).map(v => Number(v));
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

export function createScheduledRecord(recordItem, publishAtText, nowMs = Date.now()) {
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
        tags: record.bq || record.tags || "前端 electron",
        summary: record.summary || "",
      },
      textOtherName: record.textOtherName || record.bt || "",
      selectedFile: record.selectedFile || path.basename(record.articleFilePath || record.filePath || ""),
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
  return {
    taskId: Date.now() + Math.random(),
    bookName: record.bookName || record.textOtherName || "",
    textType: record.textType || "local",
    data: {
      textOtherName: record.textOtherName || "",
      bt1: record.bt || "",
      bt2: record.bt2 || record.bt || "",
      bq: record.bq || "",
      bdText: "",
      address: record.address || "",
    },
    textOtherName: record.textOtherName || "",
    selectedFile: record.selectedFile || path.basename(record.filePath || ""),
    url: record.uploadUrl || cfg.upload || record.url,
    show: false,
    mmCliSuppressWindow: true,
    closeWindowAfterPublish: true,
    useragent: record.useragent || cfg.useragent,
    partition: record.partition,
    filePath: record.filePath,
    pt: record.pt,
    phone: record.phone,
    date: record.date,
  };
}

function updateRecord(record, patch) {
  if (!record || !record.id || !record.date) return;
  changeData({
    fileName: "pushData",
    type: "update",
    item: {
      id: record.id,
      date: record.date,
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
  Object.keys(data).forEach(date => {
    (data[date] || []).forEach(item => {
      if (item && item.scheduledTask === true && item.publishStatus === "scheduled") {
        rows.push({ ...item, date: item.date || date });
      }
    });
  });
  return rows;
}

function finishScheduledRecord(record, payload) {
  const ok = payload && payload.status === true;
  updateRecord(record, {
    publishStatus: ok ? "success" : "failed",
    publishSuccessCount: ok ? 1 : 0,
    publishFailCount: ok ? 0 : 1,
    lastPublishMessage: (payload && payload.message) || (ok ? "发布成功" : "发布失败"),
    lastPublishAt: Date.now(),
  });
}

function executeScheduledRecord(record) {
  if (!record || !record.id) return;
  if (record.textType !== "article" && (!record.filePath || !fs.existsSync(record.filePath))) {
    updateRecord(record, {
      publishStatus: "failed",
      publishFailCount: 1,
      lastPublishMessage: "本地视频文件不存在",
      lastPublishAt: Date.now(),
    });
    return;
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
  const taskPayload = buildTaskPayloadFromRecord(record);
  const taskId = taskPayload.taskId;
  updateRecord(record, {
    publishStatus: "publishing",
    lastPublishMessage: "定时任务开始发布",
    lastPublishAt: Date.now(),
  });
  const transport = {
    reply(channel, payload) {
      if (payload && payload.taskId != null && payload.taskId !== taskId) return;
      if (channel === "puppeteerFile-done") {
        finishScheduledRecord(record, payload);
      } else if (channel === "puppeteer-noLogin") {
        updateRecord(record, {
          publishStatus: "failed",
          publishFailCount: 1,
          lastPublishMessage: "登录态异常或未登录",
          lastPublishAt: Date.now(),
        });
      }
    },
  };
  runPuppeteerTask(taskPayload, transport, () => {});
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
  const delay = Math.min(Number(record.scheduledPublishAt) - nowMs, MAX_TIMER_DELAY_MS);
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
  listScheduledRecords().forEach(record => {
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
  scheduledTimers.forEach(timer => clearTimeout(timer));
  scheduledTimers.clear();
  schedulerStarted = false;
}
