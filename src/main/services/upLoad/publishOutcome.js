import maybeClosePublishWindow from "./closeWindow.js";

/** 点击发布后等待页面跳转的时长：平台发布成功会自动跳到成功页/列表页 */
export const PUBLISH_NAVIGATE_WAIT_MS = 5000;

export const PUBLISH_ABNORMAL_MESSAGE =
  "发布异常：点击发布后 5 秒页面地址未变化，可能未真正发布，请到平台确认";

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

/**
 * 点击发布/存草稿后统一回执：
 * 等待 5 秒，若为发布模式且页面地址没有变化（未跳成功页），
 * 视为「发布异常」上报，避免把疑似失败记成成功。
 *
 * 注意：这里始终以 status: true 上报，异常通过 publishAbnormal 标记，
 * 因为 status: false 会触发上层的自动重试，导致重复发布。
 *
 * @param {object} options
 * @param {import("puppeteer-core").Page} options.page
 * @param {object} options.data 平台任务数据
 * @param {import("electron").BrowserWindow} options.window
 * @param {{ reply: Function }} options.event
 * @param {string} options.urlBefore 点击发布前的页面地址
 * @param {boolean} [options.isDraftMode] 存草稿不跳转，跳过地址校验
 * @param {string} [options.successMessage]
 * @param {object} [options.extraPayload] 额外回执字段（如 publishMode）
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
  closeWindowData,
  waitMs = PUBLISH_NAVIGATE_WAIT_MS,
}) {
  await delay(page, waitMs);

  const urlAfter = readPageUrl(page);
  // 读不到地址（窗口已关/页面销毁）时不做异常判定，避免误报
  const urlUnchanged =
    !!urlBefore && !!urlAfter && normalizeUrl(urlAfter) === normalizeUrl(urlBefore);
  const abnormal = !isDraftMode && urlUnchanged;

  const payload = {
    ...data,
    ...extraPayload,
    status: true,
    publishPageUrl: urlAfter,
    message: abnormal ? PUBLISH_ABNORMAL_MESSAGE : successMessage,
  };
  if (abnormal) {
    payload.publishAbnormal = true;
    payload.outcome = "publish_abnormal";
    payload.needsAttention = true;
    console.warn(
      `[publish] ${data.pt} ${PUBLISH_ABNORMAL_MESSAGE}（地址：${urlAfter}）`
    );
  }

  try {
    event.reply("puppeteerFile-done", payload);
  } catch (e) {
    console.error("发布回执发送失败:", e && e.message ? e.message : e);
  }
  maybeClosePublishWindow(closeWindowData || data, window);
}
