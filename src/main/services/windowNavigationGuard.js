"use strict";

/**
 * 给 BrowserWindow 装导航守卫：
 *   1. `window.open` / `target="_blank"`：一律拒绝在应用内开窗，http(s)/mailto
 *      交给系统浏览器；
 *   2. `will-navigate` / `will-redirect`：窗口自身只允许停留在应用自己的页面
 *      （file:// 构建目录或 dev 本地 server origin），其余地址拦住并交系统浏览器。
 *
 * 为什么必须有（Issue #35「安全审计 · Electron 安全配置」）：
 * 主窗口是 `nodeIntegration: true` + `contextIsolation: false` 的本地页面，
 * 页面内的 Node 能力是刚需。webPreferences 跟随窗口，而不跟随 URL ——
 * 只要这个窗口被导航到任意远端页面，远端脚本就直接继承了 Node 能力。
 * Electron 安全清单第 7、13 条要求在 `will-navigate` / `setWindowOpenHandler`
 * 里显式限制导航目标，本模块即该实现。
 *
 * 为什么还要挂 `will-redirect`：302 跳转**不触发** `will-navigate`（Electron 24
 * 实测只有 did-start-navigation → will-redirect → did-navigate），只守
 * will-navigate 等于留了一条「先跳到可 302 的地址、再被带去远端」的缺口。
 *
 * 策略本身（哪些 URL 算内部 / 哪些能交系统打开）在
 * shared/navigationGuard.js，这里只负责接线，便于单测。
 */

import {
  isExternalOpenableUrl,
  isInternalAppUrl,
} from "../../shared/navigationGuard";

const URL_PREVIEW_LIMIT = 120;

function previewUrl(url) {
  const text = String(url == null ? "" : url);
  return text.length > URL_PREVIEW_LIMIT
    ? `${text.slice(0, URL_PREVIEW_LIMIT)}…`
    : text;
}

/**
 * 交给系统浏览器 / 邮件客户端打开；不允许的协议直接丢弃。
 * @param {(url: string) => any} openExternal shell.openExternal
 * @param {string} url
 * @param {string} source 日志里标注拦截来源
 * @returns {boolean} 是否已交给系统处理
 */
export function openUrlExternally(openExternal, url, source) {
  if (!isExternalOpenableUrl(url)) {
    console.warn(
      `[navigation-guard] 已拦截并丢弃不允许外链打开的地址（${source}）:`,
      previewUrl(url)
    );
    return false;
  }
  try {
    const result = openExternal(url);
    if (result && typeof result.catch === "function") {
      result.catch((err) => {
        console.warn(
          "[navigation-guard] 系统浏览器打开失败:",
          err && err.message ? err.message : err
        );
      });
    }
    return true;
  } catch (err) {
    console.warn(
      "[navigation-guard] 系统浏览器打开失败:",
      err && err.message ? err.message : err
    );
    return false;
  }
}

/**
 * @param {Electron.BrowserWindow} win
 * @param {{
 *   openExternal?: (url: string) => any,
 *   appRoot?: string,
 *   devOrigins?: string[],
 * }} [options] appRoot / devOrigins 由调用方按运行模式显式传入
 * @returns {boolean} window.open 拦截是否安装成功（窗口已销毁时返回 false）
 */
export function installWindowNavigationGuard(win, options = {}) {
  const webContents = win && win.webContents;
  if (!webContents || (typeof win.isDestroyed === "function" && win.isDestroyed())) {
    return false;
  }
  const openExternal =
    typeof options.openExternal === "function" ? options.openExternal : () => {};
  const policy = {
    appRoot: options.appRoot || "",
    devOrigins: Array.isArray(options.devOrigins) ? options.devOrigins : [],
  };

  const blockNavigation = (event, url, source) => {
    if (isInternalAppUrl(url, policy)) return;
    event.preventDefault();
    console.warn(
      `[navigation-guard] 已拦截窗口内导航（${source}），改由系统浏览器打开:`,
      previewUrl(url)
    );
    openUrlExternally(openExternal, url, source);
  };

  let windowOpenInstalled = true;
  try {
    webContents.setWindowOpenHandler(({ url }) => {
      console.warn(
        "[navigation-guard] window.open 已拦截，改由系统浏览器打开:",
        previewUrl(url)
      );
      openUrlExternally(openExternal, url, "window.open");
      // 一律不在应用内开窗：任何新窗口都会继承本窗口的 webPreferences
      return { action: "deny" };
    });
  } catch (err) {
    windowOpenInstalled = false;
    console.warn(
      "[navigation-guard] 安装 window.open 拦截失败:",
      err && err.message ? err.message : err
    );
  }

  webContents.on("will-navigate", (event, url) =>
    blockNavigation(event, url, "will-navigate")
  );
  // 302 不走 will-navigate，必须单独守（Electron 24 实测）
  webContents.on("will-redirect", (event, url) =>
    blockNavigation(event, url, "will-redirect")
  );

  return windowOpenInstalled;
}

/**
 * 「先装守卫，再加载页面」——顺序本身就容易写错（漏装 / 装晚了都等于没有
 * 防护），所以封成一个函数：调用方只能按正确顺序用，单测也能直接断言顺序。
 *
 * @param {Electron.BrowserWindow} win
 * @param {string} url 要加载的地址（file:// 或 dev server origin）
 * @param {{ label?: string, openExternal?: Function, appRoot?: string, devOrigins?: string[] }} [options]
 * @returns {boolean} window.open 拦截是否安装成功
 */
export function loadUrlWithGuard(win, url, options = {}) {
  const { label, ...guardOptions } = options;
  const installed = installWindowNavigationGuard(win, guardOptions);
  if (!installed) {
    console.warn(
      `[navigation-guard] ${label || "窗口"} 守卫安装失败，仍继续加载:`,
      previewUrl(url)
    );
  }
  win.loadURL(url);
  return installed;
}

export default installWindowNavigationGuard;
