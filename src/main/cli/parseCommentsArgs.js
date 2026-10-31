"use strict";

import { PLATFORM_ALIASES } from "../../shared/publishPlatforms.js";

/** 评论互动 v1 支持的平台（三平台矩阵；其余平台待端点探明后加入） */
const COMMENTS_CANONICAL = ["抖音", "快手", "视频号"];

const ACTIONS = new Set(["probe", "list", "reply"]);

export function parseCommentsArgs(subArgv, action) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }
  if (!ACTIONS.has(action)) {
    return { ok: false, error: `未知动作: ${action}` };
  }
  const out = {
    action,
    platform: null,
    phone: null,
    url: "",
    clicks: [],
    wait: 0,
    deep: false,
    evalFile: "",
    fetches: [],
    work: "",
    limit: 200,
    file: "",
    execute: false,
    max: 5,
    json: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") {
      out.platform = args[++i];
    } else if (a === "--phone") {
      out.phone = args[++i];
    } else if (a === "--url") {
      out.url = String(args[++i] || "");
    } else if (a === "--click") {
      out.clicks = String(args[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--wait") {
      out.wait = Math.max(0, Number(args[++i]) || 0);
    } else if (a === "--deep") {
      out.deep = true;
    } else if (a === "--eval") {
      out.evalFile = String(args[++i] || "");
    } else if (a === "--file") {
      out.file = String(args[++i] || "");
    } else if (a === "--execute") {
      out.execute = true;
    } else if (a === "--max") {
      const raw = args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        return { ok: false, error: `--max 需正整数，收到: ${raw}` };
      }
      out.max = Math.min(20, n);
    } else if (a === "--fetch") {
      out.fetches = String(args[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--work") {
      out.work = String(args[++i] || "");
    } else if (a === "--limit") {
      const raw = args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        return { ok: false, error: `--limit 需正整数，收到: ${raw}` };
      }
      out.limit = n;
    } else if (a === "--json") {
      out.json = true;
    } else {
      return {
        ok: false,
        error: `未知参数: ${a}（可用: -p/--platform、--work、--url、--limit、--json）`,
      };
    }
  }

  if (!out.platform) return { ok: false, error: "缺少 -p/--platform" };
  const raw = String(out.platform).trim();
  const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[raw.toLowerCase()] || raw;
  if (!COMMENTS_CANONICAL.includes(pt)) {
    return {
      ok: false,
      error: `不支持的平台: ${out.platform}（评论 v1 支持：${COMMENTS_CANONICAL.join("/")}）`,
    };
  }
  out.platform = pt;

  if (!out.phone) return { ok: false, error: "缺少 --phone（分组名）" };
  out.phone = String(out.phone).trim();
  return { ok: true, value: out };
}

export function commentsHelpText(cmd) {
  const usage = {
    "comments-probe":
      "端点探针：打开平台页面（登录态 partition），dump 导航链接与页面自身请求端点（开发/维护工具）",
    comments:
      "拉取该账号已发布作品的评论列表（只读 v1），输出归一化 JSON 并写本地快照",
    "comments-reply":
      "回复评论（写操作）：文件驱动，默认 dry-run 只校验不发送，--execute 才真发；全程写台账 reply-log.jsonl",
  }[cmd];
  return `
用法: <应用> cli ${cmd} -p <平台> --phone <分组> [选项]

${usage}

选项:
  -p, --platform <id>   平台：dy|抖音、ks|快手、sph|视频号
      --phone <id>      分组名（与 GUI「媒体平台管理」里的分组一致）
      --url <url>       probe：自定义落地页；comments：覆盖采集落地页（调试）
      --click <文本,…>  仅 probe：加载后依次点击的导航文本（SPA 菜单跳转）
      --wait <ms>       仅 probe：dump 前额外等待
      --deep            仅 probe：给同源 iframe 装嗅探钩子（wujie 等微前端）+ shadow/资源清单
      --eval <file>     仅 probe：执行自定义页面脚本文件（返回值须可 JSON 化）
      --fetch <路径,…>  仅 probe：页内 POST 敲门候选端点（视频号助手风格）
      --work <标题|ID>  仅 comments：按作品过滤
      --limit <n>       仅 comments：条数上限（默认 200）
      --file <path>     仅 comments-reply：回复清单 JSON（{"replies":[{commentId?,workId?,workTitle?,matchContent?,content}]}）
      --execute         仅 comments-reply：真发（缺省为 dry-run 只校验）
      --max <n>         仅 comments-reply：单轮真发上限（默认 5，硬上限 20）
      --json            以 JSON 输出（默认即 JSON，便于脚本消费）
  -h, --help            显示本帮助

退出码: 0 成功, 1 异常（如未登录/未实现）, 2 参数错误

示例:
  matrixmedia cli comments -p ks --phone 123 --limit 50
  matrixmedia cli comments-reply -p sph --phone 123 --file replies.json            # dry-run 校验
  matrixmedia cli comments-reply -p sph --phone 123 --file replies.json --execute   # 人工核准后真发
`.trim();
}
