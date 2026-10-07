/**
 * 抖音数据中心「总览看板」接口验证脚本（正式采集层的可行性探针）。
 *
 * 接口：POST https://creator.douyin.com/janus/douyin/creator/data/overview/dashboard
 * 入参：{"recent_days":N,"date_range":{"start_date":"YYYYMMDD","end_date":"YYYYMMDD"}}
 * 返回：metrics[]（播放量/点赞/评论/分享/净增粉丝/总粉丝量等，trends 为按日明细）
 *
 * 用法：
 *   node scripts/test-douyin-stats.js              # 默认查昨天单日
 *   node scripts/test-douyin-stats.js --days 30    # 查最近 30 天（验证一次拉多天）
 *   node scripts/test-douyin-stats.js --start 20261001 --end 20261005
 *
 * 凭证文件（.mm-* 已在 .gitignore）：.mm-douyin.env
 *   由抓包导入器生成：node scripts/import-ps-capture.js .mm-douyin.env <抓包文本>
 *   需要键：COOKIE、X_SECSDK_CSRF_TOKEN
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnvCreds, requireKeys } = require("./lib/captureCreds");

const CREDENTIAL_FILE = path.join(__dirname, "..", ".mm-douyin.env");
const RESPONSE_DUMP = path.join(__dirname, "..", ".mm-douyin-last-response.json");
const API_URL =
  "https://creator.douyin.com/janus/douyin/creator/data/overview/dashboard";
// 与 src/main/config/ptConfig.js 抖音 UA 保持一致
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function parseArgs() {
  const args = { days: 1, start: "", end: "" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") args.days = Number(argv[++i]) || 1;
    else if (argv[i] === "--start") args.start = argv[++i] || "";
    else if (argv[i] === "--end") args.end = argv[++i] || "";
  }
  return args;
}

function readCredential() {
  const creds = loadEnvCreds(CREDENTIAL_FILE);
  requireKeys(creds, ["COOKIE", "X_SECSDK_CSRF_TOKEN"], CREDENTIAL_FILE);
  return { cookie: creds.COOKIE, csrfToken: creds.X_SECSDK_CSRF_TOKEN };
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function main() {
  const args = parseArgs();
  const { cookie, csrfToken } = readCredential();

  let start = args.start;
  let end = args.end;
  if (!start || !end) {
    const endDate = new Date(Date.now() - 86400000); // 默认昨天
    const startDate = new Date(endDate.getTime() - (args.days - 1) * 86400000);
    start = fmtDate(startDate);
    end = fmtDate(endDate);
  }
  const recentDays = Math.max(
    1,
    Math.round(
      (new Date(
        `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`) -
        new Date(
          `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`)) /
        86400000
    ) + 1
  );

  const body = {
    recent_days: recentDays,
    date_range: { start_date: start, end_date: end },
  };
  console.log(`[请求] ${API_URL}`);
  console.log(`[参数] ${JSON.stringify(body)}`);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN",
      "content-type": "application/json",
      origin: "https://creator.douyin.com",
      referer: "https://creator.douyin.com/creator-micro/data-center/operation",
      "user-agent": USER_AGENT,
      cookie,
      "x-secsdk-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });

  const httpStatus = res.status;
  const text = await res.text();
  console.log(`[HTTP] ${httpStatus}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error("[失败] 响应不是 JSON，前 500 字符：");
    console.error(text.slice(0, 500));
    process.exit(2);
  }
  fs.writeFileSync(RESPONSE_DUMP, JSON.stringify(json, null, 2));

  if (json.status_code !== 0) {
    console.error(`[失败] status_code=${json.status_code} msg=${json.status_msg}`);
    console.error(`完整响应已存到 ${RESPONSE_DUMP}`);
    process.exit(2);
  }

  const metrics = Array.isArray(json.metrics) ? json.metrics : [];
  console.log(`[成功] status_code=0，共 ${metrics.length} 个指标：\n`);
  console.log(
    ["指标", "英文标识", "区间合计", "趋势天数", "首日", "末日"].join("\t")
  );
  for (const m of metrics) {
    const trends = Array.isArray(m.trends) ? m.trends : [];
    const first = trends.length ? trends[0].value : "-";
    const last = trends.length ? trends[trends.length - 1].value : "-";
    console.log(
      [
        m.metric_name || "-",
        m.english_metric_name || "-",
        m.metric_value != null ? m.metric_value : "-",
        trends.length,
        first,
        last,
      ].join("\t")
    );
  }
  console.log(`\n完整响应已存到 ${RESPONSE_DUMP}`);
}

main().catch((err) => {
  console.error("[异常]", err && err.message ? err.message : err);
  process.exit(1);
});
