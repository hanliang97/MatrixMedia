"use strict";

/**
 * 评论回复执行器（写操作，红线：默认 dry-run，--execute 才真发；每轮限速上限；全程台账）。
 *
 * 执行架构（逐条 + 增量台账）：
 * - setup 脚本在页面上下文执行一次：准备数据/助手函数，挂 window.__mmReply.run(rp, EXEC)；
 * - 主进程（collector.replyComments）逐条 executeJavaScript 调 run()，每条返回即写台账；
 * - 超时/异常 fail-stop：该条按「执行超时/中断」入账并中止后续，杜绝已发送却无台账的审计缺口。
 *
 * 平台机制：
 * - 视频号：页内 fetch 直调 /comment/create_comment（无签名）。参数解码自官方 bundle：
 *     { exportId, content, replyCommentId, rootCommentId, clientId(uuid) } + 标准 envelope；
 *     顶层新评论（置顶评论场景）= replyCommentId/rootCommentId 均空串。
 *     成功判据：errCode===0 且（data.baseResp 不存在 或 baseResp.errcode===0）；
 *     baseResp.errcode===-4300（手机验证/风控）→ 中止本轮；连续 3 次发送失败同样中止。
 * - 抖音/快手：回复接口带签名不可构造 → 评论管理页 DOM 自动化：
 *     定位含目标评论文本的块 → 点「回复」叶子 → 填 contenteditable/textarea → 点「发送」→ 验证。
 *     v1 只覆盖页面当前选中作品（默认最新）；跨作品切换待 v2。
 *
 * replies 条目形状（调用方会附加 index）：
 *   { commentId?, workId?, workTitle?, matchContent?, rootCommentId?, content }
 *   - sph：commentId 有值=回复评论（服务端校验存在性）；无值=对 workId/workTitle 作品发顶层评论
 *   - dy/ks：matchContent=目标评论原文（DOM 定位用，必填），content=回复文本
 */

const FETCH_HELPER = require("./adapters.js").FETCH_HELPER;

