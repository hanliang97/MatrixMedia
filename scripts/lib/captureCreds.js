/**
 * 平台接口抓包凭证的读取公共模块。
 *
 * 凭证文件为 .env 风格键值对（.mm-* 前缀已在 .gitignore，不进仓库）：
 *   COOKIE=完整 cookie 字符串
 *   TOKEN=百家号的 token 请求头
 *   X_SECSDK_CSRF_TOKEN=抖音 x-secsdk-csrf-token
 *   X_WECHAT_UIN / FINGER_PRINT_DEVICE_ID / AID / LOG_FINDER_ID=视频号相关
 *
 * 由 scripts/import-ps-capture.js 从浏览器「复制为 PowerShell」的文本自动生成。
 */

"use strict";

const fs = require("fs");
const path = require("path");

/** 读取 .env 风格凭证文件为键值对对象 */
function loadEnvCreds(filePath) {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(__dirname, "..", "..", filePath);
  if (!fs.existsSync(abs)) {
    console.error(`缺少凭证文件：${abs}`);
    console.error("先用 scripts/import-ps-capture.js 从抓包文本导入：");
    console.error("  node scripts/import-ps-capture.js <抓包文本文件> <输出凭证文件>");
    process.exit(1);
  }
  const out = {};
  for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** 要求必需键存在，缺失则报错退出 */
function requireKeys(creds, keys, fileHint) {
  const missing = keys.filter((k) => !creds[k]);
  if (missing.length) {
    console.error(`凭证文件 ${fileHint} 缺少字段：${missing.join(", ")}`);
    process.exit(1);
  }
  return creds;
}

module.exports = { loadEnvCreds, requireKeys };
