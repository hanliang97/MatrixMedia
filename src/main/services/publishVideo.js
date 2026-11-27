"use strict";

import fs from "fs";
import path from "path";
import { normalizeCreativeStatement } from "../../shared/creativeStatement.js";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "./puppeteerFile";
import { changeData } from "../server/utils";
import { createScheduledRecord } from "./scheduledPublish";
import { findExistingScheduled } from "./scheduledDedupe.js";
import { CLI_PUBLISH_TIMEOUT_MS } from "./upLoad/uploadTimeouts.js";
import {
  isRemotePublishFile,
  resolvePublishFile,
  guessFileNameFromUrl,
} from "./resolvePublishFile";
import { resolveAccountPublishMode } from "./accountPublishSettingsResolver.js";
import { resolveTaskPartition } from "./accountLookup.js";
import { resolvePublishCompletion } from "../../shared/publishResult.js";
import { normalizeVideoMetadata } from "../../shared/videoMetadata.js";
import { resolveVideoSchedule } from "../../shared/videoSchedule.js";

/** 读取全部 pushData 记录（跨日期平铺），用于定时任务查重 */
function listPushDataRecords() {
  try {
    const res = changeData({
      fileName: "pushData",
      type: "get",
      item: { page: 1, pageSize: 10000 },
    });
    const data = (res && res.data) || {};
    const rows = [];
    Object.keys(data).forEach((date) => {
      (data[date] || []).forEach((it) => {
        if (it) rows.push({ ...it, date: it.date || date });
      });
    });
    return rows;
  } catch (e) {
    console.warn("读取 pushData 失败，跳过定时任务查重:", e && e.message);
    return [];
  }
}

