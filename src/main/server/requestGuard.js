"use strict";
/**
 * 内置 HTTP 服务（localhost:30088）的访问令牌与请求守卫。
 *
 * 背景：打包后渲染进程以 file:// 协议加载，fetch 请求不会携带
 * Origin / Referer 头（Electron 实测两个头都缺省）。仅靠
 * Origin 白名单校验会把自家 App 的请求也一并 403 掉——
 * （0.11.4 引入的收紧逻辑就造成了「新增账号无反应」）。
 *
 * 方案：启动时生成随机令牌，不落盘、重启即失效。渲染进程通过
 * IPC 领取（ipcMain 只对 file:// 与 localhost 页面发放），随后
 * 在请求里携带 X-Matrix-Token 头；外部网站、curl 等拿不到令牌，
 * 无论 Origin 是什么都会被 403，保留安全收紧的效果。
 */
const crypto = require("crypto");

const SERVER_REQUEST_TOKEN = crypto.randomBytes(24).toString("hex");

// 可信来源 = file:// 页面 + 本机回环的三个写法（端口不限）。
// 注意：这里不能用前缀正则。`(https?://localhost)` 会把
// http://localhost.evil.com 这类外部域名一起放行，而服务端对所有
// 响应都发了 Access-Control-Allow-Origin: *，一旦放行就等于把
// 本机 API（含 /publish）暴露给任意网页。必须解析 URL 后逐字比对 hostname。
const TRUSTED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Origin / Referer 是否来自本机页面。
 * @param {string} rawOrigin
 * @returns {boolean}
 */
function isTrustedOrigin(rawOrigin) {
  const origin = String(rawOrigin || "").trim();
  if (!origin) return false;
  // 沙箱 iframe 与部分 file:// 场景会发 null，不能当作可信来源
  if (origin === "null") return false;
  if (/^file:/i.test(origin)) return true;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // URL 会把 hostname 规范化为小写，[::1] 保留方括号
  return TRUSTED_HOSTNAMES.has(parsed.hostname);
}

/**
 * 信任条件二选一：
 * 1. 携带仅自家进程知晓的 X-Matrix-Token（打包后的 file:// 页面）；
 * 2. Origin / Referer 命中本机回环（dev 模式 http://localhost:9080）。
 * 其余情况（curl、外部网站、删掉头部的脚本）一律拒绝。
 */
function isTrustedLocalRequest(req) {
  const headers = (req && req.headers) || {};
  if (headers["x-matrix-token"] === SERVER_REQUEST_TOKEN) return true;
  const origin = headers.origin || headers.referer || "";
  return isTrustedOrigin(origin);
}

module.exports = {
  SERVER_REQUEST_TOKEN,
  isTrustedOrigin,
  isTrustedLocalRequest,
};
