/**
 * 数据统计 Electron 探针：复用已登录的分组环境（session partition），
 * 在平台页面上下文中直接请求数据接口——验证正式采集链路可行性。
 *
 * 用法（先完全退出矩媒 app，避免 cookie 库被占用）：
 *   npx electron scripts/electron-probe/stats-probe.js --platform douyin --group 123
 *   npx electron scripts/electron-probe/stats-probe.js --platform sph --group 123
 *   npx electron scripts/electron-probe/stats-probe.js --platform bjh --group 123 --dump-storage
 *   npx electron scripts/electron-probe/stats-probe.js --platform bilibili --group 123
 *
 * --dump-storage：打印页面 localStorage/sessionStorage 键名，用于定位 token 等动态凭证
 */

"use strict";

const { app, BrowserWindow, session } = require("electron");
const path = require("path");

const USER_DATA = path.join(
  process.env.HOME || "",
  "Library/Application Support/matrix-video"
);

/* ---------------- 平台配置：落地页 + 页面内执行的取数脚本 ---------------- */

// 昨天/前 N 天日期（YYYYMMDD，东八区）
function dayStr(daysAgo) {
  const d = new Date(Date.now() + 8 * 3600e3 - daysAgo * 86400e3);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const PLATFORMS = {
  douyin: {
    partitionSuffix: "抖音",
    landingPage: "https://creator.douyin.com/creator-micro/data-center/operation",
    settleSec: 6, // 等 secsdk 初始化
    pageScript: (days) => `
      (async () => {
        const out = {};
        // 1) 数据中心看板（按日趋势）
        try {
          const body = { recent_days: ${days}, date_range: { start_date: "${dayStr(
            days
          )}", end_date: "${dayStr(1)}" } };
          const res = await fetch("/janus/douyin/creator/data/overview/dashboard", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/plain, */*" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          const json = JSON.parse(await res.text());
          out.dashboard = { status: res.status, status_code: json.status_code, msg: json.status_msg || "", metrics: (json.metrics||[]).length, trendDays: json.metrics && json.metrics[0] ? (json.metrics[0].trends||[]).length : 0 };
        } catch (e) { out.dashboard = { error: String(e) }; }
        // 2) 作品列表（单视频粒度，游标分页 max_cursor）
        try {
          const url = "/janus/douyin/creator/pc/work_list?scene=star_atlas&device_platform=android&status=0&count=12&max_cursor=0&aid=1128&support_h265=1";
          const res = await fetch(url, { headers: { accept: "application/json, text/plain, */*" }, credentials: "include" });
          const json = JSON.parse(await res.text());
          out.workList = {
            status: res.status,
            status_code: json.status_code,
            total: json.total,
            has_more: json.has_more,
            items: (json.items || []).map((it) => ({
              id: it.id,
              title: (it.description || "").slice(0, 20),
              create_time: it.create_time,
              view: it.metrics && it.metrics.view_count,
              like: it.metrics && it.metrics.like_count,
              comment: it.metrics && it.metrics.comment_count,
              favorite: it.metrics && it.metrics.favorite_count,
              share: it.metrics && it.metrics.share_count,
              subscribe: it.metrics && it.metrics.subscribe_count,
            })),
          };
        } catch (e) { out.workList = { error: String(e) }; }
        return out;
      })()
    `,
  },
  sph: {
    partitionSuffix: "视频号",
    landingPage: "https://channels.weixin.qq.com/platform",
    settleSec: 6,
    // 与 ptConfig 视频号一致：微信内置浏览器 UA，否则平台拒绝服务
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF",
    pageScript: () => `
      (async () => {
        // 页面上下文里取 _aid / uin 等（若页面全局对象有的话）
        const now = Date.now() + 8*3600e3;
        const todayStart = Math.floor(now/86400e3)*86400e3 - 8*3600e3;
        const body = {
          startTs: String((todayStart - 30*86400e3)/1000),
          endTs: String(todayStart/1000),
          interval: 3, timestamp: String(Date.now()),
          _log_finder_uin: "", _log_finder_id: "", rawKeyBuff: "",
          pluginSessionId: null, scene: 7, reqScene: 7,
        };
        try {
          const res = await fetch("/cgi-bin/mmfinderassistant-bin/statistic/fans_trend", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "*/*" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          const text = await res.text();
          return { ok: true, status: res.status, body: text.slice(0, 3000) };
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
  },
  bjh: {
    partitionSuffix: "百家号",
    landingPage: "https://baijiahao.baidu.com/builder/rc/home",
    settleSec: 5,
    pageScript: () => `
      (async () => {
        try {
          const res = await fetch("/pcui/home/index", {
            headers: { accept: "application/json, text/plain, */*" },
            credentials: "include",
          });
          const text = await res.text();
          return { ok: true, status: res.status, body: text.slice(0, 2000) };
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
  },
  bilibili: {
    partitionSuffix: "哔哩哔哩",
    landingPage: "https://member.bilibili.com/platform/home",
    settleSec: 5,
    pageScript: () => `
      (async () => {
        try {
          const res = await fetch("/x/web/data/index/stat", {
            headers: { accept: "application/json, text/javascript, */*; q=0.01" },
            credentials: "include",
          });
          const text = await res.text();
          return { ok: true, status: res.status, body: text.slice(0, 2000) };
        } catch (e) { return { ok: false, error: String(e) }; }
      })()
    `,
  },
  toutiao: {
    partitionSuffix: "头条",
    landingPage: "https://mp.toutiao.com/profile_v4/index",
    settleSec: 5,
    pageScript: () => `
      (async () => {
        const out = {};
        // 1) 首页聚合：粉丝/总播放
        try {
          const res = await fetch("/mp/fe_api/home/merge_v2?app_id=1231", {
            headers: { accept: "application/json, text/plain, */*" },
            credentials: "include",
          });
          const j = JSON.parse(await res.text());
          const st = j.data && j.data.statistic && j.data.statistic.data;
          out.home = {
            status: res.status,
            fans: st && st.total_subscribe_count,
            totalPlay: st && st.total_read_play_count,
            fansDetail: st && st.fans_count_data,
          };
        } catch (e) { out.home = { error: String(e) }; }
        // 2) 作品列表（offset 游标分页；visited_uid 从 localStorage __tea_cache_tokens_1231 取）
        try {
          let uid = "";
          try {
            const tokens = JSON.parse(localStorage.getItem("__tea_cache_tokens_1231") || "{}");
            uid = String(tokens.user_unique_id || "");
          } catch (e) { /* ignore */ }
          const genreSwitch = encodeURIComponent(JSON.stringify({ repost: 1, small_video: 1, toutiao_graphic: 1, weitoutiao: 1, xigua_video: 1 }));
          const clientExtra = encodeURIComponent(JSON.stringify({ category: "mp_all", real_app_id: "1231", need_forward: "true", offset_mode: "1", page_index: "1", status: "8", source: "0" }));
          const url = "/api/feed/mp_provider/v1/?provider_type=mp_provider&aid=13&app_name=news_article&category=mp_all&stream_api_version=88&genre_type_switch=" + genreSwitch + "&device_platform=pc&platform_id=0&visited_uid=" + uid + "&offset=0&count=10&keyword=&client_extra_params=" + clientExtra + "&app_id=1231";
          const res = await fetch(url, {
            headers: { accept: "application/json, text/plain, */*" },
            credentials: "include",
          });
          const j = JSON.parse(await res.text());
          out.works = {
            status: res.status,
            uid,
            page1Count: (j.data || []).length,
            page1HasMore: j.has_more,
            page1Offset: j.offset,
          };
          // 手动验证第二页（用第一页返回的 offset 游标）
          if (j.has_more && j.offset) {
            const clientExtra2 = encodeURIComponent(JSON.stringify({ category: "mp_all", real_app_id: "1231", need_forward: "true", offset_mode: "1", page_index: "2", status: "8", source: "0" }));
            const url2 = "/api/feed/mp_provider/v1/?provider_type=mp_provider&aid=13&app_name=news_article&category=mp_all&stream_api_version=88&genre_type_switch=" + genreSwitch + "&device_platform=pc&platform_id=0&visited_uid=" + uid + "&offset=" + j.offset + "&count=10&keyword=&client_extra_params=" + clientExtra2 + "&app_id=1231";
            const res2 = await fetch(url2, { headers: { accept: "application/json, text/plain, */*" }, credentials: "include" });
            const j2 = JSON.parse(await res2.text());
            out.works.page2 = {
              count: (j2.data || []).length,
              has_more: j2.has_more,
              offset: j2.offset,
              errno: j2.errno,
              firstTitle: j2.data && j2.data[0] && j2.data[0].assembleCell && j2.data[0].assembleCell.itemCell && j2.data[0].assembleCell.itemCell.articleBase ? j2.data[0].assembleCell.itemCell.articleBase.title : null,
            };
          }
          out.works.count = (j.data || []).length;
          out.works.items = (j.data || []).slice(0, 5).map((it) => {
            const cell = (it.assembleCell && it.assembleCell.itemCell) || {};
            const base = cell.articleBase || {};
            const counter = cell.itemCounter || {};
            return {
              title: String(base.title || "").slice(0, 15),
              publishTime: base.publishTime,
              show: counter.showCount,
              play: counter.videoWatchCount,
              read: counter.readCount,
              digg: counter.diggCount,
              comment: counter.commentCount,
              repin: counter.repinCount,
            };
          });
        } catch (e) { out.works = { error: String(e) }; }
        return out;
      })()
    `,
  },
  xhs: {
    partitionSuffix: "小红书",
    landingPage: "https://creator.xiaohongshu.com/new/home",
    settleSec: 7,
    pageScript: () => `
      (async () => {
        const out = {};
        // 1) 签名函数探测：小红书 web 签名通常挂在 window._webmsxyw
        out.signFn = typeof window._webmsxyw === "function" ? "found" : "missing";
        // 2) 裸 fetch（不带 x-s）验证是否放行
        try {
          const res = await fetch("/api/galaxy/creator/home/personal_info", {
            headers: { accept: "application/json, text/plain, */*" },
            credentials: "include",
          });
          out.rawInfo = { status: res.status, body: (await res.text()).slice(0, 200) };
        } catch (e) { out.rawInfo = { error: String(e) }; }
        // 3) 用页面签名函数签名后再请求
        if (typeof window._webmsxyw === "function") {
          const signed = async (url) => {
            const sign = window._webmsxyw(url, undefined) || {};
            const headers = { accept: "application/json, text/plain, */*" };
            if (sign["X-s"]) headers["x-s"] = sign["X-s"];
            if (sign["X-t"]) headers["x-t"] = String(sign["X-t"]);
            if (sign["X-s-common"]) headers["x-s-common"] = sign["X-s-common"];
            const res = await fetch(url, { headers, credentials: "include" });
            return { status: res.status, json: JSON.parse(await res.text()) };
          };
          try {
            const info = await signed("/api/galaxy/creator/home/personal_info");
            const d = info.json && info.json.data;
            out.signedInfo = {
              status: info.status, code: info.json && info.json.code,
              fans: d && d.fans_count, faved: d && d.faved_count, name: d && d.name,
            };
          } catch (e) { out.signedInfo = { error: String(e) }; }
          try {
            const notes = await signed("/api/galaxy/v2/creator/note/user/posted?tab=0&page=0");
            const d = notes.json && notes.json.data;
            out.signedNotes = {
              status: notes.status, code: notes.json && notes.json.code,
              page: d && d.page,
              count: d && d.notes ? d.notes.length : 0,
              first: d && d.notes && d.notes[0] && {
                title: String(d.notes[0].display_title || "").slice(0, 15),
                view: d.notes[0].view_count, likes: d.notes[0].likes,
                collect: d.notes[0].collected_count, comment: d.notes[0].comments_count,
                share: d.notes[0].shared_count,
              },
            };
          } catch (e) { out.signedNotes = { error: String(e) }; }
        }
        return out;
      })()
    `,
  },
  kuaishou: {
    partitionSuffix: "快手",
    landingPage: "https://cp.kuaishou.com/article/manage/video",
    settleSec: 6,
    // 作品列表接口强制验签 __NS_sig3（页面 JS 生成），嗅探页面自身请求获取
    capturePattern: /photo\/list\?__NS_sig3=([0-9a-f]+)/,
    pageScript: () => `
      (async () => {
        const out = {};
        // api_ph：body 必带，值与同名 cookie 一致，页面里从 cookie 读
        const apiPh = (document.cookie.match(/(?:^|;\\s*)kuaishou\\.web\\.cp\\.api_ph=([^;]+)/) || [])[1] || "";
        out.apiPh = apiPh ? "ok" : "missing";
        // 1) 用户信息（粉丝）——裸 fetch 不带 __NS_sig3 验证是否放行
        try {
          const res = await fetch("/rest/cp/creator/pc/home/userInfo", {
            method: "POST",
            headers: { "content-type": "application/json;charset=UTF-8", accept: "application/json, text/plain, */*" },
            credentials: "include",
            body: JSON.stringify({ "kuaishou.web.cp.api_ph": apiPh }),
          });
          const j = JSON.parse(await res.text());
          out.userInfo = {
            status: res.status,
            result: j.result,
            message: j.message,
            fans: j.data && j.data.coreUserInfo && j.data.coreUserInfo.fansNum,
            userName: j.data && j.data.coreUserInfo && j.data.coreUserInfo.userName,
          };
        } catch (e) { out.userInfo = { error: String(e) }; }
        // 2) 作品列表（带嗅探到的 __NS_sig3）
        try {
          const sig3 = window.__probeSig3 || "";
          const res = await fetch("/rest/cp/works/v2/video/pc/photo/list?__NS_sig3=" + sig3, {
            method: "POST",
            headers: { "content-type": "application/json;charset=UTF-8", accept: "application/json, text/plain, */*" },
            credentials: "include",
            body: JSON.stringify({
              queryType: "0", cursor: 1893456000000, startTime: 1759852800000,
              endTime: 1893456000000, limit: 30, timeRangeType: 5, keyword: "",
              "kuaishou.web.cp.api_ph": apiPh,
            }),
          });
          const j = JSON.parse(await res.text());
          const list = (j.data && j.data.list) || [];
          out.works = {
            status: res.status,
            result: j.result,
            total: j.data && j.data.total,
            nextCursor: j.data && j.data.nextCursor,
            count: list.length,
            first: list[0] && {
              title: String(list[0].title || "").slice(0, 15),
              play: list[0].playCount,
              like: list[0].likeCount,
              comment: list[0].commentCount,
            },
          };
          // 探测页面上的签名相关全局对象（找 sig3 生成入口）
        try {
          const hits = [];
          const fns = [];
          for (const k of Object.keys(window)) {
            if (/sig3|nsdk|__NS/i.test(k)) hits.push(k + " [" + typeof window[k] + "]");
            else if (/sign|sig/i.test(k)) fns.push(k + " [" + typeof window[k] + "]");
          }
          const containers = {};
          for (const k of ["nsdk", "NSDK", "__NSDK", "__NS", "kuaishou", "KS", "ksApi", "ksc"]) {
            if (window[k]) {
              containers[k] = Object.keys(window[k]).slice(0, 30);
            }
          }
          out.scan = { hits, fns: fns.slice(0, 40), containers };
        } catch (e) { out.scan = { error: String(e) }; }
          const sameBody = JSON.stringify({
            queryType: "0", cursor: 1893456000000, startTime: 1759852800000,
            endTime: 1893456000000, limit: 30, timeRangeType: 5, keyword: "",
            "kuaishou.web.cp.api_ph": apiPh,
          });
          const resSame = await fetch("/rest/cp/works/v2/video/pc/photo/list?__NS_sig3=" + sig3, {
            method: "POST",
            headers: { "content-type": "application/json;charset=UTF-8", accept: "application/json, text/plain, */*" },
            credentials: "include",
            body: sameBody,
          });
          const jSame = JSON.parse(await resSame.text());
          out.works.sameBodyRepeatResult = jSame.result;
          // 实验 B：同一 sig3 换 cursor 翻页（验证是否与 body 绑定）
          if (out.works && out.works.result === 1 && out.works.nextCursor) {
            const res2 = await fetch("/rest/cp/works/v2/video/pc/photo/list?__NS_sig3=" + sig3, {
              method: "POST",
              headers: { "content-type": "application/json;charset=UTF-8", accept: "application/json, text/plain, */*" },
              credentials: "include",
              body: JSON.stringify({
                queryType: "0", cursor: Number(out.works.nextCursor), startTime: 1759852800000,
                endTime: 1893456000000, limit: 30, timeRangeType: 5, keyword: "",
                "kuaishou.web.cp.api_ph": apiPh,
              }),
            });
            const j2 = JSON.parse(await res2.text());
            out.works.page2result = j2.result;
            out.works.page2count = (j2.data && j2.data.list || []).length;
          }
        } catch (e) { out.works = { error: String(e) }; }
        return out;
      })()
    `,
  },
};

/* ---------------- 主流程 ---------------- */

function parseArgs() {
  const args = { platform: "", group: "123", days: 30, dumpStorage: false, profile: "", mode: "api" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--platform") args.platform = argv[++i];
    else if (argv[i] === "--group") args.group = argv[++i];
    else if (argv[i] === "--days") args.days = Number(argv[++i]) || 30;
    else if (argv[i] === "--dump-storage") args.dumpStorage = true;
    else if (argv[i] === "--profile") args.profile = argv[++i];
    else if (argv[i] === "--mode") args.mode = argv[++i];
  }
  return args;
}

async function main(args) {
  const cfg = PLATFORMS[args.platform];
  if (!cfg) {
    console.error(`未知平台 ${args.platform}，可选：${Object.keys(PLATFORMS).join(", ")}`);
    app.exit(1);
    return;
  }
  const userData = args.profile || USER_DATA;
  const partition = `persist:${args.group}${cfg.partitionSuffix}`;
  console.log(`[探针] userData=${userData}`);
  console.log(`[探针] partition=${partition}`);

  app.setPath("userData", userData);
  // 独立探针进程避免与正在运行的 app 争用 GPU/单例
  app.commandLine.appendSwitch("disable-gpu");
  await app.whenReady();

  const ses = session.fromPartition(partition);
  const cookies = await ses.cookies.get({});
  console.log(`[探针] session cookie 数=${cookies.length}`);
  console.log(
    `[探针] cookie 名单：${cookies
      .map((c) => `${c.name}${c.value ? "" : "(空值!)"}`)
      .join(", ")}`
  );
  if (cookies.length === 0) {
    console.error("[探针] 该分组环境没有 cookie——请确认分组名，且矩媒 app 里该平台已登录");
  }

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { partition },
  });
  if (cfg.userAgent) win.webContents.setUserAgent(cfg.userAgent);
  win.webContents.on("console-message", (_e, _l, msg) => {
    if (/probe/i.test(msg)) console.log("[页面]", msg);
  });

  console.log(`[探针] 加载落地页 ${cfg.landingPage}`);
  // 签名嗅探：页面自身请求中带出的签名参数，捕获后注入页面供复用
  let capturedSig3 = "";
  if (cfg.capturePattern) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (!capturedSig3) {
        const m = details.url.match(cfg.capturePattern);
        if (m) {
          capturedSig3 = m[1];
          console.log(`[探针] 捕获到页面签名 __NS_sig3=${capturedSig3.slice(0, 16)}…`);
        }
      }
      callback({});
    });
  }
  await win.loadURL(cfg.landingPage);
  console.log(`[探针] 页面加载完成，等待 ${cfg.settleSec}s 让页面 SDK 就绪…`);
  await new Promise((r) => setTimeout(r, cfg.settleSec * 1000));

  const finalUrl = win.webContents.getURL();
  console.log(`[探针] 当前页面 URL：${finalUrl}`);
  if (/login|passport/.test(finalUrl)) {
    console.error("[探针] 被重定向到登录页——该分组此平台登录态已失效");
  }

  if (cfg.capturePattern && capturedSig3) {
    await win.webContents.executeJavaScript(
      `window.__probeSig3 = ${JSON.stringify(capturedSig3)}; true`
    );
  } else if (cfg.capturePattern) {
    console.warn("[探针] 未捕获到签名（页面可能未自动发起目标请求）");
  }

  if (args.dumpStorage) {
    const storage = await win.webContents.executeJavaScript(`(() => {
      const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = String(s.getItem(k)).slice(0, 120); } return o; };
      return { localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) };
    })()`);
    console.log("[探针] localStorage:", JSON.stringify(storage.localStorage, null, 2));
    console.log("[探针] sessionStorage:", JSON.stringify(storage.sessionStorage, null, 2));
  }

  console.log("[探针] 在页面上下文发起数据请求…");
  const result = await win.webContents.executeJavaScript(cfg.pageScript(args.days));
  console.log("[结果]", JSON.stringify(result, null, 2));

  win.destroy();
  app.quit();
}

