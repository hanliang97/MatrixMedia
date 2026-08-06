"use strict";

/**
 * 匿名打开统计（GitHub Gist 后端）
 *
 * 设计：
 * - 每次 Electron 启动（GUI / CLI）追加一条事件到公开 Gist 的 events.json
 * - 不做去重、不固定设备 ID，只记录"打开"这一动作
 * - 写入需要 token：env MATRIXMEDIA_GIST_TOKEN / ~/.matrixmedia/gist-token / 内置常量
 * - 关闭：env MATRIXMEDIA_DISABLE_TELEMETRY=1 或 ~/.matrixmedia/no-telemetry
 * - best-effort，失败静默，不影响应用启动
 */

import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
// 构建期由 scripts/gen-telemetry-secret.js 生成（gitignored，不进仓库）
// 导出 GIST_ID / GIST_TOKEN 两个常量；缺失时为空字符串
import { GIST_ID as GEN_GIST_ID, GIST_TOKEN as GEN_GIST_TOKEN } from "./telemetrySecret.generated";

const GITHUB_API = "https://api.github.com";
const GIST_FILENAME = "events.json";
const PUBLISH_FILENAME = "publish-events.json";
const MAX_EVENTS = 5000; // 最多保留最近 5000 条，避免无限增长
const NO_TELEMETRY_FILE = "no-telemetry";
const TOKEN_FILE = "gist-token";
const CONFIG_DIR = ".matrixmedia";

// 内置默认值（由构建期注入；token 不进 git 历史，避免触发 GitHub Push Protection）
const BUILTIN_GIST_ID = GEN_GIST_ID || "";
const BUILTIN_GIST_TOKEN = GEN_GIST_TOKEN || "";

function readEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function configDirPath() {
  return path.join(os.homedir(), CONFIG_DIR);
}

function readConfigFile(name) {
  try {
    const p = path.join(configDirPath(), name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch (_) {}
  return "";
}

export function getGistId() {
  return readEnv("MATRIXMEDIA_GIST_ID") || BUILTIN_GIST_ID;
}

export function getGistToken() {
  return readEnv("MATRIXMEDIA_GIST_TOKEN") || readConfigFile(TOKEN_FILE) || BUILTIN_GIST_TOKEN;
}

export function isTelemetryDisabled() {
  if (readEnv("MATRIXMEDIA_DISABLE_TELEMETRY")) return true;
  try {
    if (fs.existsSync(path.join(configDirPath(), NO_TELEMETRY_FILE))) return true;
  } catch (_) {}
  return false;
}

function collectEvent(mode) {
  const electron = require("electron");
  let version = "unknown";
  let locale = "unknown";
  try { version = electron.app.getVersion() || "unknown"; } catch (_) {}
  try { locale = electron.app.getLocale() || process.env.LANG || "unknown"; } catch (_) {}
  return {
    ts: new Date().toISOString(),
    version,
    platform: process.platform,
    arch: process.arch,
    locale,
    mode: mode === "cli" ? "cli" : "gui",
  };
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (c) => (chunks += c));
      res.on("end", () => {
        resolve({ status: res.statusCode || 0, headers: res.headers || {}, body: chunks });
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => {
      try { req.destroy(new Error("telemetry request timeout")); } catch (_) {}
    });
    if (body) req.write(body);
    req.end();
  });
}

function githubHeaders(token, extra = {}) {
  return Object.assign(
    {
      "User-Agent": "MatrixMedia-Telemetry",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    token ? { Authorization: `Bearer ${token}` } : {},
    extra
  );
}

async function fetchGist(gistId, token, filename) {
  const opts = {
    method: "GET",
    hostname: "api.github.com",
    path: `/gists/${gistId}`,
    headers: githubHeaders(token),
  };
  const res = await httpsRequest(opts);
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`github gist get failed: ${res.status}`);
  }
  const data = JSON.parse(res.body || "{}");
  const file = data.files && data.files[filename];
  const content = file && file.content ? file.content : "[]";
  return content;
}

async function updateGist(gistId, token, filename, content) {
  const body = JSON.stringify({
    files: { [filename]: { content } },
  });
  const opts = {
    method: "PATCH",
    hostname: "api.github.com",
    path: `/gists/${gistId}`,
    headers: githubHeaders(token, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    }),
  };
  const res = await httpsRequest(opts, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`github gist patch failed: ${res.status}`);
  }
  return true;
}

function appendEvent(prevArr, event) {
  const arr = Array.isArray(prevArr) ? prevArr : [];
  arr.push(event);
  // 只保留最近 MAX_EVENTS 条
  if (arr.length > MAX_EVENTS) {
    return arr.slice(arr.length - MAX_EVENTS);
  }
  return arr;
}

/**
 * 上报一次"打开"事件。best-effort，失败静默。
 * @param {Electron.App} app
 * @param {"gui"|"cli"} mode
 */
export async function reportUsageTelemetry(app, mode = "gui") {
  try {
    if (isTelemetryDisabled()) return false;
    const gistId = getGistId();
    const token = getGistToken();
    if (!gistId || !token) return false; // 未配置，跳过
    const event = collectEvent(mode);
    const content = await fetchGist(gistId, token, GIST_FILENAME);
    let prev = [];
    try { prev = content ? JSON.parse(content) : []; } catch (_) { prev = []; }
    const next = appendEvent(prev, event);
    await updateGist(gistId, token, GIST_FILENAME, JSON.stringify(next, null, 2));
    return true;
  } catch (err) {
    try {
      console.warn("[telemetry] 上报失败（静默）:", err && err.message ? err.message : err);
    } catch (_) {}
    return false;
  }
}

/**
 * 上报一次"发布成功"事件。best-effort，失败静默。
 * 国内网络可能访问不到 Gist，失败绝不影响发布流程。
 * 只记录时间戳，不记录任何来源/账号/平台信息。
 */
export async function reportPublishEvent() {
  try {
    if (isTelemetryDisabled()) return false;
    const gistId = getGistId();
    const token = getGistToken();
    if (!gistId || !token) return false; // 未配置，跳过
    const event = { ts: new Date().toISOString() };
    const content = await fetchGist(gistId, token, PUBLISH_FILENAME);
    let prev = [];
    try { prev = content ? JSON.parse(content) : []; } catch (_) { prev = []; }
    const next = appendEvent(prev, event);
    await updateGist(gistId, token, PUBLISH_FILENAME, JSON.stringify(next, null, 2));
    return true;
  } catch (err) {
    try {
      console.warn("[telemetry] 发布上报失败（静默）:", err && err.message ? err.message : err);
    } catch (_) {}
    return false;
  }
}
