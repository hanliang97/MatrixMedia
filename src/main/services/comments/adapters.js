"use strict";

/**
 * 评论互动适配器（v1 只读：拉取已发布作品的评论列表）。
 *
 * 与 dataStats/adapters.js 同一套约束：
 * - 脚本在平台创作中台页面上下文执行（隐藏 BrowserWindow，复用分组 partition 登录态）；
 * - 只允许页面上下文 fetch（cookie/凭证自动携带），不做任何签名构造；
 * - 页面自身会发带签名请求的平台（快手/抖音），用 sniffer preload 嗅探响应，不重放签名。
 *
 * 归一化输出（collectScript 返回值）：
 * {
 *   comments: [{
 *     workId, workTitle, commentId, content, nickname,
 *     createTime(ms), likeCount, replied(bool|replyContent), status
 *   }],
 *   collectedAt
 * }
 */

/* ---------------- 平台元信息（探针/采集共用） ---------------- */

const PLATFORM_META = {
  抖音: {
    landingPage: "https://creator.douyin.com/creator-micro/home",
    settleMs: 6000, // 等 secsdk 初始化（自动给 fetch 注入 x-secsdk-csrf-token）
    loginUrlPattern: /login|passport/,
  },
  快手: {
    landingPage: "https://cp.kuaishou.com/article/manage/video",
    settleMs: 6000,
    loginUrlPattern: /login|passport/,
  },
  视频号: {
    landingPage: "https://channels.weixin.qq.com/platform",
    settleMs: 6000,
    // 微信内置浏览器 UA（与 dataStats/ptConfig 一致），否则平台拒绝服务
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF",
    loginUrlPattern: /login|qrcode/,
  },
};

/* ---------------- 页面内 fetch 公共封装 ---------------- */

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

/* ---------------- 端点探针脚本 ---------------- */

/**
 * 通用探针：落地页加载完成后，按 clicks 依次点击导航文本（SPA 菜单），
 * dump 跳转轨迹、页面链接、sniffer 捕获的页面自身请求端点，
 * 以及评论/互动相关响应的结构采样（顶层键 + data 键）。
 */
