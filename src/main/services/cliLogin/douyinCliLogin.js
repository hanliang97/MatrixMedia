"use strict";

import { BrowserWindow, app } from "electron";
import pie from "puppeteer-in-electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import ptConfig from "../../config/ptConfig";
import {
  clearTerminalScreen,
  paintLoginQrToTerminalFromPuppeteerPage,
} from "./terminalQrFromCapture.js";
import {
  hasDouyinSession,
  normalizeDouyinPartition,
} from "./douyinSessionUtil.js";
import {
  CLI_LOGIN_QR_FIRST_DELAY_MS,
  CLI_LOGIN_QR_REFRESH_MS,
} from "./cliLoginQrRefresh.js";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

/**
 * CLI：打开抖音创作者首页，轮询 passport_assist_user（与 getCookie 逻辑一致）
 * 终端二维码：puppeteer-in-electron 的 Page.screenshot（CDP），与 cli publish 同一套 Electron 分区与环境，无需屏外窗口。
 * @param {{ partition: string, show: boolean, terminalQr: boolean, timeoutMs: number, saveQrPngPath?: string | null, puppeteerHeadless?: boolean }} opts
 * @returns {Promise<number>} 退出码
 */
export async function runDouyinCliLogin({
  partition,
  show,
  terminalQr,
  timeoutMs,
  saveQrPngPath = null,
  puppeteerHeadless = false,
}) {
  const cfg = ptConfig.抖音;
  if (!cfg) {
    console.error("内部错误: 未找到抖音 ptConfig");
    return 1;
  }

  const part = normalizeDouyinPartition(partition);

  if (puppeteerHeadless) {
    const { runDouyinPuppeteerHeadlessLogin } = await import(
      "./douyinPuppeteerHeadlessLogin.js"
    );
    return runDouyinPuppeteerHeadlessLogin({
      partition: part,
      terminalQr,
      timeoutMs,
      saveQrPngPath,
    });
  }

  if (await hasDouyinSession(part)) {
    console.log("抖音：当前 partition 已存在登录 Cookie（passport_assist_user），无需再次登录。");
    return 0;
  }

  const useTerminalQr = Boolean(terminalQr && process.stdout.isTTY);
  if (terminalQr && !process.stdout.isTTY) {
    console.warn(
      "提示: stdout 非 TTY，无法绘制终端二维码方块图。可改用 --puppeteer-headless、--save-qr-png，或在有显示环境用 xvfb-run 等。"
    );
  }
  if (!useTerminalQr && !show) {
    console.error("错误: 当前环境无法使用终端二维码且未指定 --show，无法继续登录。");
    return 2;
  }

  return await new Promise(resolve => {
    let settled = false;
    let pollTimer = null;
    let qrTimer = null;
    let deadlineTimer = null;
    /** @type {import("puppeteer").Browser | null} */
    let pieBrowser = null;
    /** @type {import("puppeteer").Page | null} */
    let piePage = null;
    /** @type {import("electron").BrowserWindow | null} */
    let win = null;

    /**
     * @param {number} code
     * @param {{ clearTerminal?: boolean, log?: string }} [opts]
     */
    const finish = (code, opts = {}) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (qrTimer) clearInterval(qrTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      try {
        if (pieBrowser && typeof pieBrowser.disconnect === "function") {
          pieBrowser.disconnect();
        }
      } catch (_) {
        // 忽略
      }
      pieBrowser = null;
      piePage = null;
      try {
        if (win && !win.isDestroyed()) {
          win.removeAllListeners("closed");
          win.close();
        }
      } catch (_) {
        // 忽略关窗异常
      }
      win = null;
      if (opts.clearTerminal && useTerminalQr && process.stdout.isTTY) {
        clearTerminalScreen();
      }
      if (opts.log) {
        console.log(opts.log);
      }
      resolve(code);
    };

    const winWidth = 1100;
    const winHeight = 820;

    (async () => {
      try {
        pieBrowser = await pie.connect(app, puppeteer);
      } catch (e) {
        console.error("无法连接 Puppeteer-in-Electron（终端扫码依赖 CDP）:", e.message);
        finish(1, {});
        return;
      }

      win = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        show: Boolean(show),
        paintWhenInitiallyHidden: true,
        autoHideMenuBar: true,
        skipTaskbar: true,
        focusable: Boolean(show),
        hasShadow: false,
        webPreferences: {
          partition: part,
          nodeIntegration: false,
          contextIsolation: true,
          devTools: Boolean(show),
          backgroundThrottling: false,
        },
      });

      win.on("closed", () => {
        if (!settled) {
          console.error("登录窗口已关闭，未完成登录检测。");
          finish(3, {});
        }
      });

      if (cfg.useragent) {
        win.webContents.setUserAgent(cfg.useragent);
      }

      try {
        await win.loadURL(cfg.index);
      } catch (err) {
        console.error("加载抖音创作者页失败:", err);
        finish(1, {});
        return;
      }

      try {
        piePage = await pie.getPage(pieBrowser, win);
      } catch (e) {
        console.error("无法取得 Puppeteer Page（须在加载 URL 后附加）:", e.message);
        finish(1, {});
        return;
      }

      if (show) {
        win.show();
        win.focus();
      }

      const paintOpts = { partitionLabel: part, saveQrPngPath };

      if (useTerminalQr) {
        console.log(
          "正在加载抖音登录页，随后在终端刷新黑白方块扫码图（每 " +
            CLI_LOGIN_QR_REFRESH_MS / 1000 +
            "s，Electron CDP）… partition:",
          part
        );
        if (saveQrPngPath) {
          console.log("同时将截取区域写入 PNG:", saveQrPngPath);
        }
        qrTimer = setInterval(() => {
          if (settled || !piePage) return;
          paintLoginQrToTerminalFromPuppeteerPage(piePage, paintOpts).catch(() => {});
        }, CLI_LOGIN_QR_REFRESH_MS);
        setTimeout(() => {
          if (!settled && piePage) {
            paintLoginQrToTerminalFromPuppeteerPage(piePage, paintOpts).catch(() => {});
          }
        }, CLI_LOGIN_QR_FIRST_DELAY_MS);
      } else if (show) {
        console.log("请在浏览器窗口中完成抖音登录。partition:", part);
      }

      pollTimer = setInterval(() => {
        hasDouyinSession(part)
          .then(ok => {
            if (ok && !settled) {
              finish(0, {
                clearTerminal: true,
                log: "抖音登录成功，会话已写入 partition，可执行 cli publish。",
              });
            }
          })
          .catch(e => {
            console.error("轮询 Cookie 失败:", e.message);
          });
      }, 2000);

      deadlineTimer = setTimeout(() => {
        if (!settled) {
          console.error(
            `登录等待超时（${Math.round(timeoutMs / 1000)}s），仍未检测到 passport_assist_user。`
          );
          finish(3, {});
        }
      }, timeoutMs);
    })().catch(e => {
      console.error("抖音 CLI 登录初始化失败:", e.message);
      finish(1, {});
    });
  });
}

export { hasDouyinSession };
