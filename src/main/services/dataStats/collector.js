"use strict";

/**
 * 采集执行器：为单个「分组 × 平台」账号开隐藏窗口，复用其 session 登录态，
 * 在平台落地页上下文执行适配器脚本，返回归一化数据。
 */

const path = require("path");
const fs = require("fs");
const { BrowserWindow, app } = require("electron");
const { ADAPTERS } = require("./adapters");
const { PRELOAD_SOURCE } = require("./preloadSource");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * preload 文件必须是磁盘真实文件，且不能依赖源码目录
 * （webpack 打包后 __dirname 指向 dist，源码旁的文件不存在，preload 会静默失败）。
 * 每次采集前把内嵌源码写入 userData，路径稳定且随版本更新。
 */
function ensureSnifferPreloadPath() {
  const file = path.join(
    app.getPath("userData"),
    "data-stats",
    "preload-sniffer.js"
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PRELOAD_SOURCE);
  return file;
}

/**
 * @param {object} opts
 * @param {string} opts.partition  例如 persist:123抖音
 * @param {string} opts.platform   平台中文名（ADAPTERS 键）
 * @param {number} [opts.timeoutMs] 单账号总超时
 * @returns {Promise<{overview, fansHistory, works, collectedAt}>}
 */
async function collectAccount({ partition, platform, timeoutMs = 120000 }) {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new Error(`暂不支持的平台：${platform}`);

  // backgroundThrottling:false 关键：隐藏窗口默认会被节流（定时器/网络挂起），
  // 会导致页面迟迟不发出列表请求（快手就曾因此嗅探超时）
  const webPreferences = { partition, backgroundThrottling: false };
  if (adapter.sniffer) {
    // 嗅探模式：preload 在页面脚本之前注入 fetch/XHR hook，
    // 页面自己发出的请求（含签名）响应体存入 window.__mmSniffed
    webPreferences.preload = ensureSnifferPreloadPath();
    webPreferences.contextIsolation = false;
  }

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences,
  });

  try {
    if (adapter.userAgent) win.webContents.setUserAgent(adapter.userAgent);
    win.webContents.on("render-process-gone", () => {
      /* 窗口崩溃由超时兜底 */
    });

    // 签名嗅探（如快手 __NS_sig3）：页面自身请求带出的签名，捕获后注入页面复用
    let capturedSig3 = "";
    if (adapter.capturePattern) {
      win.webContents.session.webRequest.onBeforeRequest(
        (details, callback) => {
          if (!capturedSig3) {
            const m = details.url.match(adapter.capturePattern);
            if (m) capturedSig3 = m[1];
          }
          callback({});
        }
      );
    }

    await Promise.race([
      win.loadURL(adapter.landingPage),
      sleep(30000).then(() => {
        throw new Error("落地页加载超时");
      }),
    ]);

    // 登录态检测：被重定向到登录页则直接判定未登录
    const finalUrl = win.webContents.getURL();
    if (adapter.loginUrlPattern && adapter.loginUrlPattern.test(finalUrl)) {
      const err = new Error("登录态已失效，请先在「媒体平台管理」重新登录");
      err.code = "NOT_LOGGED_IN";
      throw err;
    }

    await sleep(adapter.settleMs || 5000); // 等平台 SDK 初始化

    // 注入嗅探到的签名（页面脚本里以 window.__mmSig3 使用）
    if (adapter.capturePattern) {
      if (!capturedSig3) {
        throw new Error("未能从页面请求中捕获接口签名（页面可能未自动加载列表）");
      }
      console.log(
        `[dataStats] 捕获到签名：${capturedSig3.slice(0, 16)}…（共 ${capturedSig3.length} 位）`
      );
      await win.webContents.executeJavaScript(
        `window.__mmSig3 = ${JSON.stringify(capturedSig3)}; true`
      );
    }

    const result = await Promise.race([
      win.webContents.executeJavaScript(adapter.collectScript(), true),
      sleep(timeoutMs).then(() => {
        throw new Error("采集执行超时");
      }),
    ]);

    if (!result || typeof result !== "object") {
      throw new Error("采集脚本未返回有效数据");
    }
    return {
      overview: result.overview || {},
      fansHistory: Array.isArray(result.fansHistory) ? result.fansHistory : [],
      works: Array.isArray(result.works) ? result.works : [],
      collectedAt: Date.now(),
    };
  } finally {
    try {
      win.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = { collectAccount };