const PROBE_SCRIPT = (opts = {}) => {
  const clicks = Array.isArray(opts.clicks) ? opts.clicks : [];
  const waitMs = Number(opts.waitMs) > 0 ? Number(opts.waitMs) : 2500;
  const fetches = Array.isArray(opts.fetches) ? opts.fetches : [];
  const deep = !!opts.deep;
  return `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uniq = (arr, n) => [...new Set(arr)].slice(0, n);
  const deep = ${deep ? "true" : "false"};
  const deepOut = {};
  if (deep) {
    // wujie 等微前端：子应用 JS 跑在同源 iframe 沙箱里，主文档 hook 看不到其请求。
    // 给每个同源 iframe 的 window 再装一套 hook，条目仍推入主文档 __mmSniffed（带 frame 标记）。
    const store = window.__mmSniffed;
    const pushDeep = (tag, url, method, body, text) => {
      try {
        store.push({ url: String(url), method: String(method || "GET"), body: body ? String(body).slice(0, 600) : "", json: JSON.parse(text), frame: tag });
        if (store.length > 600) store.splice(0, store.length - 600);
      } catch (e) { /* 非 JSON 忽略 */ }
    };
    const hookWin = (w, tag) => {
      try {
        if (!w || w.__mmDeepHooked) return;
        w.__mmDeepHooked = true;
        const ofetch = w.fetch;
        if (typeof ofetch === "function") {
          w.fetch = async function () {
            const args = arguments;
            const res = await ofetch.apply(this, args);
            try {
              const a0 = args[0];
              const url = String((a0 && a0.url) || a0);
              const method = (args[1] && args[1].method) || (a0 && a0.method) || "GET";
              let body = (args[1] && args[1].body) || (a0 && a0.body) || "";
              if (body && typeof body !== "string") { try { body = JSON.stringify(body); } catch (e) { body = String(body); } }
              const cl = res.clone();
              cl.text().then((t) => pushDeep(tag, url, method, body, t)).catch(() => {});
            } catch (e) { /* ignore */ }
            return res;
          };
        }
        const oOpen = w.XMLHttpRequest.prototype.open;
        const oSend = w.XMLHttpRequest.prototype.send;
        w.XMLHttpRequest.prototype.open = function (m, u) {
          this.__mmMethod = m; this.__mmUrl = u;
          const rest = [].slice.call(arguments, 2);
          this.addEventListener("load", function () {
            try {
              const rt = this.responseType;
              if (rt === "" || rt === "text") pushDeep(tag, this.__mmUrl, this.__mmMethod, this.__mmBody, this.responseText);
              else if (rt === "json") pushDeep(tag, this.__mmUrl, this.__mmMethod, this.__mmBody, JSON.stringify(this.response));
            } catch (e) { /* ignore */ }
          });
          return oOpen.apply(this, [m, u].concat(rest));
        };
        w.XMLHttpRequest.prototype.send = function (b) {
          try { this.__mmBody = b ? (typeof b === "string" ? b : JSON.stringify(b)) : ""; } catch (e) { this.__mmBody = ""; }
          return oSend.apply(this, arguments);
        };
      } catch (e) { /* 跨域 iframe 忽略 */ }
    };
    const hookIframes = () => {
      let n = 0;
      document.querySelectorAll("iframe").forEach((f, i) => {
        try { hookWin(f.contentWindow, "iframe" + i); n++; } catch (e) { /* ignore */ }
      });
      return n;
    };
    deepOut.hookedIframes = hookIframes();
    // shadow UI 可点击元素清单（wujie 子应用 UI 在 shadowRoot 内）
    const clickables = [];
    document.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot && clickables.length < 60) {
        el.shadowRoot.querySelectorAll("button,[role='tab'],[role='button'],li,span,div,a").forEach((c) => {
          const t = ((c.textContent || "").trim());
          if (t && t.length <= 14 && clickables.length < 60) clickables.push(t);
        });
      }
    });
    deepOut.shadowClickables = uniq(clickables, 60);
    // 子应用入口 HTML → script src 清单（bundle 可下载后离线定位 API）
    try {
      const entry = location.pathname.indexOf("/micro/") === 0 ? location.pathname + location.search : "/micro/interaction/comment";
      const res = await fetch(entry, { credentials: "include" });
      const html = await res.text();
      deepOut.entryStatus = res.status;
      deepOut.htmlLen = html.length;
      deepOut.scriptSrcs = (html.match(/src=["']([^"']+\\.js[^"']*)["']/g) || []).map((s) => s.replace(/^src=["']|["']$/g, "")).slice(0, 25);
    } catch (e) { deepOut.scriptErr = String(e).slice(0, 120); }
    await sleep(12000); // 装钩后等子应用后续请求（轮询/懒加载）
    deepOut.hookedIframesLate = hookIframes();
  }
  await sleep(${waitMs});
  const trail = [];
  const clicks = ${JSON.stringify(clicks)};
  const clickText = (text) => {
    const els = [...document.querySelectorAll("a,li,span,div,button")].filter((el) => {
      const t = (el.innerText || "").trim();
      return t === text || (t.length <= text.length + 4 && t.includes(text));
    });
    if (!els.length) return false;
    // 精确匹配优先，其次取文本最短（最内层）的元素，避免点到外层容器
    els.sort((a, b) => {
      const ta = (a.innerText || "").trim();
      const tb = (b.innerText || "").trim();
      if (ta === text && tb !== text) return -1;
      if (tb === text && ta !== text) return 1;
      return ta.length - tb.length;
    });
    els[0].click();
    return true;
  };
  for (const text of clicks) {
    const ok = clickText(text);
    trail.push({ text, clicked: ok, urlBefore: location.href });
    await sleep(4000);
  }
  const anchors = [...document.querySelectorAll("a[href]")].map((a) => ({
    text: (a.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 24),
    href: a.getAttribute("href") || "",
  })).filter((x) => x.text || x.href);
  const sniffedAll = window.__mmSniffed || [];
  const sniffed = sniffedAll.map((x) => String(x.url || "").split("?")[0]);
  const listPick = (j) => {
    if (!j || typeof j !== "object") return null;
    const d = j.data || j;
    const arr = d.list || d.comments || j.comments || d.comment_list || null;
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  };
  const samples = sniffedAll
    .filter((x) => /comment|interact|reply|feedback/i.test(String(x.url || "")))
    .slice(0, 10)
    .map((x) => {
      const j = x.json || {};
      const d = j.data || {};
      const item = listPick(j);
      return {
        url: String(x.url).slice(0, 170),
        reqMethod: x.method || "",
        reqBody: String(x.body || "").slice(0, 400),
        topKeys: Object.keys(j).slice(0, 12),
        dataKeys: Object.keys(d).slice(0, 24),
        pageKeys: Object.keys(d).filter((k) => /cursor|buff|has_more|hasMore|continue|total|count|next|page/i.test(k)).slice(0, 10),
        firstItem: item ? JSON.stringify(item).slice(0, 1400) : "",
      };
    });
  // 资源级端点清单（含 sniffer 覆盖不到的：worker/iframe/json 型 XHR 等）
  let resourceUrls = [];
  try {
    resourceUrls = uniq(performance.getEntriesByType("resource")
      .map((e) => String(e.name || "").split("?")[0])
      .filter((u) => /comment|interact|cgi-bin|rest\\/cp|aweme|web\\/api/i.test(u) && !/\\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map)(\\b|$)/i.test(u)), 150);
  } catch (e) { /* ignore */ }
  // shadow DOM 内容摘要（视频号互动页把 UI 渲染在 shadowRoot 里）
  let shadowTexts = [];
  try {
    document.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot && shadowTexts.length < 4) {
        shadowTexts.push({
          host: (el.tagName + (el.id ? "#" + el.id : "")).slice(0, 40),
          elemCount: el.shadowRoot.querySelectorAll("*").length,
          text: ((el.shadowRoot.textContent || "").replace(/\\s+/g, " ").trim()).slice(0, 260),
        });
      }
    });
  } catch (e) { /* ignore */ }
  const fetchPaths = ${JSON.stringify(fetches)};
  const fetchResults = [];
  for (const p of fetchPaths) {
    try {
      const res = await fetch(p, {
        method: "POST",
        headers: { "content-type": "application/json;charset=UTF-8", accept: "application/json, text/plain, */*" },
        credentials: "include",
        body: JSON.stringify({
          timestamp: String(Date.now()),
          _log_finder_uin: "", _log_finder_id: "", rawKeyBuff: "",
          pluginSessionId: null, scene: 7, reqScene: 7,
        }),
      });
      const text = await res.text();
      let j = null;
      try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ }
      fetchResults.push({
        path: p,
        status: res.status,
        errCode: j ? j.errCode : null,
        errMsg: j ? String(j.errMsg || "").slice(0, 120) : text.slice(0, 100),
        topKeys: j ? Object.keys(j).slice(0, 10) : [],
        dataKeys: j && j.data && typeof j.data === "object" ? Object.keys(j.data).slice(0, 24) : [],
      });
    } catch (e) {
      fetchResults.push({ path: p, error: String(e).slice(0, 120) });
    }
    await sleep(600);
  }
  const renderDiag = (() => {
    try {
      let shadowHosts = 0;
      document.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) shadowHosts++; });
      return {
        readyState: document.readyState,
        bodyLen: ((document.body && document.body.innerText) || "").length,
        elemCount: document.querySelectorAll("*").length,
        shadowHosts,
        iframeSrcs: [...document.querySelectorAll("iframe")].map((f) => (f.src || "(no src)").slice(0, 90)).slice(0, 5),
        frameCount: window.frames.length,
      };
    } catch (e) { return { err: String(e).slice(0, 100) }; }
  })();
  return {
    url: location.href,
    title: document.title,
    bodyText: ((document.body && document.body.innerText) || "").replace(/\\s+/g, " ").slice(0, 220),
    renderDiag,
    fetchResults,
    deep: deepOut,
    trail,
    anchors: anchors.slice(0, 80),
    sniffedUrls: uniq(sniffed, 100),
    resourceUrls,
    shadowTexts,
    samples,
    sniffCount: sniffedAll.length,
  };
})()
`;
};

