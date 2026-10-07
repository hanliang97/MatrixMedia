"use strict";

import { PLATFORM_ALIASES } from "../../shared/publishPlatforms.js";

/** 数据统计支持的平台（番茄视频、掘金无数据接口） */
const STATS_CANONICAL = [
  "抖音",
  "视频号",
  "哔哩哔哩",
  "百家号",
  "头条",
  "快手",
  "小红书",
];

const ACTIONS = new Set(["get", "sync", "work"]);

export function parseStatsArgs(subArgv, action) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }
  const out = { action, platform: null, phone: null, title: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") {
      out.platform = args[++i];
    } else if (a === "--phone") {
      out.phone = args[++i];
    } else if (a === "--title") {
      out.title = args[++i];
    } else if (a === "--json") {
      out.json = true;
    } else {
      return { ok: false, error: `未知参数: ${a}` };
    }
  }

  if (!out.platform) return { ok: false, error: "缺少 -p/--platform" };
  const raw = String(out.platform).trim();
  const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[raw.toLowerCase()] || raw;
  if (!STATS_CANONICAL.includes(pt)) {
    return {
      ok: false,
      error: `不支持的平台: ${out.platform}（统计支持：${STATS_CANONICAL.join("/")}）`,
    };
  }
  out.platform = pt;

  if (!out.phone) return { ok: false, error: "缺少 --phone（分组名）" };
  out.phone = String(out.phone).trim();

  if (out.action === "work" && !out.title) {
    return { ok: false, error: "stats-work 需要 --title（视频标题）" };
  }
  return { ok: true, value: out };
}

export function statsHelpText(cmd) {
  const usage = {
    get: "读取本地快照中的账号粉丝数据（粉丝/播放/点赞/评论/收藏）",
    sync: "立即采集该账号最新数据并写入本地快照（需该分组此平台已在 GUI 登录）",
    work: "按标题查询某个视频的发布数据（播放/赞/评/收藏/分享/发布时间）",
  }[cmd];
  return `
用法: <应用> cli ${cmd} -p <平台> --phone <分组> [选项]

${usage}

选项:
  -p, --platform <id>   平台：dy|抖音、sph|视频号、blbl|哔哩哔哩、bjh|百家号、tt|头条、ks|快手、xhs|小红书
      --phone <id>      分组名（与 GUI「媒体平台管理」里的分组一致）
      --title <标题>    仅 stats-work：完整视频标题
      --json            以 JSON 输出（默认即 JSON，便于脚本消费）
  -h, --help            显示本帮助

退出码: 0 成功, 1 异常（如未登录/未找到）, 2 参数错误

示例:
  matrixmedia cli stats -p sph --phone 123
  matrixmedia cli stats-sync -p dy --phone 123
  matrixmedia cli stats-work -p ks --phone 123 --title "你家猫也这样睡？"
`.trim();
}