/** 视频号 setup：拉一次作品列表，挂 window.__mmReply.run（单条 fetch 校验 + 可选执行） */
function buildSphSetupScript({ maxPerRun }) {
  return `
(async () => {
  ${FETCH_HELPER}
  const MAX = ${Number(maxPerRun) || 5};
  const uuid = () => {
    const h = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    return h() + "-" + h();
  };
  const env = () => ({
    timestamp: String(Date.now()),
    _log_finder_uin: "", _log_finder_id: "",
    pluginSessionId: null, scene: 7, reqScene: 7,
  });
  const setup = {};
  // 评论页口径的作品列表（userpageType=3）
  let feeds = [], buff = "", flag = true, guard = 0;
  while (flag && guard++ < 5 && feeds.length < 50) {
    const r = await __post("/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list", Object.assign(env(), {
      pageSize: 10, onlyUnread: false, needAllCommentCount: true,
      userpageType: 3, forMcn: false, lastBuff: buff,
    }));
    const j = r.json || {};
    if (j.errCode !== 0) { setup.postListErr = j.errCode; break; }
    const d = j.data || {};
    feeds = feeds.concat(d.list || []);
    buff = d.lastBuff || "";
    flag = !!d.continueFlag && !!buff;
    await __sleep(500);
  }
  setup.feedCount = feeds.length;
  const feedById = (id) => feeds.find((p) => String(p.objectId || "") === String(id) || String(p.exportId || "") === String(id));
  // 标题匹配须含 shortTitle（视频号标题与简介分离，仅匹配简介会错中「下篇预告」提到的作品）
  const feedText = (p) => {
    const d = p.desc || {};
    const st = (d.shortTitle && d.shortTitle[0] && d.shortTitle[0].shortTitle) || "";
    return String(st) + "\\n" + String(d.description || "");
  };
  const feedByTitle = (t) => feeds.find((p) => feedText(p).includes(t));
  // 闭包状态：真发计数（MAX 上限）/ 连续发送失败计数 / 中止标记（风控或连续失败）
  let executed = 0;
  let consecutiveFail = 0;
  let abortDetail = "";
  // create_comment 结果判定：errCode===0 且（baseResp 不存在 或 baseResp.errcode===0）才算 ok
  const judgeCreate = (crj0, res, okDetail) => {
    const crj = crj0 || {};
    res.errCode = crj.errCode;
    const base = crj.data && crj.data.baseResp ? crj.data.baseResp : null;
    const baseErr = base ? base.errcode : null;
    if (crj.errCode === 0 && (!base || baseErr === 0)) {
      res.status = "ok"; res.detail = okDetail;
      executed++; consecutiveFail = 0;
      return;
    }
    res.status = "error";
    res.detail = "create_comment 失败 errCode=" + crj.errCode + " baseResp.errcode=" + baseErr + " " + String(crj.errMsg || "").slice(0, 60);
    consecutiveFail++;
    if (baseErr === -4300) {
      abortDetail = "风控(-4300)已中止本轮";
    } else if (!abortDetail && consecutiveFail >= 3) {
      abortDetail = "连续3次发送失败已中止本轮";
    }
  };
  window.__mmReply = {
    run: async (rp0, EXEC) => {
      const rp = rp0 || {};
      const res = {
        index: Number(rp.index) || 0, platform: "视频号",
        commentId: String(rp.commentId || ""), workId: String(rp.workId || ""),
        workTitle: String(rp.workTitle || ""), content: String(rp.content || "").slice(0, 80),
        mode: EXEC ? "execute" : "dry", status: "error", detail: "",
      };
      try {
        if (abortDetail) { res.status = "skipped"; res.detail = abortDetail; return res; }
        if (!String(rp.content || "").trim()) throw new Error("content 为空");
        if (executed >= MAX) {
          res.status = "skipped"; res.detail = "达到单轮上限 MAX=" + MAX;
          return res;
        }
        const feed = (rp.workId && feedById(rp.workId)) || (rp.workTitle && feedByTitle(String(rp.workTitle))) || null;
        if (!feed) throw new Error("作品未找到（workId/workTitle 无匹配）");
        const exportId = String(feed.exportId || feed.objectId || "");
        res.workId = String(feed.objectId || exportId);
        res.workTitle = (((feed.desc || {}).description) || "").slice(0, 40);
        if (rp.commentId) {
          // 回复：先校验目标评论存在
          const cl = await __post("/cgi-bin/mmfinderassistant-bin/comment/comment_list", Object.assign(env(), {
            lastBuff: "", exportId, commentSelection: false, forMcn: false,
          }));
          const cj = cl.json || {};
          if (cj.errCode !== 0) throw new Error("comment_list 校验失败 errCode=" + cj.errCode);
          const found = (((cj.data || {}).comment) || []).find((c) => String(c.commentId || "") === String(rp.commentId));
          if (!found) throw new Error("目标评论不存在（commentId 未命中当前列表）");
          res.detail = "目标评论在档：" + String(found.content || "").slice(0, 30);
          if (!EXEC) { res.status = "dry_ok"; return res; }
          const cr = await __post("/cgi-bin/mmfinderassistant-bin/comment/create_comment", Object.assign(env(), {
            exportId, content: String(rp.content),
            replyCommentId: String(rp.commentId),
            rootCommentId: String(rp.rootCommentId || rp.commentId),
            clientId: uuid(),
          }));
          judgeCreate(cr.json, res, "回复成功");
        } else {
          // 顶层新评论（置顶评论补发场景）
          if (!EXEC) {
            res.status = "dry_ok"; res.detail = "将对作品发顶层评论：" + res.workTitle;
            return res;
          }
          const cr = await __post("/cgi-bin/mmfinderassistant-bin/comment/create_comment", Object.assign(env(), {
            exportId, content: String(rp.content),
            replyCommentId: "", rootCommentId: "", clientId: uuid(),
          }));
          judgeCreate(cr.json, res, "顶层评论成功");
        }
      } catch (e) {
        res.status = "error"; res.detail = String((e && e.message) || e).slice(0, 140);
      }
      if (EXEC && res.status === "ok") await __sleep(2500 + Math.floor(Math.random() * 1500));
      return res;
    },
  };
  return setup;
})()
`;
}

