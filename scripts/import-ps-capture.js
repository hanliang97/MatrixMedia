/**
 * 抓包导入器：把浏览器 DevTools「复制为 PowerShell」的请求文本
 * 解析为各平台验证脚本使用的 .env 风格凭证文件。
 *
 * 用法：
 *   node scripts/import-ps-capture.js <输出凭证文件> <抓包文本1> [抓包文本2 ...]
 *
 * 例：
 *   node scripts/import-ps-capture.js .mm-bjh.env .mm-bjh-list.ps1 .mm-bjh-home.ps1
 *
 * 提取内容：
 *   - $session.Cookies.Add(...) 全部 cookie → COOKIE
 *   - Headers 里的 token / x-secsdk-csrf-token / X-WECHAT-UIN / finger-print-device-id
 *   - URL query 里的 _aid、body 里的 _log_finder_id
 * 多个抓包文件按顺序合并，后者覆盖同名键。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const HEADER_KEY_MAP = {
  token: "TOKEN",
  "x-secsdk-csrf-token": "X_SECSDK_CSRF_TOKEN",
  "x-wechat-uin": "X_WECHAT_UIN",
  "finger-print-device-id": "FINGER_PRINT_DEVICE_ID",
};

/** PowerShell 字符串里的反引号转义还原（`" → "，`n 等保持字面即可） */
function unescapePs(str) {
  return str.replace(/`([\s\S])/g, "$1");
}

function extractFromText(text, creds, cookieMap) {
  // 1) Cookie：$session.Cookies.Add((New-Object System.Net.Cookie("名", "值", "/", "域")))
  const cookieRe =
    /New-Object System\.Net\.Cookie\("([^"]+)",\s*"([\s\S]*?)",\s*"\/"/g;
  let m;
  while ((m = cookieRe.exec(text))) {
    cookieMap.set(m[1], unescapePs(m[2]));
  }

  // 2) 关键请求头："token"="..." 等
  const headerRe = /"(token|x-secsdk-csrf-token|x-wechat-uin|finger-print-device-id)"\s*=\s*"([^"]+)"/gi;
  while ((m = headerRe.exec(text))) {
    const key = HEADER_KEY_MAP[m[1].toLowerCase()];
    if (key) creds[key] = m[2];
  }

  // 3) URL query 的 _aid
  const aid = /[?&]_aid=([^&\s"\\]+)/.exec(text);
  if (aid) creds.AID = aid[1];

  // 4) body 里的 _log_finder_id（视频号账号标识，形如 v2_xxx@finder）
  const finder = /v2_[0-9a-f]+@finder/.exec(text);
  if (finder) creds.LOG_FINDER_ID = finder[0];
}

function main() {
  const [, , outFile, ...inputFiles] = process.argv;
  if (!outFile || inputFiles.length === 0) {
    console.error(
      "用法：node scripts/import-ps-capture.js <输出凭证文件> <抓包文本1> [抓包文本2 ...]"
    );
    process.exit(1);
  }

  const creds = {};
  const cookieMap = new Map();
  for (const file of inputFiles) {
    if (!fs.existsSync(file)) {
      console.error(`找不到抓包文件：${file}`);
      process.exit(1);
    }
    extractFromText(fs.readFileSync(file, "utf8"), creds, cookieMap);
    console.log(`已解析 ${file}（累计 cookie ${cookieMap.size} 个）`);
  }

  if (cookieMap.size > 0) {
    creds.COOKIE = [...cookieMap.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  // 固定键序输出，COOKIE 放最后（最长的一行）
  const order = [
    "TOKEN",
    "X_SECSDK_CSRF_TOKEN",
    "X_WECHAT_UIN",
    "FINGER_PRINT_DEVICE_ID",
    "AID",
    "LOG_FINDER_ID",
    "COOKIE",
  ];
  const lines = order.filter((k) => creds[k]).map((k) => `${k}=${creds[k]}`);
  const outPath = path.resolve(outFile);
  fs.writeFileSync(outPath, lines.join("\n") + "\n");

  console.log(`\n已生成 ${outPath}：`);
  for (const k of order) {
    if (!creds[k]) continue;
    const v = creds[k];
    const preview = v.length > 60 ? v.slice(0, 57) + "..." : v;
    console.log(`  ${k} = ${preview}`);
  }
}

main();
