"use strict";

/**
 * 评论采集执行器：与 dataStats/collector.js 同构——
 * 为单个「分组 × 平台」开隐藏窗口，复用其 session partition 登录态，
 * 在平台页面上下文执行探针/采集脚本。
 *
 * 两个入口：
 * - probeAccount: 端点探针（sniffer 常开，dump 导航链接 + 页面自身请求端点）
 * - collectComments: 按平台适配器拉评论列表（归一化输出）
 */

const path = require("path");
const fs = require("fs");
const { BrowserWindow, app } = require("electron");
const { PRELOAD_SOURCE_COMMENTS } = require("./preloadSource.js");
const {
  PLATFORM_META,
  PROBE_SCRIPT,
  COMMENTS_ADAPTERS,
} = require("./adapters.js");
const { buildReplySetupScript } = require("./reply.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * preload 必须是磁盘真实文件（同 dataStats：内嵌源码写入 userData，路径稳定）。
 * 评论模块用增强版嗅探（含请求体/json 型响应），独立于 data-stats 的副本。
 */
function ensureSnifferPreloadPath() {
  const file = path.join(
    app.getPath("userData"),
    "comments",
    "preload-sniffer.js"
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PRELOAD_SOURCE_COMMENTS);
  return file;
}

function makeWindow(partition, meta) {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      partition,
      backgroundThrottling: false,
      preload: ensureSnifferPreloadPath(),
      contextIsolation: false,
    },
  });
  if (meta.userAgent) win.webContents.setUserAgent(meta.userAgent);
  win.webContents.on("render-process-gone", () => {
    /* 窗口崩溃由超时兜底 */
  });
  return win;
}

async function loadAndCheck(win, meta, landing) {
  await Promise.race([
    win.loadURL(landing),
    sleep(30000).then(() => {
      throw new Error("落地页加载超时");
    }),
  ]);
  const finalUrl = win.webContents.getURL();
  if (meta.loginUrlPattern && meta.loginUrlPattern.test(finalUrl)) {
    const err = new Error("登录态已失效，请先在「媒体平台管理」重新登录");
    err.code = "NOT_LOGGED_IN";
    throw err;
  }
  await sleep(meta.settleMs || 6000);
  return finalUrl;
}

/**
 * 端点探针。
 * @param {object} opts
 * @param {string} opts.partition  persist:<分组><平台>
 * @param {string} opts.platform   平台中文名（PLATFORM_META 键）
 * @param {string} [opts.url]      自定义落地页（默认平台首页）
 * @param {number} [opts.timeoutMs]
 */
