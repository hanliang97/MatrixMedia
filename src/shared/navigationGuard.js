"use strict";

/**
 * 窗口内导航 / 外链打开的 URL 策略（主进程与单测共用，纯函数）。
 *
 * 背景（Issue #35「安全审计 · webPreferences / openExternal / window.open」）：
 * 主窗口是 `nodeIntegration: true` + `contextIsolation: false` 的本地页面，
 * 页面里的 Node 能力是刚需（渲染进程直接用 ipcRenderer / fs）。代价是：
 *
 *   - 一旦这个窗口被导航到远端页面，远端脚本会直接拿到 Node（实测
 *     Electron 24 下 `location.href = 'http://…'` 之后 `require('fs')` 仍可用，
 *     因为 webPreferences 跟随窗口而不是 URL）；
 *   - `window.open` 打开的窗口会沿用父窗口的部分偏好，且默认会真的开一个
 *     Electron 窗口去加载任意站点，用户看到的「外链」其实是应用内窗口。
 *
 * 所以主进程必须显式划定「窗口内允许的地址」与「交给系统浏览器打开的地址」。
 * 这里只做纯策略判断，安装监听在 services/windowNavigationGuard.js。
 *
 * 两个允许来源都必须**显式传入**，不做任何默认放行：
 *   - `appRoot`：应用根目录（打包后是 asar 路径），`file:` 只允许它下面的页面；
 *   - `devOrigins`：dev 本地开发服务器的 origin（含端口），只在 dev 模式传入。
 * 历史实现直接放行任意 `file:` 与任意 localhost 端口，等于把「用户下载的 HTML」
 * 和「本机任意 HTTP 服务」都当成可信页面喂给带 Node 的窗口。
 */

import path from "path";

function normalizeOrigin(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch (_) {
    return "";
  }
}

function lowerOnWindows(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

/**
 * `file:` 只在「host 为空或 localhost」且「路径在 appRoot 下」时算内部。
 * 带 host 的 file URL 在 Windows 上是 UNC 路径（`\\host\share`），加载它会
 * 触发 SMB 连接（NTLM 凭据泄露面），必须拒绝。
 */
function isFileUrlInsideApp(parsed, appRoot) {
  if (!appRoot) return false;
  const host = String(parsed.hostname || "").toLowerCase();
  if (host && host !== "localhost") return false;
  let filePath = "";
  try {
    filePath = decodeURIComponent(parsed.pathname || "");
  } catch (_) {
    return false;
  }
  if (!filePath) return false;
  // Windows 的 file URL 形如 /C:/dir/file.html
  if (/^\/[a-zA-Z]:\//.test(filePath)) filePath = filePath.slice(1);
  const resolved = lowerOnWindows(path.resolve(filePath));
  const root = lowerOnWindows(path.resolve(appRoot));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved === root || resolved.startsWith(prefix);
}

/**
 * 窗口内允许导航到的地址：应用自己的 file:// 页面，或 dev 本地服务器 origin。
 * 其余（远端 http(s)、data:、javascript:、chrome:、任意 localhost 端口）一律不由窗口加载。
 * @param {string} rawUrl
 * @param {{ appRoot?: string, devOrigins?: string[] }} [options]
 * @returns {boolean}
 */
export function isInternalAppUrl(rawUrl, options = {}) {
  const url = String(rawUrl || "").trim();
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  if (parsed.protocol === "file:") {
    return isFileUrlInsideApp(parsed, options.appRoot || "");
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    const origins = Array.isArray(options.devOrigins) ? options.devOrigins : [];
    return origins.map(normalizeOrigin).filter(Boolean).includes(parsed.origin);
  }
  return false;
}

/**
 * 允许交给系统浏览器 / 邮件客户端打开的地址。
 * 白名单而不是黑名单：`file:` 会把本地路径交给系统关联程序，
 * `javascript:` / `vbscript:` 在部分平台会被当作可执行内容处理。
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isExternalOpenableUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  return (
    parsed.protocol === "https:" ||
    parsed.protocol === "http:" ||
    parsed.protocol === "mailto:"
  );
}
