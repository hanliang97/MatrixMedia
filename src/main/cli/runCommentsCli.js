"use strict";

/**
 * 评论互动 CLI：复用 comments 采集层（页面上下文 fetch/嗅探，复用分组登录态）。
 * 输出 JSON 到 stdout（脚本与后续 MCP runner 可直接消费）。
 */

import { probeAccount, collectComments, replyComments } from "../services/comments/collector.js";
import store from "../services/comments/store.js";
import statsStore from "../services/dataStats/store.js";
import { buildAccountPartition } from "../../shared/accountPartition.js";
import fs from "fs";

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

export async function runCommentsCli({
  action,
  platform,
  phone,
  url,
  clicks,
  wait,
  deep,
  evalFile,
  fetches,
  work,
  limit,
  file,
  execute,
  max,
}) {
  // 与登录窗口同一套 partition 规则（账号名取 "-" 前缀）
  const partition = buildAccountPartition(phone, platform);

  if (action === "probe") {
    const startedAt = Date.now();
    try {
      const { finalUrl, result, openedUrls } = await probeAccount({
        partition,
        platform,
        url: url || undefined,
        clicks,
        waitMs: wait || undefined,
        fetches,
        deep,
        evalFile: evalFile || undefined,
      });
      print({
        success: true,
        action: "probe",
        group: phone,
        platform,
        partition,
        ms: Date.now() - startedAt,
        finalUrl,
        openedUrls: openedUrls || [],
        ...result,
      });
      return 0;
    } catch (err) {
      print({
        success: false,
        action: "probe",
        group: phone,
        platform,
        partition,
        ms: Date.now() - startedAt,
        code: (err && err.code) || "",
        error: (err && err.message) || String(err),
      });
      return 1;
    }
  }

  if (action === "reply") {
    const startedAt = Date.now();
    let replies = [];
    try {
      if (!file) throw new Error("缺少 --file（回复清单 JSON）");
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      replies = Array.isArray(parsed) ? parsed : parsed.replies || [];
      if (!Array.isArray(replies) || replies.length === 0) {
        throw new Error("回复清单为空（期望 {\"replies\":[...]} 或 [...]）");
      }
    } catch (err) {
      print({
        success: false,
        action: "reply",
        group: phone,
        platform,
        error: (err && err.message) || String(err),
      });
      return 2;
    }
    try {
      // 增量台账：每条结果一到就落盘（fail-stop/超时时已发条目必有记录）
      const collected = [];
      let logFile = "";
      const data = await replyComments({
        partition,
        platform,
        replies,
        execute: !!execute,
        maxPerRun: max || 5,
        onResult: (entry) => {
          collected.push(entry);
          // 台账：dry-run 与真发都记（mode 字段区分）
          logFile = store.appendReplyLog(phone, platform, [
            { ts: Date.now(), group: phone, platform, ...entry },
          ]);
        },
      });
      const results = Array.isArray(data.results) ? data.results : collected;
      const okCount = results.filter((r) => r.status === "ok").length;
      const dryCount = results.filter((r) => r.status === "dry_ok").length;
      const errCount = results.filter((r) => r.status === "error").length;
      print({
        success: errCount === 0,
        action: "reply",
        group: phone,
        platform,
        mode: execute ? "execute" : "dry",
        ms: Date.now() - startedAt,
        total: results.length,
        ok: okCount,
        dryOk: dryCount,
        errors: errCount,
        results,
        extra: data.extra,
        logFile,
      });
      return errCount === 0 ? 0 : 1;
    } catch (err) {
      print({
        success: false,
        action: "reply",
        group: phone,
        platform,
        mode: execute ? "execute" : "dry",
        ms: Date.now() - startedAt,
        code: (err && err.code) || "",
        error: (err && err.message) || String(err),
      });
      return 1;
    }
  }

  // action === "list"
  const startedAt = Date.now();
  try {
    const data = await collectComments({
      partition,
      platform,
      work,
      limit,
      landingUrl: url || undefined,
    });
    // 作品标题补齐：抖音/快手嗅探结果只有 workId，从 dataStats works.json 快照 join 标题。
    // 注意：works.json 的抖音 workId 有 JS 大整数精度丢失（…018 → …000），
    // 评论侧 aweme_id 为字符串无损 —— join 键做 Number 归一化对齐两侧。
    try {
      const worksData = statsStore.readWorks(phone, platform) || { works: [] };
      const titleMap = new Map();
      for (const w of worksData.works || []) {
        const id = String(w.workId || "");
        const title = String(w.title || "");
        if (!id || !title) continue;
        titleMap.set(id, title);
        const n = Number(id);
        if (Number.isFinite(n)) titleMap.set(String(n), title);
      }
      for (const c of data.comments) {
        if (c.workTitle || !c.workId) continue;
        const raw = String(c.workId);
        const n = Number(raw);
        c.workTitle =
          titleMap.get(raw) ||
          (Number.isFinite(n) ? titleMap.get(String(n)) : "") ||
          "";
      }
    } catch (_) {
      /* 无统计快照不影响评论主流程 */
    }
    // --work 过滤（标题模糊或 workId 精确）
    let comments = data.comments;
    if (work) {
      comments = comments.filter(
        (c) =>
          String(c.workId || "") === String(work) ||
          String(c.workTitle || "").includes(work)
      );
    }
    const payload = {
      group: phone,
      platform,
      work: work || "",
      count: comments.length,
      collectedAt: data.collectedAt,
      comments,
      extra: data.extra,
    };
    store.writeLatest(phone, platform, payload);
    store.writeMeta(phone, platform, {
      lastCollectAt: data.collectedAt,
      lastAttemptAt: Date.now(),
      lastError: "",
      count: data.comments.length,
    });
    print({ success: true, action: "list", ms: Date.now() - startedAt, ...payload });
    return 0;
  } catch (err) {
    const message = (err && err.message) || String(err);
    // 失败路径只记尝试时间与错误，不覆盖上次成功采集的 lastCollectAt
    store.writeMeta(phone, platform, {
      lastAttemptAt: Date.now(),
      lastError: message,
    });
    print({
      success: false,
      action: "list",
      group: phone,
      platform,
      ms: Date.now() - startedAt,
      code: (err && err.code) || "",
      error: message,
    });
    return 1;
  }
}