async function probeAccount({ partition, platform, url, clicks, waitMs, fetches, deep, evalFile, timeoutMs = 90000 }) {
  const meta = PLATFORM_META[platform];
  if (!meta) throw new Error(`暂不支持的平台：${platform}`);
  const win = makeWindow(partition, meta);
  const openedUrls = [];
  try {
    // 菜单可能以新标签打开（如抖音互动管理）：记录目标 URL，拒绝真正开窗
    win.webContents.setWindowOpenHandler(({ url }) => {
      openedUrls.push(String(url).slice(0, 200));
      return { action: "deny" };
    });
    const finalUrl = await loadAndCheck(win, meta, url || meta.landingPage);
    // --eval <file>：执行自定义页面脚本（DOM 结构调研等，返回值须为可 JSON 化对象）
    const script = evalFile
      ? fs.readFileSync(evalFile, "utf8")
      : PROBE_SCRIPT({ clicks, waitMs, fetches, deep });
    const result = await Promise.race([
      win.webContents.executeJavaScript(script, true),
      sleep(timeoutMs).then(() => {
        throw new Error("探针执行超时");
      }),
    ]);
    if (!result || typeof result !== "object") {
      throw new Error("探针脚本未返回有效数据");
    }
    return { finalUrl, result, openedUrls };
  } finally {
    try {
      win.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * 评论列表采集。
 * @param {object} opts
 * @param {string} opts.partition
 * @param {string} opts.platform
 * @param {string} [opts.work]   按作品标题/ID 过滤（适配器支持时）
 * @param {number} [opts.limit]  条数上限
 * @param {string} [opts.landingUrl] 覆盖采集落地页（调试用）
 * @param {number} [opts.timeoutMs]
 */
async function collectComments({
  partition,
  platform,
  work = "",
  limit = 200,
  landingUrl = "",
  timeoutMs = 120000,
}) {
  const meta = PLATFORM_META[platform];
  if (!meta) throw new Error(`暂不支持的平台：${platform}`);
  const adapter = COMMENTS_ADAPTERS[platform];
  if (!adapter) {
    throw new Error(
      `${platform} 评论采集适配器尚未实现（先用 comments-probe 探明端点）`
    );
  }
  const win = makeWindow(partition, meta);
  try {
    await loadAndCheck(
      win,
      meta,
      landingUrl || adapter.landingPage || meta.landingPage
    );
    const result = await Promise.race([
      win.webContents.executeJavaScript(
        adapter.collectScript({ work, limit }),
        true
      ),
      sleep(timeoutMs).then(() => {
        throw new Error("评论采集执行超时");
      }),
    ]);
    if (!result || typeof result !== "object") {
      throw new Error("采集脚本未返回有效数据");
    }
    return {
      comments: Array.isArray(result.comments) ? result.comments : [],
      collectedAt: Date.now(),
      extra: result.extra || {},
    };
  } finally {
    try {
      win.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * 评论回复（写操作）。默认 execute=false 只做校验（dry-run）。
 *
 * 逐条执行 + 增量台账：setup 脚本挂 window.__mmReply.run 后，每条回复单独
 * executeJavaScript；每条落定（返回/超时/异常）立即回调 onResult（调用方逐条
 * 写台账），超时或异常即 fail-stop 中止后续——已发送的条目必已入账，
 * 杜绝整批超时销毁窗口导致的审计缺口。
 *
 * @param {object} opts
 * @param {string} opts.partition
 * @param {string} opts.platform
 * @param {Array}  opts.replies   回复条目（形状见 reply.js 头注）
 * @param {boolean} [opts.execute] true=真发（需 CLI --execute 显式给出）
 * @param {number} [opts.maxPerRun] 单轮真发上限（默认 5）
 * @param {Function} [opts.onResult] 每条结果落定即回调（entry）=>void（增量台账）
 * @param {number} [opts.timeoutMs] setup 与单条执行的超时（默认 90s）
 */
async function replyComments({
  partition,
  platform,
  replies,
  execute = false,
  maxPerRun = 5,
  onResult = null,
  timeoutMs = 90000,
}) {
  const meta = PLATFORM_META[platform];
  if (!meta) throw new Error(`暂不支持的平台：${platform}`);
  const adapter = COMMENTS_ADAPTERS[platform];
  const landing = (adapter && adapter.landingPage) || meta.landingPage;
  const setupScript = buildReplySetupScript({ platform, maxPerRun });
  const win = makeWindow(partition, meta);
  try {
    await loadAndCheck(win, meta, landing);
    const setupInfo = await Promise.race([
      win.webContents.executeJavaScript(setupScript, true),
      sleep(timeoutMs).then(() => {
        throw new Error("回复脚本初始化超时");
      }),
    ]);
    const results = [];
    const emit = (entry) => {
      results.push(entry);
      if (typeof onResult === "function") {
        try {
          onResult(entry);
        } catch (e) {
          // 台账写失败不中断执行，但必须高声报出（审计缺一条）
          console.error(
            "[comments-reply] 台账写入失败（该条未落盘，需人工补记）:",
            (e && e.message) || e
          );
        }
      }
    };
    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i] || {};
      let entry;
      try {
        entry = await Promise.race([
          win.webContents.executeJavaScript(
            `window.__mmReply.run(${JSON.stringify({ ...reply, index: i })}, ${
              execute ? "true" : "false"
            })`,
            true
          ),
          sleep(timeoutMs).then(() => {
            throw new Error("单条回复执行超时");
          }),
        ]);
        if (!entry || typeof entry !== "object") {
          throw new Error("回复脚本未返回有效数据");
        }
      } catch (_) {
        // fail-stop：该条可能已部分完成发送，先入账再中止本轮。
        // 带上请求侧标识字段，台账条目自证身份（无需回查 replies 文件对 index）。
        emit({
          index: i,
          platform,
          commentId: String(reply.commentId || ""),
          workId: String(reply.workId || ""),
          workTitle: String(reply.workTitle || ""),
          matchContent: String(reply.matchContent || "").slice(0, 60),
          content: String(reply.content || "").slice(0, 80),
          mode: execute ? "execute" : "dry",
          status: "error",
          detail: "执行超时/中断——该条可能已部分完成发送，需人工平台核对",
        });
        break;
      }
      emit(entry);
    }
    return {
      results,
      extra: {
        ...(setupInfo && typeof setupInfo === "object" ? setupInfo : {}),
        executed: results.filter((r) => r.status === "ok").length,
      },
    };
  } finally {
    try {
      win.destroy();
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = { probeAccount, collectComments, replyComments };
