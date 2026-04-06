"use strict";

import fs from "fs";
import path from "path";
import { nativeImage } from "electron";
import { clearTerminalScreen, nativeImageToTerminalQrLines } from "./qrBitmapToBlocks.js";
import { DOUYIN_LOGIN_RECT_SCRIPT } from "./douyinLoginRectScript.js";
import { cliLoginQrTerminalBlockWidth } from "./cliLoginQrRefresh.js";
import {
  tryDecodeQrPayloadFromNativeImage,
  renderQrPayloadWithQrcodeTerminal,
} from "./terminalQrQrcodeTerminal.js";

export { clearTerminalScreen, nativeImageToTerminalQrLines };
export { nativeImageToBlockLines, nativeImageToHalfBlockLines } from "./qrBitmapToBlocks.js";

function cliQrDebugEnabled() {
  const v = process.env.MATRIX_CLI_QR_DEBUG;
  return v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "0";
}

function cliQrDebugLog(...args) {
  if (cliQrDebugEnabled()) {
    console.error("[MatrixMedia][cli-qr]", ...args);
  }
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * 优先 jsQR 解码 + qrcode-terminal 按模块输出（与 OpenClaw 微信插件依赖一致）；失败则栅格回退。
 * @param {import("electron").NativeImage} image
 * @param {{ partitionLabel: string, srcHint: string }} opts
 */
export async function writeDouyinLoginQrToStdout(image, opts) {
  if (!process.stdout.isTTY) {
    return;
  }
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
    ...bodyLines.map(l => stripAnsi(l).length),
    termW
  );
  const barLen = Math.min(visualW, 76);
  const bar = "-".repeat(barLen);
  clearTerminalScreen();
  process.stdout.write(
    `\x1b[0m抖音扫码登录 ${modeHint}  partition: ${opts.partitionLabel}\n${bar}\n\n`
  );
  for (const line of bodyLines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write(
    `\n${bar}\n请用手机抖音扫描；保存图: --save-qr-png；终端异常可试 MATRIX_CLI_QR_TERMINAL_STYLE=ansi 或 --show。\n`
  );
}

let lastAnimateQrDiagAt = 0;

/** 页面内抖音动效二维码：#animate_qrcode_container 下 img（含 shadow 内）的 data: URL，或 canvas.toDataURL */
const ANIMATE_QR_BASE64_SCRIPT = `(function () {
  function firstImg(root) {
    if (!root || !root.querySelector) return null;
    var img = root.querySelector("img");
    if (img && img.src) return img;
    var sr = root.shadowRoot;
    if (!sr) return null;
    img = sr.querySelector("img");
    if (img && img.src) return img;
    var list = sr.querySelectorAll("img");
    for (var i = 0; i < list.length; i++) {
      if (list[i].src) return list[i];
    }
    return null;
  }
  function firstCanvas(root) {
    if (!root || !root.querySelector) return null;
    var c = root.querySelector("canvas");
    if (c) return c;
    var sr = root.shadowRoot;
    return sr ? sr.querySelector("canvas") : null;
  }
  function payloadFromDataUrl(src) {
    if (!src || String(src).indexOf("data:") !== 0) return null;
    var comma = String(src).indexOf(",");
    if (comma < 0) return null;
    return String(src).slice(comma + 1);
  }
  var host = document.getElementById("animate_qrcode_container");
  if (!host) return null;
  var img = firstImg(host);
  if (img) {
    var p = payloadFromDataUrl(img.src);
    if (p) return p;
  }
  var canvas = firstCanvas(host);
  if (canvas && canvas.width >= 32 && canvas.height >= 32) {
    try {
      var url = canvas.toDataURL("image/png");
      return payloadFromDataUrl(url);
    } catch (e) {}
  }
  return null;
})()`;

const ANIMATE_QR_DIAG_SCRIPT = `(function () {
  var host = document.getElementById("animate_qrcode_container");
  if (!host) return { host: false };
  var sh = !!host.shadowRoot;
  var im0 = host.querySelector("img");
  var im1 = sh ? host.shadowRoot.querySelector("img") : null;
  var cv0 = host.querySelector("canvas");
  var cv1 = sh ? host.shadowRoot.querySelector("canvas") : null;
  var el = im0 || im1;
  var head = el ? String(el.src || "").slice(0, 56) : "";
  return {
    host: true,
    shadow: sh,
    imgInLight: !!im0,
    imgInShadow: !!im1,
    canvas: !!(cv0 || cv1),
    srcHead: head,
  };
})()`;

/**
 * 读取动效容器的 base64 图片原始字节（一般为 PNG），无则 null。
 * @param {import("puppeteer").Page} page
 * @returns {Promise<Buffer | null>}
 */
export async function tryReadAnimateQrImageBufferFromPage(page) {
  try {
    if (typeof page.isClosed === "function" && page.isClosed()) {
      return null;
    }
    const b64 = await page.evaluate(ANIMATE_QR_BASE64_SCRIPT);
    if (!b64 || typeof b64 !== "string") {
      if (cliQrDebugEnabled() && Date.now() - lastAnimateQrDiagAt > 6000) {
        lastAnimateQrDiagAt = Date.now();
        try {
          const d = await page.evaluate(ANIMATE_QR_DIAG_SCRIPT);
          cliQrDebugLog("未取到 data URL，页面状态:", JSON.stringify(d));
        } catch (e) {
          cliQrDebugLog("诊断脚本失败:", e.message);
        }
      }
      return null;
    }
    const clean = b64.replace(/\s+/g, "").replace(/^["']|["']$/g, "");
    const buf = Buffer.from(clean, "base64");
    if (buf.length < 32) {
      cliQrDebugLog("base64 解码过短:", buf.length);
      return null;
    }
    cliQrDebugLog("已解码动效二维码，字节:", buf.length);
    return buf;
  } catch (e) {
    cliQrDebugLog("读取动效二维码 evaluate 异常:", e && e.message);
    return null;
  }
}

/**
 * @param {unknown} r
 * @returns {{ x: number; y: number; width: number; height: number } | null}
 */
function rectFromPageEval(r) {
  if (
    r &&
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number" &&
    r.width >= 32 &&
    r.height >= 32
  ) {
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }
  return null;
}

/**
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ x: number; y: number; width: number; height: number } | null>}
 */
export async function getDouyinLoginCaptureRectFromPuppeteerPage(page) {
  try {
    const r = await page.evaluate(DOUYIN_LOGIN_RECT_SCRIPT);
    return rectFromPageEval(r);
  } catch (_) {
    // 页面未就绪
  }
  return null;
}

/**
 * 与 upload 相同：puppeteer-in-electron 的 Page + CDP 截图，窗口可保持 show:false，无需屏外坐标。
 * @param {import("puppeteer").Page} page
 * @param {{ partitionLabel: string, saveQrPngPath?: string | null }} opts
 */
export async function paintLoginQrToTerminalFromPuppeteerPage(page, opts) {
  if (!process.stdout.isTTY) {
    return;
  }
  try {
    if (typeof page.isClosed === "function" && page.isClosed()) {
      return;
    }
  } catch (_) {
    return;
  }

  let fromBase64 = await tryReadAnimateQrImageBufferFromPage(page);
  let buf = fromBase64;

  if (!buf || !buf.length) {
    cliQrDebugLog("将使用 CDP 截图作为二维码栅格");
    let rect = await getDouyinLoginCaptureRectFromPuppeteerPage(page);
    try {
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
    cliQrDebugLog("nativeImage 无法解析 buffer，回退 CDP 截图");
    fromBase64 = null;
    let rect = await getDouyinLoginCaptureRectFromPuppeteerPage(page);
    try {
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

  await writeDouyinLoginQrToStdout(image, {
    partitionLabel: opts.partitionLabel,
    srcHint: fromBase64 ? "（页面 base64 栅格）" : "（CDP 截图栅格）",
  });
}
