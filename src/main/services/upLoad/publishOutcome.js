import maybeClosePublishWindow from "./closeWindow.js";
import { capturePublishFailureScreenshot } from "./failureScreenshot.js";

/** 点击发布后等待页面跳转的时长：平台发布成功会自动跳到成功页/列表页 */
export const PUBLISH_NAVIGATE_WAIT_MS = 5000;

export const PUBLISH_ABNORMAL_MESSAGE =
  "发布异常：点击发布后 5 秒页面地址未变化，可能未真正发布，请到平台确认";

/** 发布模式判定窗口：固定 5 秒对慢平台（转码/审核排队）会把已发布误判成异常（PR #52） */
export const PUBLISH_VERDICT_TIMEOUT_MS = 20000;

/**
 * 各平台发布成功后的页面提示文案（命中任一即视为成功信号）。
 *
 * ⚠ 只收「完整短语」，不要加「已发布 / 保存成功 / 已保存」这类泛化词：
 * 判据是把整页（含 shadow DOM）所有文本拼起来做 includes，
 * 创作后台的静态 UI（左侧导航、标签页、引导文案）里本来就常出现这些词，
 * 一旦命中会在点击后立刻返回假成功（PR #52 锁定的反向假回执）。
 */
const SUCCESS_TOAST_TEXTS = [
  "发布成功",
  "发表成功",
  "上传成功",
  "投稿成功",
  "草稿已保存",
];

/**
 * 平台侧「拦住这次提交」的校验提示（点发布后页面弹出来、并吞掉点击的提示）。
 *
 * 典型：快手话题超过 4 个时弹「最多只能添加4个话题」，此时点「发布」不跳转、
 * 不报错，只在 20000ms 判定窗口里什么都没发生，调用方只能拿到
 * 「点击发布后 5 秒页面地址未变化」——把平台的明确原因抹成了看不出问题的通用文案。
 * 这些文案只用于「地址未变化」时补充证据，不参与成功判定，误命中不会造假成功。
 */
const BLOCKING_TIP_PATTERNS = [
  // 最多只能添加4个话题 / 最多上传1个视频 / 最多输入30个字
  /最多(?:只能)?\s*(?:添加|上传|发布|选择|输入|填写|挂)?\s*\d+\s*(?:个|张|条|字)/,
  // 话题超出限制 / 标题超过上限 / 字数超出限制
  /(?:话题|标签|标题|简介|描述|正文|字数|图片|视频)[^。！\n]{0,14}(?:超出|超过)[^。！\n]{0,10}(?:限制|上限|字数)/,
  // 不能超过30个字 / 不得超过 4 个话题
  /(?:不能|不得)超过\s*\d+\s*(?:个|张|条|字)/,
  // 请先删除部分话题 / 请减少图片数量
  /请(?:先)?(?:删除|减少|移除)[^。！\n]{0,12}(?:话题|标签|图片|视频)/,
];

/**
 * 发布模式轮询等待成功信号：URL 跳转或平台成功提示，任一命中立即返回。
 * 全程顺带记录页面上的「阻断类校验提示」，供地址未变化时补充失败原因。
 * @returns {Promise<{ok: boolean, signal: string, urlAfter: string, blockHint: string}>}
 */
async function waitForPublishSignal(page, urlBefore, timeoutMs) {
  // 按轮次而不是墙钟计时：每轮含 1 秒等待，真实环境等价于 timeoutMs；
  // 单测里 waitForTimeout 是空实现，也不会空转 20 秒。
  const maxRounds = Math.max(2, Math.ceil(timeoutMs / 1000));
  let urlAfter = readPageUrl(page);
  let blockHint = "";
  for (let round = 0; round < maxRounds; round++) {
    urlAfter = readPageUrl(page);
    if (
      urlBefore &&
      urlAfter &&
      normalizeUrl(urlAfter) !== normalizeUrl(urlBefore)
    ) {
      return { ok: true, signal: "url_changed", urlAfter, blockHint: "" };
    }
    const text = await readPageText(page);
    if (text) {
      for (const kw of SUCCESS_TOAST_TEXTS) {
        if (text.includes(kw)) {
          return { ok: true, signal: `toast:${kw}`, urlAfter, blockHint: "" };
        }
      }
      if (!blockHint) {
        // 取首次命中的上下文：平台 toast 一般只存活几秒，越早拿到越准
        blockHint = matchPatternWithContext(BLOCKING_TIP_PATTERNS, text, 12);
      }
    }
    await delay(page, 1000);
  }
  return { ok: false, signal: "none", urlAfter: readPageUrl(page), blockHint };
}

