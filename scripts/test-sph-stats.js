/**
 * 视频号助手（channels.weixin.qq.com）数据接口验证脚本。
 *
 * 接口 1：POST /micro/content/cgi-bin/mmfinderassistant-bin/post/post_list
 *   视频列表，单视频粒度：播放 readCount / 点赞 likeCount / 评论 commentCount /
 *   分享 forwardCount / 收藏 favCount / 单视频涨粉 followCount / 昨日新增播放 yesterdayReadCount
 *   游标分页：响应 data.lastBuff → 下一页 body.rawKeyBuff，continueFlag 标记是否还有
 *
 * 接口 2：POST /cgi-bin/mmfinderassistant-bin/statistic/fans_trend
 *   粉丝趋势，入参 startTs/endTs（秒，UTC+8 零点对齐）+ interval=3
 *
 * 认证：Cookie(sessionid, wxuin) + 请求头 X-WECHAT-UIN / finger-print-device-id，
 *       query 需带 _aid（页面会话 ID）。无签名参数。
 *
 * 用法：
 *   node scripts/test-sph-stats.js            # 列表 + 粉丝趋势都验证
 *   node scripts/test-sph-stats.js list 10 2  # 列表：pageSize=10 拉 2 页验证游标分页
 *   node scripts/test-sph-stats.js fans 30    # 粉丝趋势：最近 30 天
 *
 * 凭证文件（.mm-* 已在 .gitignore）：.mm-sph.env
 *   由抓包导入器生成：node scripts/import-ps-capture.js .mm-sph.env <抓包文本>
 *   需要键：COOKIE、X_WECHAT_UIN、FINGER_PRINT_DEVICE_ID、AID、LOG_FINDER_ID
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnvCreds, requireKeys } = require("./lib/captureCreds");

const CREDENTIAL_FILE = path.join(__dirname, "..", ".mm-sph.env");
const API_BASE = "https://channels.weixin.qq.com";
// 与 src/main/config/ptConfig.js 视频号 UA 保持一致
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF";

function readCredential() {
  const creds = loadEnvCreds(CREDENTIAL_FILE);
  requireKeys(
    creds,
    ["COOKIE", "X_WECHAT_UIN", "FINGER_PRINT_DEVICE_ID", "AID"],
    CREDENTIAL_FILE
  );
  return {
    cookie: creds.COOKIE,
    wechatUin: creds.X_WECHAT_UIN,
    deviceId: creds.FINGER_PRINT_DEVICE_ID,
    aid: creds.AID,
    finderId: creds.LOG_FINDER_ID || "",
  };
}

function genRid() {
  const hex = (n) => {
    let s = "";
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  };
  return `${hex(8)}-${hex(8)}`;
}

/** UTC+8 零点对齐的秒级时间戳 */
function dayStartTs(daysAgo) {
  const now = Date.now() + 8 * 3600 * 1000;
  const todayStart = Math.floor(now / 86400000) * 86400000 - 8 * 3600 * 1000;
  return (todayStart - daysAgo * 86400000) / 1000;
}

async function apiPost(cred, urlPath, pageUrl, body, dumpName) {
  const url =
    `${API_BASE}${urlPath}?_aid=${encodeURIComponent(cred.aid)}` +
    `&_rid=${genRid()}&_pageUrl=${encodeURIComponent(pageUrl)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN",
      "content-type": "application/json",
      origin: API_BASE,
      referer: pageUrl,
      "user-agent": USER_AGENT,
      cookie: cred.cookie,
      "x-wechat-uin": cred.wechatUin,
      "finger-print-device-id": cred.deviceId,
    },
    body: JSON.stringify(body),
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

function fmtDate(sec) {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

async function testPostList(cred, pageSize, maxPages) {
  console.log(`\n=== 视频列表 post_list（pageSize=${pageSize}，最多 ${maxPages} 页）===`);
  let rawKeyBuff = "";
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const body = {
      pageSize,
      currentPage: page,
      userpageType: 11,
      stickyOrder: false,
      timestamp: String(Date.now()),
      _log_finder_uin: "",
      _log_finder_id: cred.finderId,
      rawKeyBuff,
      pluginSessionId: null,
      scene: 7,
      reqScene: 7,
    };
    const { httpStatus, json } = await apiPost(
      cred,
      "/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list",
      "https://channels.weixin.qq.com/micro/content/iframe/post-card.html",
      body,
      page === 1 ? ".mm-sph-last-list.json" : ""
    );
    if (json.errCode !== 0) {
      console.error(`[失败] errCode=${json.errCode} errMsg=${json.errMsg}`);
      return false;
    }
    const data = json.data || {};
    const list = data.list || [];
    total = data.totalCount || 0;
    console.log(
      `第 ${page} 页：${list.length} 条（totalCount=${total}，continueFlag=${data.continueFlag}）`
    );
    for (const v of list) {
      const title =
        ((v.desc && (v.desc.shortTitle?.[0]?.shortTitle || v.desc.description)) ||
          "(无标题)"
        ).slice(0, 18);
      console.log(
        `  ${fmtDate(v.createTime)}  《${title}》 播放=${v.readCount} 赞=${v.likeCount} 评=${v.commentCount} 分享=${v.forwardCount} 收藏=${v.favCount} 涨粉=${v.followCount} 昨日播放+${v.yesterdayReadCount}`
      );
    }
    if (!data.continueFlag || !data.lastBuff) {
      console.log("已没有更多页");
      return true;
    }
    rawKeyBuff = data.lastBuff; // 游标：传给下一页
  }
  console.log(`分页验证完成（账号共 ${total} 个视频）`);
  return true;
}

async function testFansTrend(cred, days) {
  console.log(`\n=== 粉丝趋势 fans_trend（最近 ${days} 天）===`);
  const body = {
    startTs: String(dayStartTs(days)),
    endTs: String(dayStartTs(0)),
    interval: 3,
    timestamp: String(Date.now()),
    _log_finder_uin: "",
    _log_finder_id: cred.finderId,
    rawKeyBuff: "",
    pluginSessionId: null,
    scene: 7,
    reqScene: 7,
  };
  const { json } = await apiPost(
    cred,
    "/cgi-bin/mmfinderassistant-bin/statistic/fans_trend",
    "https://channels.weixin.qq.com/platform",
    body,
    ".mm-sph-last-fans.json"
  );
  if (json.errCode !== 0) {
    console.error(`[失败] errCode=${json.errCode} errMsg=${json.errMsg}`);
    return false;
  }
  console.log("[成功] errCode=0，响应顶层字段：", Object.keys(json.data || json));
  console.log(JSON.stringify(json.data || json, null, 2).slice(0, 2000));
  console.log("完整响应已存到 .mm-sph-last-fans.json");
  return true;
}

async function main() {
  const cred = readCredential();
  const mode = process.argv[2] || "all";
  if (mode === "list" || mode === "all") {
    const pageSize = Number(process.argv[3]) || 5;
    const maxPages = Number(process.argv[4]) || 2;
    await testPostList(cred, pageSize, maxPages);
  }
  if (mode === "fans" || mode === "all") {
    const days = Number(process.argv[3]) || 30;
    await testFansTrend(cred, days);
  }
}

main().catch((err) => {
  console.error("[异常]", err && err.message ? err.message : err);
  process.exit(1);
});
