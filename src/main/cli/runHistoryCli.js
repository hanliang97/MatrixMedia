"use strict";

import path from "path";
import fs from "fs";
import { app } from "electron";

function getPushDataDir() {
  const documents = app.getPath("documents");
  return path.join(documents, "MatrixMedia", "data", "pushData");
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(n => parseInt(n, 10));
  return new Date(y, m - 1, d).getTime();
}

function listDateFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => ({ file: f, date: f.replace(".json", ""), ts: parseDate(f.replace(".json", "")) }))
    .sort((a, b) => b.ts - a.ts);
}

function normalizeStatus(item) {
  const raw = String(item.publishStatus || "").toLowerCase();
  if (raw === "success" || raw === "failed" || raw === "publishing") return raw;
  if (Number(item.publishSuccessCount) > 0) return "success";
  if (Number(item.publishFailCount) > 0) return "failed";
  return "publishing";
}

function statusLabel(s) {
  return s === "success" ? "成功" : s === "failed" ? "失败" : "发布中";
}

function formatTime(ms) {
  if (!ms) return "-";
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}

function truncate(s, maxWidth) {
  const str = String(s || "");
  let w = 0;
  let out = "";
  for (const ch of str) {
    const cw = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
    if (w + cw > maxWidth) {
      out += "…";
      return out;
    }
    out += ch;
    w += cw;
  }
  return out;
}

export function runHistoryCli(options) {
  const dir = getPushDataDir();
  const allFiles = listDateFiles(dir);

  let targetFiles;
  if (options.since || options.until) {
    const sinceTs = options.since ? parseDate(options.since) : -Infinity;
    const untilTs = options.until ? parseDate(options.until) : Infinity;
    targetFiles = allFiles.filter(f => f.ts >= sinceTs && f.ts <= untilTs);
  } else {
    targetFiles = allFiles.slice(0, options.days);
  }

  const rows = [];
  for (const f of targetFiles) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(dir, f.file), "utf-8"));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (options.platform && item.pt !== options.platform) continue;
      if (options.phone && String(item.phone) !== String(options.phone)) continue;
      const status = normalizeStatus(item);
      if (options.status && status !== options.status) continue;
      rows.push({
        date: f.date,
        phone: item.phone || "",
        pt: item.pt || "",
        title: item.bt || item.data?.bt1 || item.bookName || "",
        bookName: item.bookName || "",
        status,
        attemptCount: Number(item.publishAttemptCount) || 1,
        successCount: Number(item.publishSuccessCount) || 0,
        failCount: Number(item.publishFailCount) || 0,
        lastMessage: item.lastPublishMessage || "",
        lastAt: item.lastPublishAt || item.createTime || null,
        file: item.selectedFile || item.filePath || "",
        id: item.id || "",
      });
    }
  }

  rows.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const limited = rows.slice(0, options.limit);

  if (options.json) {
    console.log(JSON.stringify(limited, null, 2));
    return 0;
  }

  if (limited.length === 0) {
    console.log("（无匹配记录）数据目录：" + dir);
    return 0;
  }

  const header = ["时间", "账号", "平台", "状态", "次数", "标题", "说明"];
  const MAX_TITLE = 30;
  const MAX_MSG = 24;
  const lines = limited.map(r => [
    formatTime(r.lastAt),
    String(r.phone),
    r.pt,
    statusLabel(r.status),
    `${r.successCount}/${r.attemptCount}`,
    truncate(r.title, MAX_TITLE),
    truncate(r.lastMessage, MAX_MSG),
  ]);
  const widths = header.map((h, i) =>
    Math.max(displayWidth(h), ...lines.map(row => displayWidth(row[i])))
  );
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - displayWidth(s)));
  const render = row => row.map((c, i) => pad(c, widths[i])).join("  ");
  console.log(render(header));
  console.log(widths.map(w => "-".repeat(w)).join("  "));
  lines.forEach(r => console.log(render(r)));
  const okN = rows.filter(r => r.status === "success").length;
  const failN = rows.filter(r => r.status === "failed").length;
  const pubN = rows.filter(r => r.status === "publishing").length;
  console.log(
    `\n共 ${rows.length} 条记录，显示前 ${limited.length}：成功 ${okN} / 失败 ${failN} / 发布中 ${pubN}`
  );
  return 0;
}
