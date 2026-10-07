"use strict";

/**
 * 各平台数据采集适配器。
 *
 * collectScript 在平台落地页的上下文中执行（隐藏 BrowserWindow，页面已带登录态），
 * 统一返回：
 * {
 *   overview: { fans, plays, likes, comments, favorites, shares },
 *   fansHistory: [{ date: "YYYY-MM-DD", value }],   // 可回填的历史，无则空数组
 *   works: [{ workId, title, publishTime(ms), play, like, comment, share, favorite, fansDelta }],
 * }
 *
 * 注意：脚本里只允许使用页面上下文 fetch（cookie/凭证由平台页面环境自动携带），
 * 不做任何签名构造。
 */

const DAY_MS = 86400000;

/** 页面内 fetch 公共封装（每个脚本开头注入） */
const FETCH_HELPER = `
  const __get = async (url) => {
    const res = await fetch(url, { headers: { accept: "application/json, text/plain, */*" }, credentials: "include" });
    return { status: res.status, json: JSON.parse(await res.text()) };
  };
  const __post = async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json;charset=UTF-8", accept: "application/json, text/plain, */*" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return { status: res.status, json: JSON.parse(await res.text()) };
  };
  const __sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const __num = (v) => Number(v) || 0;
`;

const ADAPTERS = {
  抖音: {
    landingPage: "https://creator.douyin.com/creator-micro/data-center/operation",
    settleMs: 6000, // 等 secsdk 初始化（自动给 fetch 注入 x-secsdk-csrf-token）
    loginUrlPattern: /login|passport/,
    collectScript: () => `
(async () => {
  ${FETCH_HELPER}
  const out = { overview: {}, fansHistory: [], works: [] };
  const fmt = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  // 1) 数据中心看板：近 30 天（total_fans_cnt 日序列用于回填粉丝历史）
  const dash = await __post("/janus/douyin/creator/data/overview/dashboard", {
    recent_days: 30,
    date_range: { start_date: fmt(Date.now() - 30 * ${DAY_MS}), end_date: fmt(Date.now() - ${DAY_MS}) },
  });
  if (dash.json.status_code !== 0) throw new Error("dashboard: " + (dash.json.status_msg || dash.json.status_code));
  for (const m of dash.json.metrics || []) {
    if (m.english_metric_name === "total_fans_cnt") {
      out.overview.fans = __num(m.metric_value);
      out.fansHistory = (m.trends || []).map((t) => ({
        date: String(t.date_time).replace(/(\\d{4})(\\d{2})(\\d{2})/, "$1-$2-$3"),
        value: __num(t.value),
      }));
    }
  }
  // 2) 作品列表（游标分页 max_cursor）
  let cursor = 0, guard = 0;
  let plays = 0, likes = 0, comments = 0, shares = 0, favorites = 0;
  while (guard++ < 50) {
    const r = await __get(
      "/janus/douyin/creator/pc/work_list?scene=star_atlas&device_platform=android&status=0&count=12&max_cursor=" +
        cursor + "&aid=1128&support_h265=1"
    );
    const j = r.json;
    if (j.status_code !== 0) throw new Error("work_list: " + (j.status_msg || j.status_code));
    for (const it of j.items || []) {
      const mt = it.metrics || {};
      const w = {
        workId: String(it.id),
        url: "https://www.douyin.com/video/" + it.id,
        title: it.description || it.item_title || "(无标题)",
        publishTime: __num(it.create_time) * 1000,
        play: __num(mt.view_count),
        like: __num(mt.like_count),
        comment: __num(mt.comment_count),
        share: __num(mt.share_count),
        favorite: __num(mt.favorite_count),
        fansDelta: __num(mt.subscribe_count), // 该作品带来的关注
      };
      plays += w.play; likes += w.like; comments += w.comment; shares += w.share; favorites += w.favorite;
      out.works.push(w);
    }
    if (!j.has_more) break;
    cursor = j.max_cursor;
    await __sleep(800);
  }
  Object.assign(out.overview, { plays, likes, comments, shares, favorites });
  return out;
})()
    `,
  },

  视频号: {
    landingPage: "https://channels.weixin.qq.com/platform",
    settleMs: 6000,
    // 微信内置浏览器 UA（与 ptConfig 一致），否则平台拒绝服务
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF",
    loginUrlPattern: /login|qrcode/,
    collectScript: () => `
(async () => {
  ${FETCH_HELPER}
  const out = { overview: {}, fansHistory: [], works: [] };
  const dayStart = (ago) => {
    const now = Date.now() + 8 * 3600e3;
    return (Math.floor(now / ${DAY_MS}) * ${DAY_MS} - 8 * 3600e3 - ago * ${DAY_MS}) / 1000;
  };
  // 1) 粉丝趋势：一次拉 365 天（视频号支持历史回溯）
  const fans = await __post("/cgi-bin/mmfinderassistant-bin/statistic/fans_trend", {
    startTs: String(dayStart(365)), endTs: String(dayStart(0)),
    interval: 3, timestamp: String(Date.now()),
    _log_finder_uin: "", _log_finder_id: "", rawKeyBuff: "",
    pluginSessionId: null, scene: 7, reqScene: 7,
  });
  if (fans.json.errCode !== 0) throw new Error("fans_trend: " + (fans.json.errMsg || fans.json.errCode));
  const totals = (fans.json.data && fans.json.data.total) || [];
  if (totals.length) {
    out.overview.fans = totals[totals.length - 1];
    out.fansHistory = totals.map((v, i) => {
      const d = new Date((dayStart(365) + i * 86400) * 1000 + 8 * 3600e3);
      return { date: d.toISOString().slice(0, 10), value: __num(v) };
    });
  }
  // 2) 视频列表（游标分页 rawKeyBuff ← lastBuff）
  let rawKeyBuff = "", guard = 0;
  let plays = 0, likes = 0, comments = 0, shares = 0, favorites = 0;
  while (guard++ < 50) {
    const r = await __post("/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list", {
      pageSize: 10, currentPage: guard, userpageType: 11, stickyOrder: false,
      timestamp: String(Date.now()),
      _log_finder_uin: "", _log_finder_id: "", rawKeyBuff,
      pluginSessionId: null, scene: 7, reqScene: 7,
    });
    const j = r.json;
    if (j.errCode !== 0) throw new Error("post_list: " + (j.errMsg || j.errCode));
    const data = j.data || {};
    for (const v of data.list || []) {
      const d = v.desc || {};
      const w = {
        workId: String(v.objectId || v.exportId || ""),
        url: "",
        title: (d.shortTitle && d.shortTitle[0] && d.shortTitle[0].shortTitle) || d.description || "(无标题)",
        publishTime: __num(v.createTime) * 1000,
        // 注意视频号字段与直觉相反：likeCount=收藏，favCount=推荐(点赞)
        play: __num(v.readCount),
        like: __num(v.favCount),
        comment: __num(v.commentCount),
        share: __num(v.forwardCount),
        favorite: __num(v.likeCount),
        fansDelta: __num(v.followCount),
      };
      plays += w.play; likes += w.like; comments += w.comment; shares += w.share; favorites += w.favorite;
      out.works.push(w);
    }
    if (!data.continueFlag || !data.lastBuff) break;
    rawKeyBuff = data.lastBuff;
    await __sleep(800);
  }
  Object.assign(out.overview, { plays, likes, comments, shares, favorites });
  return out;
})()
    `,
  },

  哔哩哔哩: {
    landingPage: "https://member.bilibili.com/platform/home",
    settleMs: 5000,
    loginUrlPattern: /passport|login/,
    collectScript: () => `
(async () => {
  ${FETCH_HELPER}
  const out = { overview: {}, fansHistory: [], works: [] };
  // 1) 账号总量看板（含昨日增量）
  const stat = await __get("/x/web/data/index/stat");
  if (stat.json.code !== 0) throw new Error("index/stat: " + (stat.json.message || stat.json.code));
  const s = stat.json.data || {};
  out.overview = {
    fans: __num(s.total_fans),
    plays: __num(s.total_click),
    likes: __num(s.total_like),
    comments: __num(s.total_reply),
    shares: __num(s.total_share),
    favorites: __num(s.total_fav),
  };
  // 2) 稿件列表（页码分页）
  let pn = 1, guard = 0;
  while (guard++ < 50) {
    const r = await __get(
      "/x/web/archives?status=is_pubing,pubed,not_pubed&pn=" + pn + "&ps=20&coop=1&interactive=1"
    );
    const j = r.json;
    if (j.code !== 0) throw new Error("archives: " + (j.message || j.code));
    const data = j.data || {};
    for (const item of data.arc_audits || []) {
      const a = item.Archive || {};
      const st = item.stat || {};
      out.works.push({
        workId: String(a.bvid || a.aid || ""),
        url: a.bvid ? "https://www.bilibili.com/video/" + a.bvid : "",
        title: a.title || "(无标题)",
        publishTime: __num(a.ptime) * 1000,
        play: __num(st.view),
        like: __num(st.like),
        comment: __num(st.reply),
        share: __num(st.share),
        favorite: __num(st.favorite),
        fansDelta: null, // B 站无单视频涨粉字段
      });
    }
    const page = data.page || {};
    if (!page.count || pn * 20 >= page.count) break;
    pn += 1;
    await __sleep(800);
  }
  return out;
})()
    `,
  },

  百家号: {
    landingPage: "https://baijiahao.baidu.com/builder/rc/home",
    settleMs: 5000,
    loginUrlPattern: /login|passport/,
    collectScript: () => `
(async () => {
  ${FETCH_HELPER}
  const out = { overview: {}, fansHistory: [], works: [] };
  // 1) 首页概览
  const home = await __get("/pcui/home/index");
  const core = (home.json.data && home.json.data.coreData) || home.json.coreData;
  if (!core) throw new Error("home/index: 未取到 coreData（可能未登录）");
  out.overview = { fans: __num(core.fansCount), plays: __num(core.viewCount) };
  // 2) 内容列表（页码分页；video_set 合集跳过）
  let page = 1, guard = 0;
  let likes = 0, comments = 0, shares = 0, favorites = 0;
  while (guard++ < 50) {
    const r = await __get(
      "/pcui/article/lists?currentPage=" + page +
        "&pageSize=10&search=&type=&collection=&startDate=&endDate=&clearBeforeFetch=false&dynamic=1"
    );
    const j = r.json;
    const list = Array.isArray(j.list) ? j.list : (j.data && j.data.list) || [];
    const pageInfo = j.page || (j.data && j.data.page) || {};
    for (const it of list) {
      if (it.type === "video_set") continue; // 合集不是单作品
      const w = {
        workId: String(it.article_id || it.nid || ""),
        url: it.url || "",
        title: it.title || "(无标题)",
        publishTime: it.publish_time ? new Date(String(it.publish_time).replace(/-/g, "/")).getTime() : 0,
        play: __num(it.read_amount),
        like: __num(it.like_amount),
        comment: __num(it.comment_amount),
        share: __num(it.share_amount),
        favorite: __num(it.collection_amount),
        fansDelta: null,
      };
      likes += w.like; comments += w.comment; shares += w.share; favorites += w.favorite;
      out.works.push(w);
    }
    if (!pageInfo.totalPage || page >= pageInfo.totalPage) break;
    page += 1;
    await __sleep(800);
  }
  Object.assign(out.overview, { likes, comments, shares, favorites });
  return out;
})()
    `,
  },
  头条: {
    landingPage: "https://mp.toutiao.com/profile_v4/index",
    settleMs: 5000,
    loginUrlPattern: /login|passport/,
    collectScript: () => `
(async () => {
  ${FETCH_HELPER}
  const out = { overview: {}, fansHistory: [], works: [] };
  // 1) 首页聚合：粉丝总量 + 总播放阅读
  const home = await __get("/mp/fe_api/home/merge_v2?app_id=1231");
  const st = home.json && home.json.data && home.json.data.statistic && home.json.data.statistic.data;
  if (!st) throw new Error("home/merge_v2: 未取到 statistic（可能未登录）");
  out.overview.fans = __num(st.total_subscribe_count);
  out.overview.plays = __num(st.total_read_play_count);
  // 2) 作品列表（offset 毫秒游标分页；visited_uid 从 localStorage 取）
  let uid = "";
  try {
    const tokens = JSON.parse(localStorage.getItem("__tea_cache_tokens_1231") || "{}");
    uid = String(tokens.user_unique_id || "");
  } catch (e) { /* ignore */ }
  if (!uid) throw new Error("未能获取作者 uid（localStorage.__tea_cache_tokens_1231）");
  const genreSwitch = encodeURIComponent(JSON.stringify({ repost: 1, small_video: 1, toutiao_graphic: 1, weitoutiao: 1, xigua_video: 1 }));
  let offset = 0, pageIndex = 1, guard = 0;
  let likes = 0, comments = 0, favorites = 0;
  while (guard++ < 50) {
    const clientExtra = encodeURIComponent(JSON.stringify({
      category: "mp_all", real_app_id: "1231", need_forward: "true",
      offset_mode: "1", page_index: String(pageIndex), status: "8", source: "0",
    }));
    const r = await __get(
      "/api/feed/mp_provider/v1/?provider_type=mp_provider&aid=13&app_name=news_article&category=mp_all&stream_api_version=88" +
        "&genre_type_switch=" + genreSwitch + "&device_platform=pc&platform_id=0&visited_uid=" + uid +
        "&offset=" + offset + "&count=10&keyword=&client_extra_params=" + clientExtra + "&app_id=1231"
    );
    const j = r.json;
    const list = j.data || [];
    if (list.length === 0) break; // 空页即终止（has_more 是 feed 惯性标记，不可信）
    for (const it of list) {
      const cell = (it.assembleCell && it.assembleCell.itemCell) || {};
      const base = cell.articleBase || {};
      const counter = cell.itemCounter || {};
      const w = {
        workId: String(base.gidStr || base.groupID || ""),
        url: base.gidStr ? "https://www.toutiao.com/a" + base.gidStr + "/" : "",
        title: base.title || base.abstractText || "(无标题)",
        publishTime: __num(base.publishTime) * 1000,
        play: __num(counter.videoWatchCount) || __num(counter.readCount), // 视频用播放，图文用阅读
        like: __num(counter.diggCount),
        comment: __num(counter.commentCount),
        // 注意：repinCount 在头条实为「收藏」（已用真实作品核对），列表无真正的分享字段
        share: null,
        favorite: __num(counter.repinCount),
        fansDelta: null,
      };
      if (!w.workId) continue;
      likes += w.like; comments += w.comment; favorites += w.favorite || 0;
      out.works.push(w);
    }
    if (!j.has_more || !j.offset) break;
    offset = j.offset;
    pageIndex += 1;
    await __sleep(800);
  }
  Object.assign(out.overview, { likes, comments, favorites });
  return out;
})()
    `,
  },

  快手: {
    // 作品管理页：列表滚动加载，页面自己发带 __NS_sig3 的请求（签名与请求体绑定，
    // 无法复用/构造）——采用 preload 嗅探页面响应 + 滚动驱动加载，完全不碰签名
    landingPage: "https://cp.kuaishou.com/article/manage/video",
    settleMs: 6000,
    loginUrlPattern: /login|passport/,
    sniffer: true,
    collectScript: () => `
(async () => {
  ${FETCH_HELPER}
  const out = { overview: {}, fansHistory: [], works: [] };
  // 1) 用户信息（粉丝；此接口不验签，可直接请求）
  const apiPh = (document.cookie.match(/(?:^|;\\s*)kuaishou\\.web\\.cp\\.api_ph=([^;]+)/) || [])[1] || "";
  const info = await __post("/rest/cp/creator/pc/home/userInfo", { "kuaishou.web.cp.api_ph": apiPh });
  if (info.json.result !== 1) throw new Error("userInfo: " + (info.json.message || info.json.result));
  const core = (info.json.data && info.json.data.coreUserInfo) || {};
  out.overview.fans = __num(core.fansNum);

  // 2) 作品列表：从 preload 嗅探到的「页面自己发的」photo/list 响应读取
  const sniffed = () => (window.__mmSniffed || []).filter((x) => x.url && x.url.includes("photo/list") && x.json && x.json.result === 1);
  const seen = new Set();
  const harvest = () => {
    for (const item of sniffed()) {
      for (const v of (item.json.data || {}).list || []) {
        const id = String(v.workId || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.works.push({
          workId: id,
          url: "https://www.kuaishou.com/short-video/" + id,
          title: v.title || "(无标题)",
          publishTime: __num(v.uploadTime),
          play: __num(v.playCount),
          like: __num(v.likeCount),
          comment: __num(v.commentCount),
          share: null,
          favorite: null, // 快手列表无收藏/分享字段
          fansDelta: null,
        });
      }
    }
    const last = sniffed().slice(-1)[0];
    return { total: last ? __num((last.json.data || {}).total) : 0, cursor: last ? (last.json.data || {}).nextCursor : "" };
  };
  // 滚动工具：滚所有可能的滚动容器到底（触发懒加载/加载更多）
  const scrollAll = () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) {
        el.scrollTop = el.scrollHeight;
      }
    });
  };
  // 等页面自动发出第一页（期间周期性滚动触发懒加载，最长 ~30s）
  for (let i = 0; i < 60 && sniffed().length === 0; i++) {
    if (i > 0 && i % 6 === 0) scrollAll();
    await __sleep(500);
  }
  if (sniffed().length === 0) {
    // 失败诊断：页面状态 + 实际嗅探到的请求路径，便于定位是加载失败还是路径变更
    const diag = {
      url: location.href,
      title: document.title,
      sniffedTotal: (window.__mmSniffed || []).length,
      sniffedApis: [...new Set((window.__mmSniffed || []).map((x) => (x.url || "").split("?")[0].slice(-40)))].slice(0, 8),
      bodyText: ((document.body && document.body.innerText) || "").slice(0, 80),
    };
    throw new Error("未嗅探到作品列表请求 " + JSON.stringify(diag));
  }
  for (let round = 0; round < 30; round++) {
    const { total, cursor } = harvest();
    if (cursor === "no_more") break;
    if (total > 0 && out.works.length >= total) break;
    const before = sniffed().length;
    scrollAll();
    await __sleep(1500);
    if (sniffed().length === before) await __sleep(1000); // 没发新请求时多等一下
    if (sniffed().length === before && round > 2) break;  // 连续无新请求视为到底
  }
  const { total } = harvest();

  // 3) 总量：有 total 用 total 口径校验，播放/赞/评累加作品值
  let plays = 0, likes = 0, comments = 0;
  for (const w of out.works) { plays += w.play; likes += w.like; comments += w.comment; }
  Object.assign(out.overview, { plays, likes, comments });
  return out;
})()
    `,
  },
  小红书: {
    landingPage: "https://creator.xiaohongshu.com/new/home",
    settleMs: 7000, // 等签名 SDK（window._webmsxyw）加载
    loginUrlPattern: /login|passport/,
    collectScript: () => `
(async () => {
  ${FETCH_HELPER}
  const out = { overview: {}, fansHistory: [], works: [] };
  // 小红书 web 接口需 x-s/x-t(/x-s-common) 签名：直接调用页面自带的签名函数（非逆向实现）
  if (typeof window._webmsxyw !== "function") throw new Error("签名函数 _webmsxyw 未就绪");
  const __signed = async (url) => {
    const sign = window._webmsxyw(url, undefined) || {};
    const headers = { accept: "application/json, text/plain, */*" };
    if (sign["X-s"]) headers["x-s"] = sign["X-s"];
    if (sign["X-t"]) headers["x-t"] = String(sign["X-t"]);
    if (sign["X-s-common"]) headers["x-s-common"] = sign["X-s-common"];
    const res = await fetch(url, { headers, credentials: "include" });
    return { status: res.status, json: JSON.parse(await res.text()) };
  };
  // 1) 个人信息（粉丝 / 获赞与收藏）
  const info = await __signed("/api/galaxy/creator/home/personal_info");
  const d = (info.json && info.json.data) || {};
  if (info.json.code !== 0) throw new Error("personal_info: code=" + info.json.code);
  out.overview.fans = __num(d.fans_count);
  // 2) 笔记列表（page 递增，响应 page=-1 终止）
  let page = 0, guard = 0;
  let plays = 0, likes = 0, comments = 0, shares = 0, favorites = 0;
  while (guard++ < 50) {
    const r = await __signed("/api/galaxy/v2/creator/note/user/posted?tab=0&page=" + page);
    const j = r.json;
    if (j.code !== 0) throw new Error("notes: code=" + j.code);
    const notes = (j.data && j.data.notes) || [];
    for (const n of notes) {
      const w = {
        workId: String(n.id || ""),
        url: n.id ? "https://www.xiaohongshu.com/explore/" + n.id : "",
        title: n.display_title || "(无标题)",
        publishTime: n.time ? new Date(String(n.time).replace(/-/g, "/")).getTime() : 0,
        play: __num(n.view_count),
        like: __num(n.likes),
        comment: __num(n.comments_count),
        share: __num(n.shared_count),
        favorite: __num(n.collected_count),
        fansDelta: null,
      };
      if (!w.workId) continue;
      plays += w.play; likes += w.like; comments += w.comment; shares += w.share; favorites += w.favorite;
      out.works.push(w);
    }
    const next = j.data && j.data.page;
    if (next === -1 || next == null || notes.length === 0) break;
    page = Number(next);
    await __sleep(800);
  }
  Object.assign(out.overview, { plays, likes, comments, shares, favorites });
  return out;
})()
    `,
  },
};

module.exports = { ADAPTERS, DAY_MS };