/** 存草稿结果的轮询间隔：toast 存活一般 ≥2 秒，400ms 足够捕捉 */
export const DRAFT_VERIFY_POLL_INTERVAL_MS = 400;

/**
 * 存草稿成功的页面文案：出现即确认草稿已保存（#42）。
 * 覆盖各平台通用 toast 文案；后续用真实账号逐平台校准后，
 * 可按 data.pt 在 pollDraftVerdict 里追加平台专属信号。
 */
const DRAFT_SUCCESS_PATTERNS = [
  /保存成功/,
  /已保存到草稿/,
  /已保存至草稿/,
  /已存为草稿/,
  /已存入草稿/,
  /存草稿成功/,
  /草稿已保存/,
  /稿件已保存/,
  /作品已保存/,
];

/**
 * 存草稿失败的强信号：出现即抛错走各平台 catch 的失败上报
 * （status:false，队列 transport 由此触发重试），退出码 3。
 * 只收「明确表示本次保存没成」的文案，避免误判导致重复上传。
 */
const DRAFT_FAILURE_PATTERNS = [
  /保存失败/,
  /发布失败/,
  /提交失败/,
  /上传失败/,
  /网络(?:异常|错误|请求失败|开小差|不给力)/,
  /(?:服务器|系统|服务)(?:异常|错误|繁忙|开小差)/,
  /登录(?:已)?(?:过期|失效)|账号未登录|请先登录|重新登录|登录信息失效/,
  /操作(?:过于)?频繁|请求过多|稍(?:候|后)再(?:试|来)/,
  /内容(?:包含)?(?:敏感|违规)|审核未通过/,
];

/**
 * 存草稿失败的可疑信号（表单校验提示等）：可能来自常驻的输入辅助文案，
 * 单独出现时不判失败，只作为「未确认」时的 evidence 提示人工核对。
 */
const DRAFT_VALIDATION_PATTERNS = [
  /请(?:先)?(?:填写|输入|选择|上传|勾选|设置|完善)/,
  /(?:不能|不可)为空|必填/,
  /字数(?:已)?超出|超出.{0,6}限制|内容过长/,
];

/** 点击存草稿后页面跳到登录页 → 登录态失效，判失败 */
const LOGIN_URL_PATTERN = /passport|\/login(?:[?/.]|$)|\bsso\b|signin|sign-in/i;

/** 安全读取当前页面地址，页面已销毁时返回空串 */
export function readPageUrl(page) {
  try {
    if (!page || typeof page.url !== "function") return "";
    return String(page.url() || "");
  } catch (_) {
    return "";
  }
}

