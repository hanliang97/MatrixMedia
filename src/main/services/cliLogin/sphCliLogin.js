"use strict";

import { BrowserWindow, app, session as electronSession } from "electron";
import pie from "puppeteer-in-electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { nativeImage } from "electron";
import ptConfig from "../../config/ptConfig";
import {
  clearTerminalScreen,
  nativeImageToTerminalQrLines,
} from "./qrBitmapToBlocks.js";
import { cliLoginQrTerminalBlockWidth } from "./cliLoginQrRefresh.js";
import {
  tryDecodeQrPayloadFromNativeImage,
  renderQrPayloadWithQrcodeTerminal,
  writeLoginQrPngFile,
} from "./terminalQrQrcodeTerminal.js";
import {
  hasSphSession,
  getSphSessionId,
  normalizeSphPartition,
} from "./sphSessionUtil.js";
import { applyAccountProxyForTask } from "../proxyConfig.js";
import {
  CLI_LOGIN_QR_FIRST_DELAY_MS,
  CLI_LOGIN_QR_REFRESH_MS,
} from "./cliLoginQrRefresh.js";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

function cliQrDebugLog(...args) {
  const v = process.env.MATRIX_CLI_QR_DEBUG;
  if (
    v === undefined ||
    v === null ||
    String(v).trim() === "" ||
    String(v).trim() === "0"
  ) {
    return;
  }
  console.error("[MatrixMedia][cli-qr][sph]", ...args);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

/* ---- iframe 内二维码选择器（按优先级排列） ---- */
const QR_SELECTORS_IN_IFRAME = [
  "img.qrcode", // 视频号登录页二维码：<img class="qrcode" src="data:...">
  ".qrcode-wrap img.qrcode",
  ".qrcode-wrap img",
  ".login-qrcode-wrap img",
  ".qrcode-iframe-wrap img",
  ".qrcode img",
  "img[class*='qrcode']",
  "img[class*='qr']",
  "canvas",
  "img",
];

/** 视频号登录 iframe 的 URL 特征 */
const LOGIN_IFRAME_URL_PATTERN = "login-for-iframe";

/**
 * 在所有 frame（含主 frame）中查找二维码 img 截图。
 * 视频号登录页的 QR 可能在 login-for-iframe 子 frame 里，也可能直接在主 frame 的 #app 下。
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ buf: Buffer, fromDataUrl: boolean } | null>}
 */
async function captureQrFromIframe(page) {
  try {
    if (typeof page.isClosed === "function" && page.isClosed()) return null;
  } catch (_) {
    return null;
  }

  const frames = page.frames();
  cliQrDebugLog(
    "当前 frame 数量:",
    frames.length,
    frames.map((f) => f.url())
  );

  // 优先检查子 frame（login-for-iframe），再检查主 frame
  const sortedFrames = [
    ...frames.filter((f) => f !== page.mainFrame()),
    page.mainFrame(),
  ];

  for (const frame of sortedFrames) {
    const isMain = frame === page.mainFrame();
    const frameUrl = frame.url();
    cliQrDebugLog("--- 检查", isMain ? "主 frame:" : "子 frame:", frameUrl);

    // dump body 帮助调试（加深到 8 层）
    try {
      const bodySnippet = await frame.evaluate(() => {
        if (!document.body) return "(no body)";
        const imgs = Array.from(document.querySelectorAll("img")).map(
          (el) =>
            `<img class="${el.className}" src="${String(el.src).slice(
              0,
              80
            )}" ${el.offsetWidth}x${el.offsetHeight}>`
        );
        const canvases = Array.from(document.querySelectorAll("canvas")).map(
          (el) =>
            `<canvas class="${el.className}" ${el.offsetWidth}x${el.offsetHeight}>`
        );
        const qrEls = Array.from(
          document.querySelectorAll(
            "[class*='qr'],[class*='QR'],[class*='Qr'],[id*='qr']," +
              "[class*='qrcode'],[class*='login-qrcode'],[class*='qrcode-wrap']"
          )
        ).map(
          (el) =>
            `<${el.tagName.toLowerCase()} class="${el.className}" ${
              el.offsetWidth
            }x${el.offsetHeight}>`
        );
        const app = document.querySelector("#app");
        let appTree = "(no #app)";
        if (app) {
          const walk = (node, depth) => {
            if (depth > 8) return "";
            const tag = node.tagName ? node.tagName.toLowerCase() : "";
            const cls =
              node.className && typeof node.className === "string"
                ? "." + node.className.split(/\s+/).join(".")
                : "";
            const kids = Array.from(node.children || [])
              .map((c) => walk(c, depth + 1))
              .filter(Boolean)
              .join(",");
            return tag + cls + (kids ? "[" + kids + "]" : "");
          };
          appTree = walk(app, 0);
        }
        return JSON.stringify({
          imgs,
          canvases,
          qrEls,
          bodyLen: document.body.innerHTML.length,
          appTree: appTree.slice(0, 3000),
        });
      });
      cliQrDebugLog("frame 结构:", bodySnippet);
    } catch (e) {
      cliQrDebugLog("dump frame 失败:", e && e.message);
      continue;
    }

    // 逐个尝试选择器
    for (const sel of QR_SELECTORS_IN_IFRAME) {
      try {
        const handle = await frame.$(sel);
        if (!handle) continue;

        const info = await frame.evaluate((el) => {
          return {
            tag: el.tagName,
            cls: el.className || "",
            src: el.src ? String(el.src).slice(0, 120) : null,
            w: el.offsetWidth,
            h: el.offsetHeight,
          };
        }, handle);
        cliQrDebugLog("选择器命中:", sel, "=>", JSON.stringify(info));

        // 跳过 SVG sprite / logo 等无意义元素
        if (info.tag === "IMG" && (!info.src || info.w < 10 || info.h < 10))
          continue;
        // 跳过明显不是 QR 的图片（logo 等非正方形大图）
        if (
          info.tag === "IMG" &&
          sel === "img" &&
          info.cls &&
          !info.cls.match(/qr/i) &&
          Math.abs(info.w - info.h) > 50
        )
          continue;

        // data: URL 直接解码
        if (info.src && info.src.startsWith("data:")) {
          const fullSrc = await frame.evaluate((el) => el.src, handle);
          const comma = fullSrc.indexOf(",");
          if (comma > 0) {
            const b64 = fullSrc.slice(comma + 1);
            const buf = Buffer.from(b64, "base64");
            if (buf.length > 32) {
              cliQrDebugLog("从 data: URL 解码成功，字节:", buf.length);
              return { buf, fromDataUrl: true };
            }
          }
        }

        // http(s) URL 的 img 且尺寸合理 —— 用 elementHandle.screenshot
        if (info.w > 30 && info.h > 30) {
          try {
            const buf = await handle.screenshot({ type: "png" });
            if (buf && buf.length > 32) {
              cliQrDebugLog("elementHandle.screenshot 成功，字节:", buf.length);
              return { buf, fromDataUrl: false };
            }
          } catch (e) {
            cliQrDebugLog("elementHandle.screenshot 失败:", e && e.message);
          }
        }
      } catch (e) {
        cliQrDebugLog("选择器", sel, "在 frame 中失败:", e && e.message);
      }
    }
  }

  // 最终回退 —— 全页截图
  try {
    cliQrDebugLog("最终回退: 全页截图");
    const buf = await page.screenshot({ type: "png" });
    if (buf && buf.length > 32) return { buf, fromDataUrl: false };
  } catch (e) {
    cliQrDebugLog("全页截图失败:", e && e.message);
  }

  return null;
}

/**
 * 将截图写入终端
 */
async function writeSphLoginQrToStdout(image, opts) {
  if (!process.stdout.isTTY) return;
  const { width } = image.getSize();
  const termW = cliLoginQrTerminalBlockWidth(width);

  const skipDecode =
    process.env.MATRIX_CLI_QR_NO_DECODE &&
    String(process.env.MATRIX_CLI_QR_NO_DECODE).trim() !== "" &&
    String(process.env.MATRIX_CLI_QR_NO_DECODE).trim() !== "0";
  const payload = skipDecode ? null : tryDecodeQrPayloadFromNativeImage(image);

  let bodyLines;
  let modeHint;
  if (payload) {
    const art = await renderQrPayloadWithQrcodeTerminal(payload);
    bodyLines = art.split(/\n/);
    modeHint = "（jsQR + qrcode-terminal）";
    cliQrDebugLog("QR 已解码，payload 长度:", payload.length);
  } else {
    cliQrDebugLog("jsQR 未识别，使用栅格回退");
    bodyLines = nativeImageToTerminalQrLines(image, termW);
    modeHint = opts.srcHint || "（栅格）";
  }

  const visualW = Math.max(
    28,
    ...bodyLines.map((l) => stripAnsi(l).length),
    termW
  );
  const barLen = Math.min(visualW, 76);
  const bar = "-".repeat(barLen);

  clearTerminalScreen();
  process.stdout.write(
    `\x1b[0m视频号扫码登录 ${modeHint}  partition: ${opts.partitionLabel}\n${bar}\n\n`
  );
  for (const line of bodyLines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write(
    `\n${bar}\n请用微信扫描二维码登录视频号；保存图: --save-qr-png；终端异常可试 --show。\n`
  );
}

/**
 * 从 iframe 截取二维码并输出到终端 / 保存 PNG
 */
async function paintSphLoginQr(page, opts) {
  if (!process.stdout.isTTY && !opts.saveQrPngPath) return;

  const captured = await captureQrFromIframe(page);
  if (!captured || !captured.buf || !captured.buf.length) return;

  const { buf, fromDataUrl } = captured;
  const image = nativeImage.createFromBuffer(buf);
  if (!image || image.isEmpty()) return;

  const { width, height } = image.getSize();
  if (!width || !height) return;

  if (opts.saveQrPngPath) {
    try {
      writeLoginQrPngFile({
        image,
        saveQrPngPath: opts.saveQrPngPath,
        rawBuf: buf,
        fromDataUrl,
      });
    } catch (e) {
      console.error("写入 --save-qr-png 失败:", e.message);
    }
  }

  if (process.stdout.isTTY) {
    await writeSphLoginQrToStdout(image, {
      partitionLabel: opts.partitionLabel,
      srcHint: "（iframe 截图）",
    });
  }
}

/**
 * CLI：打开视频号创作者首页，轮询 sessionid Cookie
 * @param {{ partition: string, show: boolean, terminalQr: boolean, timeoutMs: number, saveQrPngPath?: string | null }} opts
 * @returns {Promise<number>} 退出码
 */
export async function runSphCliLogin({
  partition,
  show,
  terminalQr,
  timeoutMs,
  saveQrPngPath = null,
  phone = null,
  force = false,
}) {
  const cfg = ptConfig.视频号;
  if (!cfg) {
    console.error("内部错误: 未找到视频号 ptConfig");
    return 1;
  }

  const part = normalizeSphPartition(partition);
  console.log(
    "[sph-cli-login] 原始 partition:",
    partition,
    "=> 实际使用:",
    part
  );

  // 与 GUI open-account-login-window 保持一致：先应用代理配置
  try {
    await applyAccountProxyForTask({ partition: part, phone, pt: "视频号" });
  } catch (proxyErr) {
    console.warn("[sph-cli-login] 应用代理失败:", proxyErr && proxyErr.message);
  }

  // 记住旧 sessionid，轮询时检测到不同值才算"新登录成功"
  // 不清除 cookie，避免破坏 login-for-iframe 页面加载
  const oldSessionId = await getSphSessionId(part);
  if (oldSessionId) {
    console.log("[sph-cli-login] 检测到旧 sessionid，将等待新的登录会话");
  }

  const useTerminalQr = Boolean(terminalQr && process.stdout.isTTY);
  if (terminalQr && !process.stdout.isTTY) {
    console.warn(
      "提示: stdout 非 TTY，无法绘制终端二维码方块图。可改用 --save-qr-png，或在有显示环境用 xvfb-run 等。"
    );
  }
  if (!useTerminalQr && !show) {
    console.error(
      "错误: 当前环境无法使用终端二维码且未指定 --show，无法继续登录。"
    );
    return 2;
  }

  /** @type {import("puppeteer").Browser | null} */
  let pieBrowser = null;
  /** @type {import("puppeteer").Page | null} */
  let piePage = null;

  return await new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let qrTimer = null;
    let deadlineTimer = null;
    /** @type {import("electron").BrowserWindow | null} */
    let win = null;

    const finish = async (code, opts = {}) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (qrTimer) clearInterval(qrTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);

      // 登录成功时，先将 Cookie / Storage 刷盘，再关窗口
      // 否则新 BrowserWindow 读同一 partition 时可能拿不到最新数据
      if (code === 0) {
        try {
          const ses = electronSession.fromPartition(part);
          await ses.cookies.flushStore();
          ses.flushStorageData();
        } catch (_) {}
      }

      try {
        if (pieBrowser && typeof pieBrowser.disconnect === "function") {
          pieBrowser.disconnect();
        }
      } catch (_) {}
      pieBrowser = null;
      piePage = null;
      try {
        if (win && !win.isDestroyed()) {
          win.removeAllListeners("closed");
          win.close();
        }
      } catch (_) {}
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
        console.error(
          "无法连接 Puppeteer-in-Electron（终端扫码依赖 CDP）:",
          e.message
        );
        finish(1, {});
        return;
      }

      // 窗口配置与 GUI open-account-login-window 完全一致
      // 唯一区别：非 --show 时 opacity=0，窗口不可见但 Chromium 正常渲染
      win = new BrowserWindow({
        width: 1200,
        height: 800,
        opacity: show ? 1 : 0,
        title: `视频号登录 ${part}`,
        autoHideMenuBar: true,
        webPreferences: {
          partition: part,
          nodeIntegration: false,
          contextIsolation: true,
          webviewTag: false,
          devTools: true,
        },
      });

      win.on("closed", () => {
        if (!settled) {
          console.error("登录窗口已关闭，未完成登录检测。");
          finish(3, {});
        }
      });

      try {
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      } catch (_) {}

      // 先获取 piePage，通过 CDP Network.setUserAgentOverride 设置 UA
      // 这是唯一能覆盖所有请求（含 iframe）的方式
      // session.setUserAgent / webContents.setUserAgent / webRequest 都无法覆盖 iframe
      try {
        piePage = await pie.getPage(pieBrowser, win);
      } catch (e) {
        console.error("无法取得 Puppeteer Page:", e.message);
        finish(1, {});
        return;
      }

      if (cfg.useragent) {
        try {
          await piePage.setUserAgent(cfg.useragent);
          cliQrDebugLog("CDP UA 已设置:", cfg.useragent.slice(0, 60));
        } catch (e) {
          console.warn(
            "[sph-cli-login] piePage.setUserAgent 失败:",
            e && e.message
          );
        }
      }

      // UA 设置完毕后再导航
      try {
        await piePage
          .goto(cfg.index, { waitUntil: "domcontentloaded", timeout: 30000 })
          .catch(() => {});
      } catch (e) {
        console.warn(
          "[sph-cli-login] 导航失败（可能是重定向）:",
          e && e.code,
          e && e.message
        );
      }

      // 等待重定向后的登录页 + iframe 加载完成
      await new Promise((r) => setTimeout(r, 8000));

      if (show) {
        win.focus();
      }

      const paintOpts = { partitionLabel: part, saveQrPngPath };

      if (useTerminalQr) {
        console.log(
          "正在加载视频号登录页，随后在终端刷新扫码图（每 " +
            CLI_LOGIN_QR_REFRESH_MS / 1000 +
            "s）… partition:",
          part
        );
        if (saveQrPngPath) {
          console.log("同时将截取区域写入 PNG:", saveQrPngPath);
        }
        qrTimer = setInterval(() => {
          if (settled || !piePage) return;
          paintSphLoginQr(piePage, paintOpts).catch(() => {});
        }, CLI_LOGIN_QR_REFRESH_MS);
        // 首次延迟稍长，等 iframe 加载
        setTimeout(() => {
          if (!settled && piePage) {
            paintSphLoginQr(piePage, paintOpts).catch(() => {});
          }
        }, CLI_LOGIN_QR_FIRST_DELAY_MS);
      } else if (show) {
        console.log("请在浏览器窗口中完成视频号登录。partition:", part);
      }

      // 轮询 sessionid Cookie —— 检测到与旧值不同的新 sessionid 才算登录成功
      pollTimer = setInterval(() => {
        getSphSessionId(part)
          .then((newId) => {
            if (!newId || settled) return;
            // 无旧值 → 新出现即可；有旧值 → 必须不同
            if (!oldSessionId || newId !== oldSessionId) {
              finish(0, {
                clearTerminal: true,
                log: "视频号登录成功，会话已写入 partition，可执行 cli publish。",
              });
            }
          })
          .catch((e) => {
            console.error("轮询 Cookie 失败:", e.message);
          });
      }, 2000);

      deadlineTimer = setTimeout(() => {
        if (!settled) {
          console.error(
            `登录等待超时（${Math.round(
              timeoutMs / 1000
            )}s），仍未检测到 sessionid。`
          );
          finish(3, {});
        }
      }, timeoutMs);
    })().catch((e) => {
      console.error("视频号 CLI 登录初始化失败:", e.message);
      finish(1, {});
    });
  });
}

export { hasSphSession };
