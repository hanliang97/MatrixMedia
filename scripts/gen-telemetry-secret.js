"use strict";

/**
 * 构建期生成 telemetrySecret.generated.js（gitignored），把 Gist id/token 注入打包产物。
 * token 永不进 git 历史，避免触发 GitHub Push Protection。
 *
 * 来源优先级：
 *   1. 环境变量 MATRIXMEDIA_GIST_ID / MATRIXMEDIA_GIST_TOKEN
 *   2. scripts/telemetry-secret.json（gitignored，维护者本地维护）
 *   3. 空字符串（未配置则跳过上报）
 */

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "src", "main", "services", "telemetrySecret.generated.js");
const LOCAL_JSON = path.join(__dirname, "telemetry-secret.json");

function readLocalJson() {
  try {
    if (fs.existsSync(LOCAL_JSON)) {
      const obj = JSON.parse(fs.readFileSync(LOCAL_JSON, "utf8"));
      return { gistId: obj.gistId || "", gistToken: obj.gistToken || "" };
    }
  } catch (_) {}
  return { gistId: "", gistToken: "" };
}

function esc(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function main() {
  const local = readLocalJson();
  const gistId = process.env.MATRIXMEDIA_GIST_ID || local.gistId || "";
  const gistToken = process.env.MATRIXMEDIA_GIST_TOKEN || local.gistToken || "";

  const content =
    "// 此文件由 scripts/gen-telemetry-secret.js 自动生成，请勿提交。\n" +
    "// token 不进 git 历史，避免触发 GitHub Push Protection。\n" +
    '"use strict";\n' +
    `export const GIST_ID = "${esc(gistId)}";\n` +
    `export const GIST_TOKEN = "${esc(gistToken)}";\n`;

  fs.writeFileSync(OUT, content, "utf8");
  console.log(`[telemetry-secret] 已生成 ${path.relative(process.cwd(), OUT)} (gistId=${gistId ? "已配置" : "空"}, token=${gistToken ? "已配置" : "空"})`);
}

main();
