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
            finish(ok ? 0 : 3);
          } else if (channel === "puppeteer-noLogin") {
            if (payload && payload.taskId != null && payload.taskId !== taskId) {
              return;
            }
            console.error("登录态异常或未登录:", JSON.stringify(payload));
            if (payload && payload.pt === "抖音") {
              console.error("提示: 可先执行 cli login -p dy --phone <手机号> 在本机完成扫码登录。");
            }
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
