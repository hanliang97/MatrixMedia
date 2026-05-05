"use strict";

import path from "path";
import { getCliSubArgv, isCliMode } from "./detectArgv";
import { parsePublishArgs, publishHelpText } from "./parsePublishArgs";
import { parseLoginArgs, loginHelpText } from "./parseLoginArgs";
import { parseAccountsArgs, accountsHelpText } from "./parseAccountsArgs";
import { parseHistoryArgs, historyHelpText } from "./parseHistoryArgs";
import { runAccountsCli } from "./runAccountsCli";
import { runHistoryCli } from "./runHistoryCli";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "../services/puppeteerFile";
import { runDouyinCliLogin } from "../services/cliLogin/douyinCliLogin";
import { changeData } from "../server/utils";
import { createScheduledRecord } from "../services/scheduledPublish";

export {
  isCliMode,
  getCliSubArgv,
  parsePublishArgs,
  publishHelpText,
  parseLoginArgs,
  loginHelpText,
  parseAccountsArgs,
  accountsHelpText,
  parseHistoryArgs,
  historyHelpText,
};

function fileStem(filePath) {
  const base = path.basename(filePath || "");
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

function todayYmd() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
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
 * @returns {Promise<number>} 进程退出码
 */
export async function runCliMain(argv = process.argv) {
  const sub = getCliSubArgv(argv);
  if (!sub || sub.length === 0) {
    console.error("用法: <应用> cli <publish|login|accounts|history> ...");
    console.error("  cli publish --help");
    console.error("  cli login --help");
    console.error("  cli accounts --help");
    console.error("  cli history --help");
    return 2;
  }

  const cmd = sub[0];
  if (cmd === "login") {
    const parsed = parseLoginArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(loginHelpText());
      return 0;
    }
    const v = parsed.value;
    try {
      return await runDouyinCliLogin({
        partition: v.partition,
        show: v.show,
        terminalQr: v.terminalQr,
        timeoutMs: v.timeoutSec * 1000,
        saveQrPngPath: v.saveQrPng || null,
        puppeteerHeadless: v.puppeteerHeadless,
      });
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "publish") {
    const parsed = parsePublishArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(publishHelpText());
      return 0;
    }

    const v = parsed.value;
    const cfg = ptConfig[v.platform];
    if (!cfg) {
      console.error("内部错误: 未找到平台配置", v.platform);
      return 2;
    }

    const resolvedFile = path.resolve(v.file);
    const stem = fileStem(resolvedFile);
    const bt1 = String(v.title).trim();
    const bt2 = (v.bt2 && String(v.bt2).trim()) || bt1;
    const bookName = (v.bookName && String(v.bookName).trim()) || stem;

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
        address: String(v.address || "").trim(),
      },
      url: cfg.upload,
      show: v.show,
      mmCliSuppressWindow: true,
      closeWindowAfterPublish: v.show ? v.closeWindowAfterPublish : true,
      useragent: cfg.useragent,
      partition: v.partition,
      filePath: resolvedFile,
      pt: v.platform,
    };

    const taskId = taskPayload.taskId;
    const CLI_PUBLISH_TIMEOUT_MS = 35 * 60 * 1000;

    // 与 GUI LocalVideoPublish.buildVideoPayload / handleBatchPublish 的 pushData 写入保持一致，
    // 使 cli publish 的记录同时出现在 GUI 视频管理与 `cli history`。
    const recordDate = todayYmd();
    const selectedFile = path.basename(resolvedFile);
    const recordItem = {
      bookName,
      textOtherName: stem,
      textType: "local",
      pt: v.platform,
      selectedFile,
      bt: bt1,
      bt2,
      bq: String(v.bq || "").trim(),
      address: String(v.address || "").trim(),
      filePath: resolvedFile,
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
      publishStatus: "publishing",
      lastPublishMessage: "等待发布结果",
      lastPublishAt: Date.now(),
    };

    if (v.publishAt) {
      let scheduledRecord;
      try {
        scheduledRecord = createScheduledRecord(recordItem, v.publishAt);
      } catch (e) {
        console.error(e && e.message ? e.message : e);
        return 2;
      }
      try {
        const addRes = changeData({ fileName: "pushData", type: "add", item: scheduledRecord });
        let recordId = null;
        if (addRes && addRes.success && Array.isArray(addRes.data)) {
          const found = [...addRes.data].reverse().find(
            it =>
              it.scheduledTask === true &&
              it.scheduledPublishAt === scheduledRecord.scheduledPublishAt &&
              it.textOtherName === scheduledRecord.textOtherName &&
              it.pt === scheduledRecord.pt &&
              it.selectedFile === scheduledRecord.selectedFile &&
              it.textType === scheduledRecord.textType
          );
          if (found) recordId = found.id;
        }
        console.log(
          JSON.stringify({
            status: true,
            scheduled: true,
            id: recordId,
            publishAt: scheduledRecord.scheduledPublishAtText,
            message: "定时发布任务已创建，已写入发布历史",
          })
        );
        return 0;
      } catch (e) {
        console.error("MatrixMedia: 写入定时发布记录失败:", e && e.message);
        return 1;
      }
    }

    let recordId = null;
    try {
      const addRes = changeData({ fileName: "pushData", type: "add", item: recordItem });
      if (addRes && addRes.success && Array.isArray(addRes.data)) {
        const found = [...addRes.data].reverse().find(
          it =>
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

    return await new Promise(resolve => {
      let settled = false;
      const finish = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code);
      };

      const timer = setTimeout(() => {
        console.error("CLI publish 超时（35 分钟），请检查网络或登录态");
        updateRecord("failed", "CLI publish 超时 35 分钟");
        finish(1);
      }, CLI_PUBLISH_TIMEOUT_MS);

      const transport = {
        reply(channel, payload) {
          if (channel === "puppeteerFile-done") {
            if (payload && payload.taskId != null && payload.taskId !== taskId) {
              return;
            }
            const ok = payload && payload.status === true;
            console.log(JSON.stringify({ channel, status: ok, message: payload && payload.message }));
            updateRecord(ok ? "success" : "failed", (payload && payload.message) || (ok ? "上传成功" : "上传失败"));
            finish(ok ? 0 : 3);
          } else if (channel === "puppeteer-noLogin") {
            if (payload && payload.taskId != null && payload.taskId !== taskId) {
              return;
            }
            console.error("登录态异常或未登录:", JSON.stringify(payload));
            if (payload && payload.pt === "抖音") {
              console.error("提示: 可先执行 cli login -p dy --phone <手机号> 在本机完成扫码登录。");
            }
            updateRecord("failed", "登录态异常或未登录");
            finish(3);
          } else {
            console.log(channel, payload);
          }
        },
      };

      runPuppeteerTask(taskPayload, transport, () => {});
    });
  }

  if (cmd === "accounts") {
    const parsed = parseAccountsArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(accountsHelpText());
      return 0;
    }
    try {
      return await runAccountsCli(parsed.value);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "history") {
    const parsed = parseHistoryArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(historyHelpText());
      return 0;
    }
    try {
      return runHistoryCli(parsed.value);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "--help" || cmd === "-h") {
    console.log("可用子命令: publish | login | accounts | history");
    console.log("各自 --help 查看详细参数。");
    return 0;
  }

  console.error("未知子命令:", cmd);
  console.error("支持: publish | login | accounts | history");
  return 2;
}
