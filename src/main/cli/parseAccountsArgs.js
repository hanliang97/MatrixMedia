"use strict";

const PLATFORM_ALIASES = {
  dy: "抖音",
  douyin: "抖音",
  抖音: "抖音",
  sph: "视频号",
  视频号: "视频号",
  blbl: "哔哩哔哩",
  bilibili: "哔哩哔哩",
  哔哩哔哩: "哔哩哔哩",
  bjh: "百家号",
  百家号: "百家号",
  tt: "头条",
  toutiao: "头条",
  头条: "头条",
  ks: "快手",
  kuaishou: "快手",
  快手: "快手",
};

const CANONICAL = ["抖音", "视频号", "哔哩哔哩", "百家号", "头条", "快手"];

export function parseAccountsArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }

  const out = {
    platform: null,
    phone: null,
    json: false,
    onlyLoggedIn: false,
    onlyLoggedOut: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") {
      out.platform = args[++i];
    } else if (a === "--phone") {
      out.phone = args[++i];
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--logged-in") {
      out.onlyLoggedIn = true;
    } else if (a === "--logged-out") {
      out.onlyLoggedOut = true;
    } else {
      return { ok: false, error: `未知参数: ${a}` };
    }
  }

  if (out.onlyLoggedIn && out.onlyLoggedOut) {
    return { ok: false, error: "--logged-in 与 --logged-out 互斥" };
  }

  if (out.platform) {
    const raw = String(out.platform).trim();
    const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[raw.toLowerCase()] || raw;
    if (!CANONICAL.includes(pt)) {
      return { ok: false, error: `未知平台: ${out.platform}` };
    }
    out.platform = pt;
  }

  return { ok: true, value: out };
}

export function accountsHelpText() {
  return `
用法: <应用> cli accounts [选项]

读取 GUI 维护的账号树，对每个账号用 session.fromPartition 查登录 cookie，输出登录态。
数据来源：<Documents>/MatrixMedia/data/account/*.json（与 GUI 共用）。

选项:
  -p, --platform <id>   仅列某个平台：dy|抖音、tt|头条、ks|快手、blbl|哔哩哔哩、bjh|百家号、sph|视频号
      --phone <id>      仅列某个手机号（支持前缀匹配完整 phone 字段）
      --logged-in       仅显示已登录账号
      --logged-out      仅显示未登录/已失效账号
      --json            以 JSON 输出（便于脚本消费）
  -h, --help            显示本帮助

退出码: 0 正常输出, 1 异常, 2 参数错误

示例:
  matrixmedia cli accounts
  matrixmedia cli accounts -p dy --json
  matrixmedia cli accounts --phone 13800138000 --logged-out
`.trim();
}