/** 忽略末尾斜杠等无意义差异，避免把同一地址判成已跳转 */
function normalizeUrl(url) {
  return String(url || "")
    .trim()
    .replace(/[#?]$/, "")
    .replace(/\/$/, "");
}

function delay(page, ms) {
  if (page && typeof page.waitForTimeout === "function") {
    return page.waitForTimeout(ms).catch(() => {});
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 读取页面正文文本（含开放 shadow root 与同源 iframe），用于匹配保存成功/失败提示；
 *  页面跳转中或已销毁时返回空串。视频号等内容渲染在 wujie 影子树里，
 *  body.innerText 拿不到，必须递归收集 shadowRoot.textContent；
 *  wujie 的部分 UI（如 toast）渲染在其内部 iframe 里，需一并遍历 */
export async function readPageText(page) {
  if (!page || typeof page.evaluate !== "function") return "";
  try {
    return String(
      (await page.evaluate(() => {
        try {
          const acc = [];
          const visit = (root) => {
            try {
              const t = String(root.textContent || "");
              if (t) acc.push(t);
            } catch (_) {
              /* 单个 root 读取失败不阻断 */
            }
            const els = root.querySelectorAll ? root.querySelectorAll("*") : [];
            for (const el of els) {
              if (el.shadowRoot) visit(el.shadowRoot);
              // 同源 iframe（wujie 内部容器）：跨域时访问 contentDocument 会抛错，静默跳过
              if (el.tagName === "IFRAME") {
                try {
                  const doc = el.contentDocument;
                  if (doc && doc.body) visit(doc.body);
                } catch (_) {
                  /* 跨域 iframe */
                }
              }
            }
          };
          if (document.body) visit(document.body);
          return acc.join("\n");
        } catch (_) {
          return "";
        }
      })) || ""
    );
  } catch (_) {
    // 执行上下文随页面跳转被销毁属正常，下一轮轮询再试
    return "";
  }
}

/** 返回第一个命中的文案；无命中返回空串 */
function matchPattern(patterns, text) {
  if (!text) return "";
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return "";
}

/** 命中文案在页面文本中的上下文（前后各取一段），用于定位提示指向的字段 */
function matchPatternWithContext(patterns, text, pad = 30) {
  if (!text) return "";
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m.index != null) {
      const start = Math.max(0, m.index - pad);
      const end = Math.min(text.length, m.index + m[0].length + pad);
      return text.slice(start, end).replace(/\s+/g, " ").trim();
    }
    if (m) return m[0];
  }
  return "";
}

/**
 * 点击「存草稿」后轮询页面信号，判定保存结果。
 *
 * #42：草稿模式不跳转，此前只要点击不抛错就一律 status:true，
 * 后台无草稿也回报成功。这里在回执前给出独立判据：
 * - verified   页面出现保存成功提示，或地址跳转（管理页/成功页）
 * - failed     页面出现明确失败文案，或跳转到登录页
 * - unverified 两者皆无：无法确认，由上层标记 needs_attention（退出码 4，不触发重试）
 *
 * @param {import("puppeteer-core").Page} page
 * @param {object} options
 * @param {string} [options.urlBefore] 点击存草稿前的页面地址
 * @param {number} [options.waitMs] 轮询窗口总时长
 * @returns {Promise<{outcome: "verified"|"failed"|"unverified", evidence: string}>}
 */
export async function pollDraftVerdict(
  page,
  { urlBefore, waitMs = PUBLISH_NAVIGATE_WAIT_MS } = {}
) {
  const deadline = Date.now() + Math.max(waitMs, 0);
  let validationHint = "";
  let lastText = "";
  do {
    const urlAfter = readPageUrl(page);
    if (
      urlBefore &&
      urlAfter &&
      LOGIN_URL_PATTERN.test(urlAfter) &&
      !LOGIN_URL_PATTERN.test(urlBefore)
    ) {
      return {
        outcome: "failed",
        evidence: "页面跳转到了登录页，登录态可能已失效",
      };
    }
    const text = await readPageText(page);
    lastText = text;
    const failed = matchPattern(DRAFT_FAILURE_PATTERNS, text);
    if (failed) {
      return { outcome: "failed", evidence: `页面提示「${failed}」` };
    }
    const saved = matchPattern(DRAFT_SUCCESS_PATTERNS, text);
    if (saved) {
      return { outcome: "verified", evidence: `页面提示「${saved}」` };
    }
    if (!validationHint) {
      const validation = matchPatternWithContext(DRAFT_VALIDATION_PATTERNS, text);
      if (validation) validationHint = `页面出现校验提示：…${validation}…`;
    }
    if (
      urlBefore &&
      urlAfter &&
      normalizeUrl(urlAfter) !== normalizeUrl(urlBefore)
    ) {
      return { outcome: "verified", evidence: `页面已跳转：${urlAfter}` };
    }
    if (Date.now() < deadline) {
      await delay(page, DRAFT_VERIFY_POLL_INTERVAL_MS);
    }
  } while (Date.now() < deadline);
  // 未确认时的校准线索：把页面里与保存相关的文本片段打到主进程日志
  const saveRelated = String(lastText || "").match(
    /.{0,40}(?:保存|草稿|成功|失败).{0,40}/g
  );
  console.log(
    `[publish] 草稿校验窗口结束时页面保存相关文本: ${
      saveRelated ? saveRelated.slice(-6).join(" ┃ ") : "（无）"
    }`
  );
  return {
    outcome: "unverified",
    evidence: validationHint || "页面未出现保存成功提示，地址也未变化",
  };
}

/**
 * 点击发布/存草稿后统一回执：
 * 发布模式等待 5 秒，若页面地址没有变化（未跳成功页），
 * 视为「发布异常」上报，避免把疑似失败记成成功。
 *
 * 注意：发布模式始终以 status: true 上报，异常通过 publishAbnormal 标记，
 * 因为 status: false 会触发上层的自动重试，导致重复发布。
 *
 * 草稿模式（#42）：回执前轮询页面信号校验保存结果——
 * 明确失败文案/跳登录页时抛错走各平台 catch 的失败上报（status:false，重试）；
 * 确认成功时正常回执；两者皆无时标记 needs_attention（退出码 4，不重试）。
 *
 * @param {object} options
 * @param {import("puppeteer-core").Page} options.page
 * @param {object} options.data 平台任务数据
 * @param {import("electron").BrowserWindow} options.window
 * @param {{ reply: Function }} options.event
 * @param {string} options.urlBefore 点击发布前的页面地址
 * @param {boolean} [options.isDraftMode] 存草稿模式，回执前做保存结果校验
 * @param {string} [options.successMessage]
 * @param {object} [options.extraPayload] 额外回执字段（如 publishMode）
 * @param {{outcome: "verified"|"unverified", evidence: string}} [options.draftVerdictOverride]
 *   草稿模式调用方自带的判定（如视频号已跳草稿列表核对）：提供时跳过页面信号轮询，
 *   避免调用方自身的页面跳转被误读成「保存成功后跳转」的假证据
 * @param {object} [options.closeWindowData] 覆盖关窗判断用的数据
 * @param {number} [options.waitMs]
 */
export async function replyPublishOutcome({
  page,
  data,
  window,
  event,
  urlBefore,
  isDraftMode = false,
  successMessage = "上传成功",
  extraPayload = {},
  draftVerdictOverride,
  closeWindowData,
  waitMs = PUBLISH_NAVIGATE_WAIT_MS,
}) {
  // 草稿模式：先轮询页面信号校验保存结果，再决定回执（#42）。
  // 此前只要点击不抛错就一律 status:true，后台无草稿也回报成功。
  if (isDraftMode) {
    // 调用方自带判定（如视频号已跳草稿列表核对）优先，避免其自身跳转污染 URL 证据；
    // 其次沿用「extraPayload.draftVerified === true 即已确认」的约定；否则轮询页面信号
    const preVerified = extraPayload && extraPayload.draftVerified === true;
    const verdict =
      draftVerdictOverride ||
      (preVerified
        ? { outcome: "verified", evidence: "调用方已通过草稿列表核对到新增草稿" }
        : await pollDraftVerdict(page, { urlBefore, waitMs }));

    // 明确失败：抛错走各平台 catch 的失败上报（截图 + status:false，
    // 队列 transport 由此触发重试），CLI 退出码 3
    if (verdict.outcome === "failed") {
      console.warn(
        `[publish] ${data.pt || ""} 保存草稿失败：${verdict.evidence}`
      );
      throw new Error(`保存草稿失败：${verdict.evidence}`);
    }

    const urlAfter = readPageUrl(page);
    const urlUnchanged =
      !!urlBefore &&
      !!urlAfter &&
      normalizeUrl(urlAfter) === normalizeUrl(urlBefore);
    const verified = verdict.outcome === "verified";
    const payload = {
      ...data,
      ...extraPayload,
      status: true,
      publishPageUrl: urlAfter,
      message: verified
        ? successMessage
        : `未能确认草稿是否保存成功，请到平台草稿箱核对${
            verdict.evidence ? `（${verdict.evidence}）` : ""
          }`,
    };
    // 草稿模式不跳转，地址未变化属正常，不能据此判异常（发布模式的判定见上）。
    // 但仍把「点击存草稿后地址是否变化」记录下来并打日志，便于排查
    // 「回报成功但后台没有草稿」时区分是点了没反应，还是存到了别处。
    if (urlBefore && urlAfter) {
      payload.draftUrlUnchanged = urlUnchanged;
      console.log(
        `[publish] ${data.pt || ""} 存草稿后页面地址${
          urlUnchanged ? "未变化" : "已变化"
        }（草稿模式仅记录，不判定异常）：${urlAfter}`
      );
    }
    if (verified) {
      payload.draftVerified = true;
      console.log(
        `[publish] ${data.pt || ""} 已确认草稿保存成功（${verdict.evidence}）`
      );
    } else {
      // 无成功也无失败信号：不再无条件报成功，标记待人工核对。
      // needsAttention + outcome 由 resolvePublishCompletion 映射为
      // needs_attention（退出码 4），不触发重试，避免重复上传。
      payload.draftVerified = false;
      payload.needsAttention = true;
      payload.outcome = "draft_unverified";
      // 保留当前页面画面作为证据，便于人工核对（截图失败不影响回执）
      const shot = await capturePublishFailureScreenshot(page, data, {
        window,
      });
      if (shot) payload.failScreenshot = shot;
      console.warn(`[publish] ${data.pt || ""} ${payload.message}`);
    }

    try {
      event.reply("puppeteerFile-done", payload);
    } catch (e) {
      console.error("发布回执发送失败:", e && e.message ? e.message : e);
    }
    maybeClosePublishWindow(closeWindowData || data, window);
    return;
  }

  // 发布模式判定窗口用 20 秒信号轮询；waitMs 仅约束草稿模式（存稿 5 秒足够）
  const verdict = await waitForPublishSignal(page, urlBefore, PUBLISH_VERDICT_TIMEOUT_MS);
  const urlAfter = verdict.urlAfter;
  // 读不到地址（窗口已关/页面销毁）时 abnormal 为 false，不误报异常
  const abnormal = !verdict.ok && !!verdict.urlAfter;
  console.log(
    `[publish] ${data.pt || ""} 发布判定 signal=${verdict.signal} ${
      abnormal
        ? "→ 异常"
        : verdict.ok
          ? "→ 成功"
          : "→ 无法判定（页面已销毁/读不到地址）"
    }`
  );

  const payload = {
    ...data,
    ...extraPayload,
    status: true,
    publishPageUrl: urlAfter,
    publishSignal: verdict.signal,
    message: abnormal
      ? `${PUBLISH_ABNORMAL_MESSAGE}${
          verdict.blockHint ? `；页面提示「${verdict.blockHint}」` : ""
        }`
      : successMessage,
  };
  if (abnormal) {
    payload.publishAbnormal = true;
    payload.outcome = "publish_abnormal";
    payload.needsAttention = true;
    // 平台自己说清了为什么没提交成功时，把原文带回回执与日志：
    // 否则用户只看到「页面地址未变化」，得自己开截图找原因。
    if (verdict.blockHint) payload.publishBlockHint = verdict.blockHint;
    // 疑似没发出去时页面还停在发布页（通常是平台校验提示 / 风控弹窗），先截图再关窗。
    // 传入 window：hidden 窗口下 CDP 截图可能等不到合成帧超时，用 capturePage 兜底。
    const shot = await capturePublishFailureScreenshot(page, data, { window });
    if (shot) payload.failScreenshot = shot;
    console.warn(
      `[publish] ${data.pt} ${payload.message}（地址：${urlAfter}）`
    );
  }

  try {
    event.reply("puppeteerFile-done", payload);
  } catch (e) {
    console.error("发布回执发送失败:", e && e.message ? e.message : e);
  }
  maybeClosePublishWindow(closeWindowData || data, window);
}

/**
 * 平台 handler 的上传失败回执：先在失败画面上截图，再发 status:false。
 *
 * 各平台 catch 分支原本各自 event.reply("puppeteerFile-done", {...})，
 * 这里统一收口，避免每个平台再复制一遍截图逻辑。
 *
 * @param {object} options
 * @param {import("puppeteer-core").Page} options.page
 * @param {object} options.data
 * @param {import("electron").BrowserWindow} options.window
 * @param {{ reply: Function }} options.event
 * @param {string} options.message 失败原因
 * @param {object} [options.extraPayload]
 * @param {boolean} [options.closeWindow] 是否关闭发布窗口，默认保持各平台原行为（关闭）
 */
export async function replyPublishFailure({
  page,
  data,
  window,
  event,
  message,
  extraPayload = {},
  closeWindow = true,
}) {
  const shot = await capturePublishFailureScreenshot(page, data, { window });
  try {
    event.reply("puppeteerFile-done", {
      ...data,
      ...extraPayload,
      status: false,
      message,
      ...(shot ? { failScreenshot: shot } : {}),
    });
  } catch (e) {
    // 队列 transport 用带 payload 的异常通知外层重试；不能当作 IPC 发送失败吞掉。
    if (e && e._mmUploadFailurePayload) throw e;
    console.error("发布失败回执发送失败:", e && e.message ? e.message : e);
  }
  if (closeWindow) maybeClosePublishWindow(data, window);
}
