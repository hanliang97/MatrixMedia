/**
 * 哔哩哔哩创作中心（member.bilibili.com）数据接口验证脚本。
 *
 * 接口 1：GET /x/web/data/index/stat
 *   账号总量看板：total_click 播放 / total_reply 评论 / total_dm 弹幕 /
 *   total_like 点赞 / total_share 分享 / total_fav 收藏 / total_coin 投币 / total_fans 粉丝
 *   另有 incr_* 昨日增量，log_date 标记数据日期（T+1）
 *
 * 接口 2：GET /x/web/archives?status=is_pubing,pubed,not_pubed&pn=N&ps=10&coop=1&interactive=1
 *   稿件列表（页码分页 page.count=总数），arc_audits[] 每项：
 *   Archive.title / bvid / cover / ptime(发布秒级时间戳) + stat.view/like/reply/favorite/share/coin/danmaku
 *
 * 认证：仅 Cookie（SESSDATA 关键），无签名参数。
 *
 * 用法：
 *   node scripts/test-bilibili-stats.js          # 总览 + 列表翻页验证
 *   node scripts/test-bilibili-stats.js list 3   # 只验证列表，拉 3 页
 *
 * 凭证文件（.mm-* 已在 .gitignore）：.mm-bilibili.env
 *   由抓包导入器生成：node scripts/import-ps-capture.js .mm-bilibili.env <抓包文本>
 *   需要键：COOKIE
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnvCreds, requireKeys } = require("./lib/captureCreds");

const CREDENTIAL_FILE = path.join(__dirname, "..", ".mm-bilibili.env");
const API_BASE = "https://member.bilibili.com";
// 与 src/main/config/ptConfig.js 哔哩哔哩 UA 保持一致
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// 页面请求固定携带的环境参数（照抄创作中心页面请求）
const COMMON_QUERY =
  "x-bili-device-req-json=" +
  encodeURIComponent(
    JSON.stringify({
      platform: "web",
      device: "pc",
      mobi_app: "web_cn",
      spmid: "333.885",
    })
  ) +
  "&x-bili-locale-json=" +
  encodeURIComponent(
    JSON.stringify({ c_locale: { language: "zh", script: "Hans" }, always_translate: false })
  ) +
  "&tmid=NaN";

function readCookie() {
  const creds = loadEnvCreds(CREDENTIAL_FILE);
  requireKeys(creds, ["COOKIE"], CREDENTIAL_FILE);
  return creds.COOKIE;
}

async function apiGet(cookie, urlPath, extraQuery, referer, dumpName) {
  const url = `${API_BASE}${urlPath}?${COMMON_QUERY}${extraQuery ? "&" + extraQuery : ""}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-language": "zh-CN",
      referer,
      "user-agent": USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      cookie,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error(`[失败] ${urlPath} 响应非 JSON，HTTP ${res.status}：`);
    console.error(text.slice(0, 500));
    process.exit(2);
  }
  if (dumpName) {
    fs.writeFileSync(
      path.join(__dirname, "..", dumpName),
      JSON.stringify(json, null, 2)
    );
  }
  return json;
}

function fmtDate(sec) {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function testOverview(cookie) {
  console.log("=== 账号总览 /x/web/data/index/stat ===");
  const json = await apiGet(
    cookie,
    "/x/web/data/index/stat",
    "",
    "https://member.bilibili.com/platform/home",
    ".mm-bilibili-last-stat.json"
  );
  if (json.code !== 0) {
    console.error(`[失败] code=${json.code} message=${json.message}`);
    return false;
  }
  const d = json.data || {};
  console.log(`数据日期 log_date=${d.log_date}（T+1）`);
  console.log(
    `播放=${d.total_click} 点赞=${d.total_like} 评论=${d.total_reply} 弹幕=${d.total_dm} 分享=${d.total_share} 收藏=${d.total_fav} 投币=${d.total_coin} 粉丝=${d.total_fans}`
  );
  console.log(
    `昨日增量：播放+${d.incr_click} 点赞+${d.inc_like} 评论+${d.incr_reply} 分享+${d.inc_share} 收藏+${d.inc_fav} 粉丝+${d.incr_fans}`
  );
  return true;
}

async function testArchives(cookie, maxPages) {
  console.log(`\n=== 稿件列表 /x/web/archives（最多 ${maxPages} 页）===`);
  for (let pn = 1; pn <= maxPages; pn++) {
    const json = await apiGet(
      cookie,
      "/x/web/archives",
      `status=is_pubing,pubed,not_pubed&pn=${pn}&ps=10&coop=1&interactive=1`,
      "https://member.bilibili.com/platform/upload-manager/article?group=is_pubing&page=1",
      pn === 1 ? ".mm-bilibili-last-archives.json" : ""
    );
    if (json.code !== 0) {
      console.error(`[失败] code=${json.code} message=${json.message}`);
      return false;
    }
    const data = json.data || {};
    const page = data.page || {};
    const list = data.arc_audits || [];
    console.log(`第 ${pn} 页：${list.length} 条（共 ${page.count} 个稿件）`);
    for (const item of list) {
      const a = item.Archive || {};
      const s = item.stat || {};
      const title = String(a.title || "(无标题)").slice(0, 18);
      console.log(
        `  ${fmtDate(a.ptime)}  《${title}》 播放=${s.view} 赞=${s.like} 评=${s.reply} 收藏=${s.favorite} 分享=${s.share} 投币=${s.coin} [${a.bvid}]`
      );
    }
    if (!page.count || pn * 10 >= page.count) {
      console.log("已拉完全部页");
      return true;
    }
  }
  return true;
}

async function main() {
  const cookie = readCookie();
  const mode = process.argv[2] || "all";
  if (mode === "list") {
    await testArchives(cookie, Number(process.argv[3]) || 3);
    return;
  }
  await testOverview(cookie);
  await testArchives(cookie, 3);
}

main().catch((err) => {
  console.error("[异常]", err && err.message ? err.message : err);
  process.exit(1);
});
