/**
 * 百家号（baijiahao.baidu.com）数据接口验证脚本。
 *
 * 接口 1：GET /pcui/home/index
 *   首页概览：coreData.viewCount 播放总计 / fansCount 粉丝总量（另含收益字段，不采集）
 *
 * 接口 2：GET /pcui/article/lists?currentPage=N&pageSize=10
 *   内容列表（页码分页 page.totalCount/totalPage），每项：
 *   title / publish_time / type（ugc_video 视频、video_set 合集需区分）/
 *   read_amount 播放 / comment_amount 评论 / share_amount 分享 /
 *   like_amount 点赞 / collection_amount 收藏
 *
 * 认证：Cookie（BDUSS 关键）+ `token` 请求头（JWT，约 12 小时过期；
 *       正式上线走页面上下文 fetch，由百家号前端自己的拦截器注入 token）。
 *
 * 用法：
 *   node scripts/test-bjh-stats.js          # 概览 + 列表翻页
 *   node scripts/test-bjh-stats.js list 4   # 只拉列表，4 页
 *
 * 凭证文件（.mm-* 已在 .gitignore）：.mm-bjh.env
 *   由抓包导入器生成：node scripts/import-ps-capture.js .mm-bjh.env <抓包文本>
 *   需要键：COOKIE、TOKEN
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnvCreds, requireKeys } = require("./lib/captureCreds");

const CREDENTIAL_FILE = path.join(__dirname, "..", ".mm-bjh.env");
const API_BASE = "https://baijiahao.baidu.com";
// 与 src/main/config/ptConfig.js 百家号 UA 保持一致
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

function readCredential() {
  const creds = loadEnvCreds(CREDENTIAL_FILE);
  requireKeys(creds, ["COOKIE", "TOKEN"], CREDENTIAL_FILE);
  return { cookie: creds.COOKIE, token: creds.TOKEN };
}

async function apiGet(cred, urlPath, referer, dumpName) {
  const url = `${API_BASE}${urlPath}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN",
      referer,
      "user-agent": USER_AGENT,
      cookie: cred.cookie,
      token: cred.token,
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
  return { httpStatus: res.status, json };
}

async function testOverview(cred) {
  console.log("=== 首页概览 /pcui/home/index ===");
  const { json } = await apiGet(
    cred,
    "/pcui/home/index",
    "https://baijiahao.baidu.com/builder/rc/home",
    ".mm-bjh-last-home.json"
  );
  const core = json.coreData || (json.data && json.data.coreData);
  if (!core) {
    console.error("[失败] 未拿到 coreData，响应顶层字段：", Object.keys(json));
    console.error(JSON.stringify(json).slice(0, 300));
    return false;
  }
  console.log(`播放总计=${core.viewCount} 粉丝总量=${core.fansCount} 昨日收益=${core.yesterdayIncome} 本月收益=${core.monthIncome}`);
  return true;
}

async function testList(cred, maxPages) {
  console.log(`\n=== 内容列表 /pcui/article/lists（最多 ${maxPages} 页）===`);
  for (let page = 1; page <= maxPages; page++) {
    const { json } = await apiGet(
      cred,
      `/pcui/article/lists?currentPage=${page}&pageSize=10&search=&type=&collection=&startDate=&endDate=&clearBeforeFetch=false&dynamic=1`,
      "https://baijiahao.baidu.com/builder/rc/content?currentPage=1&pageSize=10",
      page === 1 ? ".mm-bjh-last-list.json" : ""
    );
    const list = Array.isArray(json.list)
      ? json.list
      : (json.data && json.data.list) || [];
    const pageInfo = json.page || (json.data && json.data.page) || {};
    if (!list.length && page === 1) {
      console.error("[失败] 列表为空，响应顶层字段：", Object.keys(json));
      return false;
    }
    console.log(
      `第 ${page} 页：${list.length} 条（共 ${pageInfo.totalCount} 条 / ${pageInfo.totalPage} 页）`
    );
    for (const item of list) {
      const typeTag = item.type === "video_set" ? "[合集]" : "";
      const title = String(item.title || "(无标题)").slice(0, 18);
      console.log(
        `  ${item.publish_time}  《${title}》${typeTag} 播放=${item.read_amount} 赞=${item.like_amount} 评=${item.comment_amount} 分享=${item.share_amount} 收藏=${item.collection_amount}`
      );
    }
    if (pageInfo.totalPage && page >= pageInfo.totalPage) {
      console.log("已拉完全部页");
      return true;
    }
  }
  return true;
}

async function main() {
  const cred = readCredential();
  const mode = process.argv[2] || "all";
  if (mode === "list") {
    await testList(cred, Number(process.argv[3]) || 4);
    return;
  }
  await testOverview(cred);
  await testList(cred, 4);
}

main().catch((err) => {
  console.error("[异常]", err && err.message ? err.message : err);
  process.exit(1);
});
