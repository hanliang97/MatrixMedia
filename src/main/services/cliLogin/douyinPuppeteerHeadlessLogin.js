"use strict";

import fs from "fs";
import path from "path";
import { nativeImage, session } from "electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import ptConfig from "../../config/ptConfig";
import {
  getDouyinLoginCaptureRectFromPuppeteerPage,
  tryReadAnimateQrImageBufferFromPage,
  writeDouyinLoginQrToStdout,
} from "./terminalQrFromCapture.js";
import { clearTerminalScreen } from "./qrBitmapToBlocks.js";
import { hasDouyinSession, normalizeDouyinPartition } from "./douyinSessionUtil.js";
import {
  CLI_LOGIN_QR_FIRST_DELAY_MS,
  CLI_LOGIN_QR_REFRESH_MS,
} from "./cliLoginQrRefresh.js";

function cliQrDebugLog(...args) {
  const v = process.env.MATRIX_CLI_QR_DEBUG;
  if (v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "0") {
    return;
  }
  console.error("[MatrixMedia][cli-qr]", ...args);
}

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const CREATOR_ORIGIN = "https://creator.douyin.com";

function resolveChromiumExecutable() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.MATRIX_CHROMIUM_PATH;
  if (env && fs.existsSync(env)) {
    return env;
  }
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
          ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * @param {import("puppeteer").Page} page
 * @param {{ partitionLabel: string, saveQrPngPath?: string | null, drawTerminalBlocks?: boolean }} opts
 */