function fileStemFromSource(source) {
  const raw = String(source || "").trim();
  const base = isRemotePublishFile(raw)
    ? guessFileNameFromUrl(raw)
    : path.basename(path.resolve(raw));
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

function todayYmd() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function derivePhoneForRecord(v) {
  if (v.phone) return String(v.phone);
  if (!v.partition) return "";
  const stripped = String(v.partition).replace(/^persist:/, "");
  const idx = stripped.indexOf(v.platform);
  return idx > 0 ? stripped.slice(0, idx) : stripped;
}

/**
 * 提前校验封面文件（在视频上传/下载之前拦截，避免大文件白传一次）：
 * 文件必须存在；视频号仅收 jpg/png（上传控件 accept 限制）。
 * @returns {{ ok: true, coverPath: string } | { ok: false, message: string }}
 */
function resolveCoverPath(v) {
  if (!v.cover) return { ok: true, coverPath: "" };
  const coverPath = path.resolve(v.cover);
  if (!fs.existsSync(coverPath) || !fs.statSync(coverPath).isFile()) {
    return { ok: false, message: `封面文件不存在: ${coverPath}` };
  }
  if (v.platform === "视频号" && !/\.(jpe?g|png)$/i.test(coverPath)) {
    return {
      ok: false,
      message: `视频号封面仅支持 jpg/png 格式: ${coverPath}`,
    };
  }
  return { ok: true, coverPath };
}

/**
 * 单文件发布（与 cli publish 单文件模式一致）
 * @param {object} v parsePublishArgs 解析后的参数
 * @param {{ sourceFile: string, resolvedFile: string } | null} fileContext 多平台复用已下载文件时传入
 * @returns {Promise<{ exitCode: number, status?: string, scheduled?: boolean, id?: string|null, publishAt?: string, message?: string }>}
 */
export async function runSingleFilePublish(
  v,
  fileContext = null,
  options = {}
) {
  const cfg = ptConfig[v.platform];
  if (!cfg) {
    return {
      exitCode: 2,
      status: "failed",
      message: `内部错误: 未找到平台配置 ${v.platform}`,
    };
  }

  const sourceFile = String(v.file || "").trim();
  const requestedSchedule = resolveVideoSchedule(v);
  if (!requestedSchedule.ok) return { exitCode: 2, status: "failed", message: requestedSchedule.error };
  const stem = fileStemFromSource(sourceFile);
  const metadata = normalizeVideoMetadata(v, v.platform);
  const bookName = (v.bookName && String(v.bookName).trim()) || stem;

  // 封面文件在组装参数时就校验（存在性 / 视频号 jpg|png），失败早于视频下载与上传
  const cover = resolveCoverPath(v);
  if (!cover.ok) {
    return { exitCode: 2, status: "failed", message: cover.message };
  }
  const coverPath = cover.coverPath;

  let cleanupDownload = null;
  let resolvedFile = sourceFile;
  const deferRemoteDownload =
    !fileContext && requestedSchedule.mode === "local" && isRemotePublishFile(sourceFile);

  if (fileContext) {
    resolvedFile = fileContext.resolvedFile;
  } else if (!deferRemoteDownload) {
    try {
      const resolved = await resolvePublishFile(sourceFile);
      resolvedFile = resolved.localPath;
      cleanupDownload = resolved.cleanup;
    } catch (e) {
      return {
        exitCode: 1,
        status: "failed",
        message: `下载视频失败: ${e && e.message ? e.message : e}`,
      };
    }
  }

  try {
    return await runSingleFilePublishInner(
      v,
      cfg,
      {
        sourceFile,
        resolvedFile,
        stem,
        metadata,
        bookName,
        coverPath,
      },
      options
    );
  } finally {
    if (cleanupDownload) cleanupDownload();
  }
}

async function runSingleFilePublishInner(
  v,
  cfg,
  { sourceFile, resolvedFile, stem, metadata, bookName, coverPath = "" },
  options = {}
) {
  // 新分组模型：CLI/HTTP 传入的 partition 可能仍按历史「phone 前缀」规则拼出，
  // 这里按账号记录的 accountKey 重算标准 partition（未命中记录时原样保留）
  v.partition = resolveTaskPartition({
    partition: v.partition,
    phone: v.phone,
    pt: v.platform,
  });

  // 结合「请求显式 draft」与账号「默认发布到草稿」设置，算出最终发布模式
  const effectivePublishMode = resolveAccountPublishMode({
    phone: derivePhoneForRecord(v),
    pt: v.platform,
    partition: v.partition,
    requestDraftMode: Boolean(v.draft),
  });
  const schedule = resolveVideoSchedule({ ...v, draft: effectivePublishMode.publishToDraft });
  if (!schedule.ok) return { exitCode: 2, status: "failed", message: schedule.error };

  const taskPayload = {
    ...schedule.fields,
    taskId: Date.now() + Math.random(),
    bookName,
    textType: "local",
    data: {
      textOtherName: stem,
      title: metadata.title,
      description: metadata.description,
      shortTitle: metadata.shortTitle,
      tags: metadata.tags,
      ...metadata.legacy,
      creativeStatement: normalizeCreativeStatement(v.creativeStatement || ""),
      coverPath,
      noDownload: v.noDownload === true,
    },
    url: cfg.upload,
    show: v.show,
    mmCliSuppressWindow: false,
    publishMode: effectivePublishMode.publishMode,
    publishToDraft: effectivePublishMode.publishToDraft,
    publishOptions: v.publishOptions || {},
    closeWindowAfterPublish: v.show ? v.closeWindowAfterPublish : true,
    useragent: cfg.useragent,
    partition: v.partition,
    phone: derivePhoneForRecord(v),
    filePath: resolvedFile,
    remoteFileUrl: isRemotePublishFile(sourceFile) ? sourceFile : "",
    pt: v.platform,
    useRealBrowser: Boolean(v.useRealBrowser),
  };

  const taskId = taskPayload.taskId;
  const recordDate = todayYmd();
  const selectedFile = isRemotePublishFile(sourceFile)
    ? guessFileNameFromUrl(sourceFile)
    : path.basename(resolvedFile);
  const recordItem = {
    // 同素材历史会合并旧记录；立即发布/草稿必须显式清掉上次原生排期字段。
    ...schedule.fields,
    bookName,
    textOtherName: stem,
    textType: "local",
    pt: v.platform,
    selectedFile,
    bt: metadata.title,
    title: metadata.title,
    description: metadata.description,
    shortTitle: metadata.shortTitle,
    tags: metadata.tags,
    ...metadata.legacy,
    creativeStatement: normalizeCreativeStatement(v.creativeStatement || ""),
    coverPath,
    noDownload: v.noDownload === true,
    filePath:
      v.publishAt && isRemotePublishFile(sourceFile)
        ? sourceFile
        : resolvedFile,
    remoteFileUrl: isRemotePublishFile(sourceFile) ? sourceFile : "",
    useragent: cfg.useragent,
    phone: derivePhoneForRecord(v),
    partition: v.partition,
    url: cfg.listIndex,
    uploadUrl: cfg.upload,
    date: recordDate,
    publishAttemptCount: 1,
    republishCount: 0,
    publishSuccessCount: 0,
    publishFailCount: 0,
    publishMode: effectivePublishMode.publishMode,
    publishToDraft: effectivePublishMode.publishToDraft,
    publishOptions: v.publishOptions || {},
    publishStatus: effectivePublishMode.publishToDraft
      ? "drafting"
      : "publishing",
    lastPublishMessage: effectivePublishMode.publishToDraft
      ? "等待保存草稿结果"
      : "等待发布结果",
    lastPublishAt: Date.now(),
  };

  if (schedule.mode === "local") {
    let scheduledRecord;
    try {
      scheduledRecord = createScheduledRecord(recordItem, v.publishAt);
    } catch (e) {
      return {
        exitCode: 2,
        status: "failed",
        message: e && e.message ? e.message : String(e),
      };
    }
    try {
      // 查重：同一视频在同一时刻只允许一条待触发任务，
      // 否则重跑 --publish-at 会造出两条到期记录 → 触发时双发。
      const existing = findExistingScheduled(listPushDataRecords(), scheduledRecord);
      if (existing) {
        console.log(
          `[publish] 定时任务已存在（id=${existing.id}），跳过重复创建: ${scheduledRecord.scheduledPublishAtText}`
        );
        return {
          exitCode: 0,
          status: "scheduled",
          scheduled: true,
          duplicate: true,
          id: existing.id || null,
          publishAt: scheduledRecord.scheduledPublishAtText,
          message: "同一视频在该时间点的定时任务已存在，未重复创建",
        };
      }
      const addRes = changeData({
        fileName: "pushData",
        type: "add",
        item: scheduledRecord,
      });
      let recordId = null;
      if (addRes && addRes.success && Array.isArray(addRes.data)) {
        const found = [...addRes.data]
          .reverse()
          .find(
            (it) =>
              it.scheduledTask === true &&
              it.scheduledPublishAt === scheduledRecord.scheduledPublishAt &&
              it.textOtherName === scheduledRecord.textOtherName &&
              it.pt === scheduledRecord.pt &&
              it.selectedFile === scheduledRecord.selectedFile &&
              it.textType === scheduledRecord.textType
          );
        if (found) recordId = found.id;
      }
      return {
        exitCode: 0,
        status: "scheduled",
        scheduled: true,
        id: recordId,
        publishAt: scheduledRecord.scheduledPublishAtText,
        message: "定时发布任务已创建，已写入发布历史",
      };
    } catch (e) {
      return {
        exitCode: 1,
        status: "failed",
        message: `写入定时发布记录失败: ${e && e.message ? e.message : e}`,
      };
    }
  }

  let recordId = null;
  try {
    const addRes = changeData({
      fileName: "pushData",
      type: "add",
      item: recordItem,
    });
    if (addRes && addRes.success && Array.isArray(addRes.data)) {
      const found = [...addRes.data]
        .reverse()
        .find(
          (it) =>
            it.textOtherName === recordItem.textOtherName &&
            it.pt === recordItem.pt &&
            it.selectedFile === recordItem.selectedFile &&
            it.textType === recordItem.textType
        );
      if (found) recordId = found.id;
    }
  } catch (e) {
    console.error("MatrixMedia: 写入 pushData 初始记录失败:", e && e.message);
  }

  const updateRecord = (status, message, extra = {}) => {
    if (!recordId) return;
    try {
      changeData({
        fileName: "pushData",
        type: "update",
        item: {
          id: recordId,
          date: recordDate,
          publishStatus: status,
          publishSuccessCount:
            status === "success" || status === "draft" ? 1 : 0,
          // login_required 也是「本次没发出去」，必须计失败次数：
          // 否则 history/GUI 的失败判定（failCount>0 且 successCount=0）认不出来，
          // 记录会永远停在「发布中」。
          publishFailCount:
            status === "failed" || status === "login_required" ? 1 : 0,
          publishAbnormalCount: status === "abnormal" ? 1 : 0,
          lastPublishMessage: message || "",
          lastPublishAt: Date.now(),
          ...extra,
        },
      });
    } catch (e) {
      console.error("MatrixMedia: 更新 pushData 记录失败:", e && e.message);
    }
  };

  return await new Promise((resolve) => {
    const waitForResult = options.waitForResult !== false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof options.onDone === "function") {
        try {
          options.onDone(result);
        } catch (e) {
          console.error("MatrixMedia: 发布完成回调失败:", e && e.message);
        }
      }
      if (waitForResult) resolve(result);
    };

    const timer = setTimeout(() => {
      const min = Math.round(CLI_PUBLISH_TIMEOUT_MS / 60000);
      if (schedule.mode === "native") {
        const message = `原生排期超时（${min} 分钟），请到平台核对结果后再重试`;
        updateRecord("abnormal", message, { nativeScheduleVerified: false });
        finish({ exitCode: 4, status: "needs_attention", message, id: recordId,
          needsAttention: true, nativeScheduled: false, nativeScheduleVerified: false,
          publishAt: schedule.fields.scheduledPublishAtText,
          scheduledPublishAt: schedule.fields.scheduledPublishAt });
        return;
      }
      const message = `发布超时（${min} 分钟），请检查网络或登录态`;
      console.error(message);
      updateRecord("failed", message);
      finish({ exitCode: 1, status: "failed", message, id: recordId });
    }, CLI_PUBLISH_TIMEOUT_MS);

    const transport = {
      reply(channel, payload) {
        if (settled) return;
        if (channel === "puppeteerFile-done") {
          if (payload && payload.taskId != null && payload.taskId !== taskId) {
            return;
          }
          if (payload && payload.skipped && !payload.nativeSubmitAttempted) {
            const message = payload.message || "用户关闭窗口，已跳过发布";
            updateRecord("skipped", message);
            finish({
              exitCode: 0,
              status: "skipped",
              message,
              id: recordId,
            });
            return;
          }
          // 排期模式以请求为准：普通成功回执缺少排期字段时也不能当成发布成功。
          const completion = resolvePublishCompletion({ ...payload,
            ...(schedule.mode === "native" ? { nativeScheduleAt: schedule.fields.nativeScheduleAt } : {}),
          });
          updateRecord(completion.recordStatus, completion.message, {
            ...(schedule.mode === "native" ? {
              nativeScheduleVerified: completion.nativeScheduled === true,
              outcome: payload && payload.outcome,
            } : {}),
          });
          finish({
            exitCode: completion.exitCode,
            status: completion.status,
            message: completion.message,
            id: recordId,
            publishMode: completion.savedAsDraft ? "draft" : "publish",
            outcome: payload && payload.outcome,
            needsAttention: Boolean(completion.needsAttention || completion.fallbackDraft || completion.publishAbnormal),
            nativeScheduleVerified: schedule.mode === "native"
              ? completion.nativeScheduled === true : undefined,
            nativeScheduled: completion.nativeScheduled,
            ...(schedule.mode === "native" ? {
              publishAt: schedule.fields.scheduledPublishAtText,
              scheduledPublishAt: schedule.fields.scheduledPublishAt,
            } : {}),
            // 草稿保存结果校验字段（#42），供 CLI JSON 透传给 e2e/脚本消费；
            // undefined 时 JSON.stringify 自动省略，保持老版本输出兼容
            draftVerified: payload && payload.draftVerified,
            draftUrlUnchanged: payload && payload.draftUrlUnchanged,
          });
        } else if (channel === "puppeteer-noLogin") {
          if (payload && payload.taskId != null && payload.taskId !== taskId) {
            return;
          }
          const message = (payload && payload.message) || "登录态异常或未登录";
          console.error("登录态异常或未登录:", JSON.stringify(payload));
          // 登录失效不是内容失败：单独状态 + 退出码 5，便于流水线提示"先补登录"
          updateRecord("login_required", message);
          finish({
            exitCode: 5,
            status: "login_required",
            message,
            id: recordId,
            loginRequired: true,
          });
        }
      },
    };

    runPuppeteerTask(taskPayload, transport, () => {});
    if (!waitForResult) {
      resolve({
        exitCode: 0,
        status: "submitted",
        message: "已提交发布任务",
        id: recordId,
      });
    }
  });
}

