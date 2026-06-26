"use strict";

import path from "path";
import { normalizeCreativeStatement } from "../../shared/creativeStatement.js";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "./puppeteerFile";
import { changeData } from "../server/utils";
import { createScheduledRecord } from "./scheduledPublish";
import { CLI_PUBLISH_TIMEOUT_MS } from "./upLoad/uploadTimeouts.js";
import {
  isRemotePublishFile,
  resolvePublishFile,
  guessFileNameFromUrl,
} from "./resolvePublishFile";
import { resolveAccountPublishMode } from "./accountPublishSettingsResolver.js";

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
  const stem = fileStemFromSource(sourceFile);
  const bt1 = String(v.title).trim();
  const bt2 = (v.bt2 && String(v.bt2).trim()) || bt1;
  const bookName = (v.bookName && String(v.bookName).trim()) || stem;

  let cleanupDownload = null;
  let resolvedFile = sourceFile;
  const deferRemoteDownload =
    !fileContext && v.publishAt && isRemotePublishFile(sourceFile);

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
        bt1,
        bt2,
        bookName,
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
  { sourceFile, resolvedFile, stem, bt1, bt2, bookName },
  options = {}
) {
  // 结合「请求显式 draft」与账号「默认发布到草稿」设置，算出最终发布模式
  const effectivePublishMode = resolveAccountPublishMode({
    phone: derivePhoneForRecord(v),
    pt: v.platform,
    requestDraftMode: Boolean(v.draft),
  });

  const taskPayload = {
    taskId: Date.now() + Math.random(),
    bookName,
    textType: "local",
    data: {
      textOtherName: stem,
      bt1,
      bt2,
      bq: String(v.bq || "").trim(),
      bdText: "",
      creativeStatement: normalizeCreativeStatement(v.creativeStatement || ""),
    },
    url: cfg.upload,
    show: v.show,
    mmCliSuppressWindow: false,
    publishMode: effectivePublishMode.publishMode,
    publishToDraft: effectivePublishMode.publishToDraft,
    closeWindowAfterPublish: v.show ? v.closeWindowAfterPublish : true,
    useragent: cfg.useragent,
    partition: v.partition,
    phone: derivePhoneForRecord(v),
    filePath: resolvedFile,
    pt: v.platform,
  };

  const taskId = taskPayload.taskId;
  const recordDate = todayYmd();
  const selectedFile = isRemotePublishFile(sourceFile)
    ? guessFileNameFromUrl(sourceFile)
    : path.basename(resolvedFile);
  const recordItem = {
    bookName,
    textOtherName: stem,
    textType: "local",
    pt: v.platform,
    selectedFile,
    bt: bt1,
    bt2,
    bq: String(v.bq || "").trim(),
    creativeStatement: normalizeCreativeStatement(v.creativeStatement || ""),
    filePath:
      v.publishAt && isRemotePublishFile(sourceFile)
        ? sourceFile
        : resolvedFile,
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
    publishStatus: effectivePublishMode.publishToDraft ? "drafting" : "publishing",
    lastPublishMessage: effectivePublishMode.publishToDraft
      ? "等待保存草稿结果"
      : "等待发布结果",
    lastPublishAt: Date.now(),
  };

  if (v.publishAt) {
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

  const updateRecord = (status, message) => {
    if (!recordId) return;
    try {
      changeData({
        fileName: "pushData",
        type: "update",
        item: {
          id: recordId,
          date: recordDate,
          publishStatus: status,
          publishSuccessCount: status === "success" ? 1 : 0,
          publishFailCount: status === "failed" ? 1 : 0,
          lastPublishMessage: message || "",
          lastPublishAt: Date.now(),
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
      const message = `发布超时（${min} 分钟），请检查网络或登录态`;
      console.error(message);
      updateRecord("failed", message);
      finish({ exitCode: 1, status: "failed", message, id: recordId });
    }, CLI_PUBLISH_TIMEOUT_MS);

    const transport = {
      reply(channel, payload) {
        if (channel === "puppeteerFile-done") {
          if (payload && payload.taskId != null && payload.taskId !== taskId) {
            return;
          }
          if (payload && payload.skipped) {
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
          const ok = payload && payload.status === true;
          const message =
            (payload && payload.message) || (ok ? "上传成功" : "上传失败");
          updateRecord(ok ? "success" : "failed", message);
          finish({
            exitCode: ok ? 0 : 3,
            status: ok ? "success" : "failed",
            message,
            id: recordId,
          });
        } else if (channel === "puppeteer-noLogin") {
          if (payload && payload.taskId != null && payload.taskId !== taskId) {
            return;
          }
          const message = "登录态异常或未登录";
          console.error("登录态异常或未登录:", JSON.stringify(payload));
          updateRecord("failed", message);
          finish({ exitCode: 3, status: "failed", message, id: recordId });
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
  const allScheduled = parsedList.every((item) => item.publishAt);
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
  const releaseSharedDownload = () => {
    pendingCleanupCount -= 1;
    if (pendingCleanupCount <= 0 && cleanupDownload) {
      cleanupDownload();
      cleanupDownload = null;
    }
  };

  try {
    for (const item of sortPublishPlatforms(parsedList)) {
      const result = await runSingleFilePublish(item, fileContext, {
        waitForResult: false,
        onDone: releaseSharedDownload,
      });
      results.push({
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
    if (results.length === 0 && cleanupDownload) cleanupDownload();
  }

  return {
    success: true,
    exitCode: 0,
    status: "submitted",
    message: `已提交 ${results.length} 个平台发布`,
    total: results.length,
    succeeded: 0,
    failed: 0,
    results,
  };
}