async function refreshLoginQrFromPuppeteerPage(page, opts) {
  const drawTerminalBlocks = Boolean(opts.drawTerminalBlocks && process.stdout.isTTY);
  if (!drawTerminalBlocks && !opts.saveQrPngPath) {
    return;
  }
  let fromBase64 = await tryReadAnimateQrImageBufferFromPage(page);
  let buf = fromBase64;
  if (!buf || !buf.length) {
    cliQrDebugLog("无头模式：将使用 CDP 截图");
    try {
      const rect = await getDouyinLoginCaptureRectFromPuppeteerPage(page);
      if (rect) {
        buf = await page.screenshot({
          type: "png",
          clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
      } else {
        buf = await page.screenshot({ type: "png" });
      }
    } catch (e) {
      cliQrDebugLog("截图失败:", e && e.message);
      return;
    }
  }
  if (!buf || !buf.length) {
    return;
  }
  let image = nativeImage.createFromBuffer(buf);
  if (!image || image.isEmpty()) {
    cliQrDebugLog("nativeImage 无法解析，回退截图");
    fromBase64 = null;
    try {
      const rect = await getDouyinLoginCaptureRectFromPuppeteerPage(page);
      if (rect) {
        buf = await page.screenshot({
          type: "png",
          clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
      } else {
        buf = await page.screenshot({ type: "png" });
      }
      image = nativeImage.createFromBuffer(buf);
    } catch (e) {
      cliQrDebugLog("回退截图失败:", e && e.message);
      return;
    }
  }
  if (!image || image.isEmpty()) {
    return;
  }
  const { width, height } = image.getSize();
  if (!width || !height) {
    return;
  }
  if (opts.saveQrPngPath) {
    try {
      const out = path.resolve(opts.saveQrPngPath);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      if (fromBase64) {
        fs.writeFileSync(out, fromBase64);
      } else {
        fs.writeFileSync(out, image.toPNG());
      }
    } catch (e) {
      console.error("写入 --save-qr-png 失败:", e.message);
    }
  }
  if (!drawTerminalBlocks) {
    return;
  }
  await writeDouyinLoginQrToStdout(image, {
    partitionLabel: opts.partitionLabel,
    srcHint: fromBase64 ? "（页面 base64 栅格）" : "（无头截图栅格）",
  });
}

async function hasPassportCookieOnPage(page) {
  const cookies = await page.cookies(CREATOR_ORIGIN);
  return cookies.some(c => c.name === "passport_assist_user" && c.value);
}

/**
 * 使用系统 Chrome/Chromium 无头启动，userDataDir 与 Electron partition 一致，便于与 GUI / publish 共用 Cookie。
 * @param {{ partition: string, terminalQr: boolean, timeoutMs: number, saveQrPngPath?: string | null }} opts
 * @returns {Promise<number>}
 */
export async function runDouyinPuppeteerHeadlessLogin({
  partition,
  terminalQr,
  timeoutMs,
  saveQrPngPath = null,
}) {
  const cfg = ptConfig.抖音;
  if (!cfg) {
    console.error("内部错误: 未找到抖音 ptConfig");
    return 1;
  }
  const part = normalizeDouyinPartition(partition);
  if (await hasDouyinSession(part)) {
    console.log("抖音：当前 partition 已存在登录 Cookie（passport_assist_user），无需再次登录。");
    return 0;
  }

  const useTerminalQr = Boolean(terminalQr && process.stdout.isTTY);
  if (terminalQr && !process.stdout.isTTY) {
    console.warn("提示: stdout 非 TTY，无法在终端绘制方块图；请使用 --save-qr-png 查看二维码 PNG。");
  }
  if (!useTerminalQr && !saveQrPngPath) {
    console.error("错误: 无头模式须保留终端二维码（TTY）或指定 --save-qr-png。");
    return 2;
  }

  const ses = session.fromPartition(part);
  const userDataDir = ses.getStoragePath();
  if (!userDataDir) {
    console.error(
      "错误: 无法取得 partition 磁盘路径（仅 persist: 分区支持）。请使用 persist:手机号抖音 形式。"
    );
    return 2;
  }

  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    console.error(
      "错误: 未找到 Chrome/Chromium。请安装浏览器或设置环境变量 PUPPETEER_EXECUTABLE_PATH（或 MATRIX_CHROMIUM_PATH）为可执行文件路径。"
    );
    return 2;
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      userDataDir,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (e) {
    console.error("Puppeteer 启动失败（可能与 Electron 同时占用同一用户数据目录有关）:", e.message);
    return 1;
  }

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  if (cfg.useragent) {
    await page.setUserAgent(cfg.useragent);
  }
  await page.setViewport({ width: 1100, height: 820, deviceScaleFactor: 1 });

  const paintOpts = {
    partitionLabel: part,
    saveQrPngPath,
    drawTerminalBlocks: useTerminalQr,
  };

  try {
    await page.goto(cfg.index, { waitUntil: "networkidle2", timeout: 120000 });
  } catch (e) {
    console.error("加载抖音创作者页失败:", e.message);
    await browser.close().catch(() => {});
    return 1;
  }

  let settled = false;
  return await new Promise(resolve => {
    let pollTimer = null;
    let qrTimer = null;
    let deadlineTimer = null;
    const finish = async (code, opts = {}) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (qrTimer) clearInterval(qrTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      try {
        await browser.close();
      } catch (_) {
        // 忽略
      }
      if (opts.clearTerminal && useTerminalQr) {
        clearTerminalScreen();
      }
      if (opts.log) {
        console.log(opts.log);
      }
      resolve(code);
    };

    console.log("Puppeteer 无头登录中，partition 数据目录:", userDataDir);

    if (useTerminalQr || saveQrPngPath) {
      console.log(
        "正在刷新终端二维码 / save-qr-png（每 " +
          CLI_LOGIN_QR_REFRESH_MS / 1000 +
          "s）…"
      );
      pollTimer = setInterval(() => {
        if (settled) return;
        hasPassportCookieOnPage(page)
          .then(ok => {
            if (ok && !settled) {
              finish(0, {
                clearTerminal: useTerminalQr,
                log: "抖音登录成功，会话已写入 partition，可执行 cli publish。",
              });
            }
          })
          .catch(() => {});
      }, 2000);
      qrTimer = setInterval(() => {
        if (settled) return;
        refreshLoginQrFromPuppeteerPage(page, paintOpts).catch(() => {});
      }, CLI_LOGIN_QR_REFRESH_MS);
      setTimeout(() => {
        if (!settled) {
          refreshLoginQrFromPuppeteerPage(page, paintOpts).catch(() => {});
        }
      }, CLI_LOGIN_QR_FIRST_DELAY_MS);
    }

    deadlineTimer = setTimeout(() => {
      if (!settled) {
        console.error(
          `登录等待超时（${Math.round(timeoutMs / 1000)}s），仍未检测到 passport_assist_user。`
        );
        finish(3, {});
      }
    }, timeoutMs);
  });
}