function sortPublishPlatforms(list) {
  return [...list].sort((a, b) => {
    if (a.platform.includes("视频号")) return -1;
    if (b.platform.includes("视频号")) return 1;
    return 0;
  });
}

/**
 * 多平台顺序发布；远程视频只下载一次，全部完成后清理临时文件
 * @param {object[]} parsedList
 */
export async function runMultiPlatformPublish(parsedList) {
  if (!Array.isArray(parsedList) || parsedList.length === 0) {
    return {
      success: false,
      exitCode: 2,
      status: "failed",
      message: "平台列表为空",
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
    };
  }

  if (parsedList.length === 1) {
    const result = await runSingleFilePublish(parsedList[0]);
    return {
      ...result,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      status: result.status || (result.exitCode === 0 ? "success" : "failed"),
      message: result.message || "",
      id: result.id ?? null,
      publishAt: result.publishAt ?? null,
      scheduled: result.scheduled === true,
      total: 1,
      succeeded: result.exitCode === 0 ? 1 : 0,
      failed: result.exitCode === 0 ? 0 : 1,
      results: [
        {
          ...result,
          platform: parsedList[0].platform,
          phone: parsedList[0].phone || "",
          creativeStatement: parsedList[0].creativeStatement || "none",
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          status: result.status,
          message: result.message || "",
          id: result.id ?? null,
          publishAt: result.publishAt ?? null,
          scheduled: result.scheduled === true,
        },
      ],
    };
  }

  const sourceFile = String(parsedList[0].file || "").trim();
  const allScheduled = parsedList.every((item) => resolveVideoSchedule(item).mode === "local");
  const deferRemoteDownload = allScheduled && isRemotePublishFile(sourceFile);

  let cleanupDownload = null;
  let fileContext = null;

  if (!deferRemoteDownload) {
    try {
      const resolved = await resolvePublishFile(sourceFile);
      fileContext = {
        sourceFile,
        resolvedFile: resolved.localPath,
      };
      cleanupDownload = resolved.cleanup;
    } catch (e) {
      return {
        success: false,
        exitCode: 1,
        status: "failed",
        message: `下载视频失败: ${e && e.message ? e.message : e}`,
        total: parsedList.length,
        succeeded: 0,
        failed: parsedList.length,
        results: [],
      };
    }
  }

  const results = [];
  let pendingCleanupCount = parsedList.length;
  let startedCount = 0;
  const releaseSharedDownload = () => {
    pendingCleanupCount -= 1;
    if (pendingCleanupCount <= 0 && cleanupDownload) {
      cleanupDownload();
      cleanupDownload = null;
    }
  };

  try {
    for (const item of sortPublishPlatforms(parsedList)) {
      // 本地定时和前置校验失败不会进入上传队列，必须同样释放引用。
      // onDone 也可能同步触发，因此每个平台的释放回调只允许生效一次。
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseSharedDownload();
      };
      startedCount += 1;
      let result;
      try {
        result = await runSingleFilePublish(item, fileContext, {
          waitForResult: false,
          onDone: release,
        });
      } catch (error) {
        release();
        throw error;
      }
      if (result.status !== "submitted") release();
      results.push({
        ...result,
        platform: item.platform,
        phone: item.phone || "",
        creativeStatement: item.creativeStatement || "none",
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        status: result.status,
        message: result.message || "",
        id: result.id ?? null,
        publishAt: result.publishAt ?? null,
        scheduled: result.scheduled === true,
      });
      if (item.platform.includes("视频号")) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
  } finally {
    // 入口抛错时，仅释放尚未启动的平台；已入队任务仍持有文件直至回执。
    for (; startedCount < parsedList.length; startedCount += 1) releaseSharedDownload();
  }

  const rejected = results.filter((result) => !result.success).length;
  return {
    success: rejected === 0,
    exitCode: rejected ? 3 : 0,
    status: rejected ? "failed" : "submitted",
    message: `已提交 ${results.length - rejected} 个平台发布${rejected ? `，${rejected} 个提交失败` : ""}`,
    total: results.length,
    succeeded: 0,
    failed: rejected,
    results,
  };
}