/** 抖音/快手 setup：定义 DOM 助手、等一次列表就绪，挂 window.__mmReply.run（单条回复） */
function buildUiSetupScript({ platform, maxPerRun }) {
  return `
(async () => {
  const MAX = ${Number(maxPerRun) || 5};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // 最内层精确文本匹配（按钮常为 icon+文字嵌套，不能用 childElementCount===0 判叶子）
  const deepestByText = (root, text) => {
    const all = [...root.querySelectorAll("button,a,span,div,li")].filter(
      (el) => norm(el.textContent) === text
    );
    if (!all.length) return null;
    // 取「不含同文本子元素」的最内层，再按文本长度升序兜底
    const inner = all.filter(
      (el) => !all.some((o) => o !== el && el.contains(o))
    );
    return (inner.length ? inner : all)[0];
  };
  // 评论块定位：包含目标文本的最小元素，且块内（或其父行内）有「回复」控件
  const findBlock = (matchText) => {
    const cands = [...document.querySelectorAll("div,li,section,article")].filter((el) =>
      norm(el.innerText).includes(matchText)
    );
    cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    for (const el of cands.slice(0, 8)) {
      // 回复按钮可能挂在文本容器的祖先「行」上：向上找 3 层
      let node = el;
      for (let up = 0; up < 4 && node; up++) {
        if (deepestByText(node, "回复")) return { block: el, row: node };
        node = node.parentElement;
      }
    }
    return null;
  };
  const setup = { platform: ${JSON.stringify(platform)} };
  // 等评论列表渲染（页面加载后默认选中最新作品）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (deepestByText(document, "回复")) { ready = true; break; }
    await sleep(500);
  }
  setup.ready = ready;
  setup.replyButtonsFound = [...document.querySelectorAll("button,a,span,div,li")].filter(
    (el) => norm(el.textContent) === "回复"
  ).length;
  // 闭包状态：真发计数（MAX 上限）
  let executed = 0;
  window.__mmReply = {
    run: async (rp0, EXEC) => {
      const rp = rp0 || {};
      const res = {
        index: Number(rp.index) || 0, platform: ${JSON.stringify(platform)},
        commentId: String(rp.commentId || ""), workId: String(rp.workId || ""),
        matchContent: String(rp.matchContent || "").slice(0, 60),
        content: String(rp.content || "").slice(0, 80),
        mode: EXEC ? "execute" : "dry", status: "error", detail: "",
      };
      try {
        const matchText = norm(rp.matchContent);
        if (!matchText) throw new Error("缺 matchContent（目标评论原文，DOM 定位用）");
        if (!String(rp.content || "").trim()) throw new Error("content 为空");
        if (executed >= MAX) { res.status = "skipped"; res.detail = "达到单轮上限 MAX=" + MAX; return res; }
        const hit = findBlock(matchText);
        if (!hit) throw new Error("未在页面找到目标评论块（可能不在当前选中作品下）");
        const { block, row } = hit;
        res.detail = "块定位成功：" + norm(row.innerText).slice(0, 50);
        if (!EXEC) { res.status = "dry_ok"; return res; }
        // 记录点击前已存在的输入框（顶部常驻作者输入框要排除）
        const inputsBefore = new Set([
          ...document.querySelectorAll('textarea,[contenteditable="true"]'),
        ]);
        // 点「回复」
        const replyBtn = deepestByText(row, "回复");
        if (!replyBtn) throw new Error("行内无「回复」控件");
        ["pointerover", "mouseover", "mouseenter"].forEach((t) => {
          try { row.dispatchEvent(new MouseEvent(t, { bubbles: true })); } catch (e) {}
        });
        replyBtn.click();
        // 等新出现的回复输入框（新元素优先；无新元素则退而求行内已有输入框）
        let input = null;
        for (let w = 0; w < 20 && !input; w++) {
          await sleep(300);
          const now = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible);
          const fresh = now.filter((el) => !inputsBefore.has(el));
          const scope = fresh.length ? fresh : now.filter((el) => row.contains(el));
          if (scope.length) {
            const el = scope[scope.length - 1];
            input = { el, type: el.tagName === "TEXTAREA" ? "ta" : "ce" };
          }
        }
        if (!input) throw new Error("点击回复后未出现输入框");
        // 填写
        input.el.focus();
        if (input.type === "ta") {
          input.el.value = String(rp.content);
          input.el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          const okCmd = document.execCommand("insertText", false, String(rp.content));
          if (!okCmd || !norm(input.el.textContent).includes(norm(String(rp.content)).slice(0, 10))) {
            input.el.textContent = String(rp.content);
            input.el.dispatchEvent(new InputEvent("input", { bubbles: true, data: String(rp.content), inputType: "insertText" }));
          }
        }
        await sleep(600);
        // 点「发送」：从输入框向上找，但排除包含点击前常驻输入框（顶部作者框）的候选容器，
        // 防止误点作者框的「发送」；找不到再退行内、最后全局可见兜底
        let sendBtn = null;
        let box = input.el;
        for (let up = 0; up < 5 && box && !sendBtn; up++) {
          box = box.parentElement;
          if (box && ![...inputsBefore].some((el) => box.contains(el))) {
            sendBtn = deepestByText(box, "发送");
          }
        }
        if (!sendBtn) sendBtn = deepestByText(row, "发送");
        if (!sendBtn) {
          // 全局兜底：排除与常驻输入框（inputsBefore）同处一个近层容器的「发送」，
          // 防止误点顶部作者评论框的发送
          const nearPersistent = (el) => {
            let node = el;
            for (let up = 0; up < 5 && node; up++) {
              node = node.parentElement;
              if (node) {
                for (const b of inputsBefore) {
                  if (node.contains(b)) return true;
                }
              }
            }
            return false;
          };
          const globals = [...document.querySelectorAll("button,a,span,div")].filter(
            (el) => norm(el.textContent) === "发送" && visible(el) && !nearPersistent(el)
          );
          sendBtn = globals[globals.length - 1] || null;
        }
        if (!sendBtn) throw new Error("未找到「发送」按钮");
        sendBtn.click();
        // 验证：输入框消失 或 行文本出现回复内容
        let verified = false;
        for (let v = 0; v < 12; v++) {
          await sleep(700);
          const stillInput = visible(input.el) && norm(input.el.value || input.el.textContent || "").includes(norm(String(rp.content)).slice(0, 10));
          const t = norm(row.innerText || "");
          if (!stillInput || t.includes(norm(String(rp.content)).slice(0, 14))) { verified = true; break; }
        }
        if (verified) { res.status = "ok"; res.detail = "回复已发送并验证（输入框已清空/收起）"; executed++; }
        else { res.status = "error"; res.detail = "已点发送但验证超时（需人工核对）"; }
      } catch (e) {
        res.status = "error"; res.detail = String((e && e.message) || e).slice(0, 140);
      }
      if (EXEC && res.status === "ok") await sleep(2500 + Math.floor(Math.random() * 1500));
      return res;
    },
  };
  return setup;
})()
`;
}

/** 平台 → setup 脚本（页面上下文定义 window.__mmReply.run，主进程逐条调用） */
function buildReplySetupScript({ platform, maxPerRun }) {
  if (platform === "视频号") return buildSphSetupScript({ maxPerRun });
  if (platform === "抖音" || platform === "快手") {
    return buildUiSetupScript({ platform, maxPerRun });
  }
  throw new Error(`${platform} 暂不支持回复（v1：抖音/快手/视频号）`);
}

module.exports = {
  buildReplySetupScript,
  buildSphSetupScript,
  buildUiSetupScript,
  FETCH_HELPER,
};