/* ---------------- 评论采集适配器 ---------------- */

/**
 * 键 = 平台中文名。collectScript(opts) 返回在页面上下文执行的脚本字符串，
 * opts: { work: 作品标题或ID过滤（可空）, limit: 条数上限 }。
 * 端点探明后逐平台补充；未实现的平台由 collector 报明确错误。
 */
const COMMENTS_ADAPTERS = {
  抖音: {
    // 评论管理页 interactive/comment：进入后默认选中作品，页面自己发
    // /web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/select/（带签名 query）
    // —— sniffer 嗅探响应 + 滚动驱动翻页，不构造签名（与快手同一套打法）。
    landingPage: "https://creator.douyin.com/creator-micro/interactive/comment",
    collectScript: (opts = {}) => {
      const limit = Number(opts.limit) || 200;
      return `
(async () => {
  ${FETCH_HELPER}
  const LIMIT = ${limit};
  const out = { comments: [], extra: {} };
  const sniffed = () => (window.__mmSniffed || []).filter(
    (x) => x.url && x.url.indexOf("/comment/list/select") !== -1 && x.json
  );
  const seen = new Set();
  const awemeIds = new Set();
  const harvest = () => {
    for (const resp of sniffed()) {
      const j = resp.json || {};
      for (const c of j.comments || []) {
        const id = String(c.cid || "");
        if (c.aweme_id) awemeIds.add(String(c.aweme_id));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const u = c.user || {};
        out.comments.push({
          workId: String(c.aweme_id || ""),
          workTitle: "",
          commentId: id,
          content: String(c.text || ""),
          nickname: String(u.nickname || ""),
          authorId: String(u.uid || ""),
          createTime: __num(c.create_time) * 1000,
          likeCount: __num(c.digg_count),
          replied: (Array.isArray(c.reply_comment) && c.reply_comment.length > 0) || __num(c.reply_comment_total) > 0,
          replyTo: "",
          ipLabel: String(c.ip_label || ""),
          status: __num(c.status),
        });
      }
    }
  };
  const scrollAll = () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) {
        el.scrollTop = el.scrollHeight;
      }
    });
  };
  for (let i = 0; i < 60 && sniffed().length === 0; i++) {
    if (i > 0 && i % 6 === 0) scrollAll();
    await __sleep(500);
  }
  if (sniffed().length === 0) {
    throw new Error("未嗅探到 comment/list/select 请求 " + JSON.stringify({
      url: location.href,
      title: document.title,
      sniffCount: (window.__mmSniffed || []).length,
      sniffedApis: [...new Set((window.__mmSniffed || []).map((x) => (x.url || "").split("?")[0].slice(-46)))].slice(0, 10),
      bodyText: ((document.body && document.body.innerText) || "").slice(0, 80),
    }));
  }
  for (let round = 0; round < 20; round++) {
    harvest();
    if (out.comments.length >= LIMIT) break;
    const before = sniffed().length;
    scrollAll();
    await __sleep(1500);
    if (sniffed().length === before) await __sleep(1000);
    if (sniffed().length === before && round > 1) break;
  }
  harvest();
  out.comments.sort((a, b) => b.createTime - a.createTime);
  if (out.comments.length > LIMIT) out.comments.length = LIMIT;
  out.extra.total = out.comments.length;
  out.extra.respCount = sniffed().length;
  out.extra.awemeIds = [...awemeIds].slice(0, 20);
  return out;
})()
`;
    },
  },

  快手: {
    // 评论管理页：列表由页面自己发带 __NS_sig3 签名的 commentList 请求（签名不可构造）
    // —— sniffer 嗅探响应 + 滚动/翻页驱动，与 dataStats 快手作品列表同一套打法
    landingPage: "https://cp.kuaishou.com/article/comment",
    collectScript: (opts = {}) => {
      const limit = Number(opts.limit) || 200;
      return `
(async () => {
  ${FETCH_HELPER}
  const LIMIT = ${limit};
  const out = { comments: [], extra: {} };
  const sniffed = () => (window.__mmSniffed || []).filter(
    (x) => x.url && x.url.indexOf("/rest/cp/creator/comment/commentList") !== -1 && x.json && x.json.result === 1
  );
  const seen = new Set();
  const harvest = () => {
    for (const resp of sniffed()) {
      for (const c of ((resp.json.data || {}).list) || []) {
        const id = String(c.commentId || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.comments.push({
          workId: String(c.photoId || ""),
          workTitle: "",
          commentId: id,
          content: String(c.content || ""),
          nickname: String(c.authorName || ""),
          authorId: String(c.authorId || ""),
          createTime: __num(c.timestamp),
          likeCount: __num(c.likedCount),
          subCommentCount: __num(c.subCommentCount),
          replied: __num(c.subCommentCount) > 0 || __num(c.replyToCommentId) > 0,
          replyTo: String(c.replyToUserName || ""),
          toped: !!c.toped,
        });
      }
    }
  };
  const scrollAll = () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) {
        el.scrollTop = el.scrollHeight;
      }
    });
    // 若是按钮翻页：点「下一页」（存在且未禁用时）
    const next = [...document.querySelectorAll("li,button,a,span")].find((el) => {
      const t = (el.innerText || "").trim();
      const cls = String(el.className || "");
      return (t === "下一页" || /next/i.test(cls)) && !el.disabled && !/disabled/.test(cls);
    });
    if (next) next.click();
  };
  for (let i = 0; i < 60 && sniffed().length === 0; i++) {
    if (i > 0 && i % 6 === 0) scrollAll();
    await __sleep(500);
  }
  if (sniffed().length === 0) {
    throw new Error("未嗅探到 commentList 请求 " + JSON.stringify({
      url: location.href,
      title: document.title,
      sniffCount: (window.__mmSniffed || []).length,
      bodyText: ((document.body && document.body.innerText) || "").slice(0, 80),
    }));
  }
  for (let round = 0; round < 20; round++) {
    harvest();
    if (out.comments.length >= LIMIT) break;
    const before = sniffed().length;
    scrollAll();
    await __sleep(1500);
    if (sniffed().length === before) await __sleep(1000);
    if (sniffed().length === before && round > 1) break;
  }
  harvest();
  out.comments.sort((a, b) => b.createTime - a.createTime);
  if (out.comments.length > LIMIT) out.comments.length = LIMIT;
  out.extra.total = out.comments.length;
  out.extra.respCount = sniffed().length;
  return out;
})()
`;
    },
  },

  视频号: {
    // 助手接口无签名（cookie + 标准 envelope），页内 fetch 直接调。
    // 参数从官方前端 bundle（finder-helper-interaction）解码：
    // - 评论页作品列表 = post_list { userpageType:3(UserPageType_Comment), needAllCommentCount:true, onlyUnread:false, lastBuff }
    // - 评论列表 = /comment/comment_list { lastBuff, exportId(取 feed.objectId), commentSelection:false(全部)/true(精选), forMcn:false }
    // - 后续写操作端点同源：create_comment / like_comment / del_comment / update_comment(精选) / set_top_comment
    // 每步 errCode/dataKeys 记入 extra.attempts 便于巡检校准。
    collectScript: (opts = {}) => {
      const limit = Number(opts.limit) || 200;
      return `
(async () => {
  ${FETCH_HELPER}
  const LIMIT = ${limit};
  const out = { comments: [], extra: { attempts: [] } };
  const env = () => ({
    timestamp: String(Date.now()),
    _log_finder_uin: "", _log_finder_id: "",
    pluginSessionId: null, scene: 7, reqScene: 7,
  });
  const tryReq = async (label, url, body) => {
    const r = await __post(url, Object.assign(env(), body));
    const j = r.json || {};
    out.extra.attempts.push({
      label, errCode: j.errCode,
      errMsg: String(j.errMsg || "").slice(0, 80),
      dataKeys: Object.keys(j.data || {}).slice(0, 20),
    });
    return j;
  };
  // 1) 评论页作品列表（userpageType=3）
  let feeds = [], buff = "", flag = true, guard = 0;
  while (flag && guard++ < 5 && feeds.length < 50) {
    const j = await tryReq("post_list#" + guard, "/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list", {
      pageSize: 10, onlyUnread: false, needAllCommentCount: true,
      userpageType: 3, forMcn: false, lastBuff: buff,
    });
    if (j.errCode !== 0) break;
    const d = j.data || {};
    feeds = feeds.concat(d.list || []);
    buff = d.lastBuff || "";
    flag = !!d.continueFlag && !!buff;
    await __sleep(600);
  }
  out.extra.feedCount = feeds.length;
  out.extra.feeds = feeds.map((p) => ({
    objectId: String(p.objectId || ""),
    exportId: String(p.exportId || ""),
    title: (((p.desc || {}).description) || "").slice(0, 24),
    commentCount: __num(p.commentCount),
  })).slice(0, 30);
  // 2) 逐作品拉评论
  const targets = feeds.filter((p) => __num(p.commentCount) > 0);
  out.extra.targetCount = targets.length;
  // 自检：全账号零评论时也对首个作品打一次空查，验证端点参数仍有效（errCode 应为 0）
  const verifyList = targets.length ? targets : feeds.slice(0, 1);
  const seen = new Set();
  for (const feed of verifyList.slice(0, 10)) {
    if (out.comments.length >= LIMIT) break;
    const exportId = String(feed.exportId || feed.objectId || "");
    if (!exportId) continue;
    const feedTitle = (((feed.desc || {}).description) || "").slice(0, 40);
    let cBuff = "", cFlag = true, rounds = 0;
    while (cFlag && rounds++ < 10 && out.comments.length < LIMIT) {
      const j = await tryReq("comment_list:" + exportId.slice(-8), "/cgi-bin/mmfinderassistant-bin/comment/comment_list", {
        lastBuff: cBuff, exportId, commentSelection: false, forMcn: false,
      });
      if (j.errCode !== 0) break;
      const d = j.data || {};
      if (!out.extra.rawSample) out.extra.rawSample = JSON.stringify(d).slice(0, 2500);
      for (const c of d.comment || []) {
        const id = String(c.commentId || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const ct = __num(c.createTime || c.create_time);
        out.comments.push({
          workId: String(feed.objectId || exportId),
          workTitle: feedTitle,
          commentId: id,
          content: String(c.content || c.commentContent || c.text || ""),
          nickname: String(c.nickname || c.commentNickname || (c.userInfo && c.userInfo.nickname) || ""),
          authorId: String(c.username || c.finderUsername || (c.userInfo && c.userInfo.username) || ""),
          createTime: ct < 1e12 ? ct * 1000 : ct,
          likeCount: __num(c.likeNum != null ? c.likeNum : c.likeCount),
          replied: Array.isArray(c.levelTwoComment) && c.levelTwoComment.length > 0,
          replyTo: "",
          status: __num(c.status),
          raw: c,
        });
      }
      cBuff = d.lastBuff || "";
      cFlag = !!d.continueFlag && !!cBuff;
      await __sleep(700);
    }
  }
  out.comments.sort((a, b) => b.createTime - a.createTime);
  if (out.comments.length > LIMIT) out.comments.length = LIMIT;
  out.extra.total = out.comments.length;
  return out;
})()
`;
    },
  },
};

module.exports = {
  PLATFORM_META,
  FETCH_HELPER,
  PROBE_SCRIPT,
  COMMENTS_ADAPTERS,
};