/** 全链路模式：走正式采集代码 collector + store（写到当前 userData 的 data-stats/） */
async function mainCollect(args) {
  const cfg = PLATFORMS[args.platform];
  if (!cfg) {
    console.error(`未知平台 ${args.platform}`);
    app.exit(1);
    return;
  }
  const { collectAccount } = require("../../src/main/services/dataStats/collector.js");
  const store = require("../../src/main/services/dataStats/store.js");

  app.setPath("userData", args.profile || USER_DATA);
  app.commandLine.appendSwitch("disable-gpu");
  await app.whenReady();

  const partition = `persist:${args.group}${cfg.partitionSuffix}`;
  console.log(`[全链路] 采集 ${args.group} · ${cfg.partitionSuffix}（${partition}）`);
  const data = await collectAccount({ partition, platform: cfg.partitionSuffix });
  console.log(
    `[全链路] 采集完成：overview=${JSON.stringify(data.overview)} fansHistory=${data.fansHistory.length} 个点 works=${data.works.length} 条`
  );
  store.mergeDaily(args.group, cfg.partitionSuffix, data.overview, data.fansHistory);
  store.mergeWorks(args.group, cfg.partitionSuffix, data.works);
  store.writeMeta(args.group, cfg.partitionSuffix, {
    lastCollectAt: Date.now(),
    lastError: "",
    workCount: data.works.length,
  });
  const acc = store.readAccount(args.group, cfg.partitionSuffix);
  const dates = Object.keys(acc.daily).sort();
  console.log(`[全链路] daily 共 ${dates.length} 天，最新 ${dates[dates.length - 1]}：`, acc.daily[dates[dates.length - 1]]);
  console.log(`[全链路] works 前 3 条：`, acc.works.slice(0, 3).map((w) => ({ title: w.title, play: w.play, closed: !!w.closedStats })));
  console.log(`[全链路] 已写入 ${app.getPath("userData")}/data-stats/`);
  app.quit();
}

const args = parseArgs();
const entry = args.mode === "collect" ? mainCollect : main;
entry(args).catch((err) => {
  console.error("[探针异常]", err && err.message ? err.message : err);
  app.exit(1);
});
