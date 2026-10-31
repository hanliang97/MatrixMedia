"use strict";

/**
 * 评论本地存储（userData/comments/<分组>/<平台>/）：
 *   latest.json  最近一次采集的归一化评论快照
 *   meta.json    { lastCollectAt, lastError, count }
 * 快照仅供人工/流程查阅；字探侧消费以 CLI stdout JSON 为准。
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function baseDir() {
  return path.join(app.getPath("userData"), "comments");
}

function safeSeg(name) {
  const seg = String(name || "未命名").replace(/[\\/:*?"<>|]/g, "_");
  // 防路径穿越/空段："." 与 ".." 会跳出目标目录
  if (seg === "." || seg === ".." || seg === "") return "_";
  return seg;
}

function accountDir(group, platform) {
  return path.join(baseDir(), safeSeg(group), safeSeg(platform));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function writeLatest(group, platform, payload) {
  writeJson(path.join(accountDir(group, platform), "latest.json"), payload);
}

function readLatest(group, platform) {
  return readJson(
    path.join(accountDir(group, platform), "latest.json"),
    null
  );
}

function writeMeta(group, platform, meta) {
  const file = path.join(accountDir(group, platform), "meta.json");
  writeJson(file, { ...readJson(file, {}), ...meta });
}

/** 回复台账（JSONL 追加，一行一条，含 dry-run 与真发） */
function appendReplyLog(group, platform, entries) {
  const file = path.join(accountDir(group, platform), "reply-log.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = (Array.isArray(entries) ? entries : [entries])
    .map((e) => JSON.stringify(e))
    .join("\n");
  fs.appendFileSync(file, lines + "\n");
  return file;
}

module.exports = { writeLatest, readLatest, writeMeta, appendReplyLog };
