"use strict";

/**
 * 弱网 / 大文件场景：等待页面出现「上传完成、可继续编辑/发布」等状态的上限。
 * 例如约 2GB @ ~700KB/s 传输约 50 分钟，另预留转码与接口耗时，故用 3 小时档。
 */
export const WAIT_UPLOAD_PROCESSING_MS = 3 * 60 * 60 * 1000;

/** 弱网或页面资源加载慢时，等待必需 DOM 节点出现的统一上限。 */
export const WAIT_SELECTOR_APPEAR_MS = 5 * 60 * 1000;

/**
 * 发布用 BrowserWindow 兜底自动关闭：必须大于弱网下大文件上传所需时间，
 * 否则定时关窗会中断仍在进行的浏览器上传。
 */
export const UPLOAD_WINDOW_AUTO_CLOSE_MS = 4 * 60 * 60 * 1000;

/** CLI `publish` 等待 puppeteerFile-done 的上限，需覆盖弱网下大文件上传 */
export const CLI_PUBLISH_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const PAGE_CLOSED_ERROR_PATTERN =
  /Target closed|Session closed|Connection closed|Browser has disconnected|Page crashed/i;

/**
 * 发布页面已关闭 / 浏览器已断开的致命异常。
 * 与 SPA 导航期间短暂出现的 Execution context was destroyed 区分开：
 * 后者可继续轮询等待新上下文就绪，前者必须立刻中止轮询，避免空转数小时。
 */
export class PageClosedError extends Error {
  constructor(message = "发布页面已关闭或连接已断开") {
    super(message);
    this.name = "PageClosedError";
    this.code = "PAGE_CLOSED";
  }
}

export function isPageClosed(page) {
  if (!page) return true;
  try {
    if (typeof page.isClosed === "function" && page.isClosed()) return true;
  } catch (_) {
    return true;
  }
  try {
    if (typeof page.browser === "function") {
      const browser = page.browser();
      if (
        browser &&
        typeof browser.isConnected === "function" &&
        !browser.isConnected()
      ) {
        return true;
      }
    }
  } catch (_) {
    return true;
  }
  return false;
}

export function isPageClosedError(err) {
  if (!err) return false;
  if (
    err instanceof PageClosedError ||
    err.name === "PageClosedError" ||
    err.code === "PAGE_CLOSED"
  ) {
    return true;
  }
  const msg = String(err.message || err);
  return PAGE_CLOSED_ERROR_PATTERN.test(msg);
}

export function assertPageOpen(page, message) {
  if (isPageClosed(page)) {
    throw new PageClosedError(message || "发布页面已关闭或连接已断开");
  }
}

/**
 * 睡眠 stepMs，同时监听 page 的 close 事件，窗口关闭时立刻唤醒并抛 PageClosedError。
 */
export async function waitStepOrPageClose(page, stepMs) {
  assertPageOpen(page);
  const sleepMs = Math.max(0, Number(stepMs) || 0);
  const waitPromise =
    page && typeof page.waitForTimeout === "function"
      ? Promise.resolve().then(() => page.waitForTimeout(sleepMs))
      : new Promise((resolve) => setTimeout(resolve, sleepMs));

  if (!page || typeof page.once !== "function") {
    try {
      await waitPromise;
    } catch (err) {
      if (isPageClosedError(err)) {
        throw err instanceof PageClosedError
          ? err
          : new PageClosedError(err.message || "发布页面已关闭");
      }
      throw err;
    }
    assertPageOpen(page);
    return;
  }

  let onClose = null;
  const closePromise = new Promise((_, reject) => {
    onClose = () => reject(new PageClosedError("发布页面已关闭"));
    page.once("close", onClose);
  });

  try {
    await Promise.race([waitPromise, closePromise]);
  } catch (err) {
    if (isPageClosedError(err)) {
      throw err instanceof PageClosedError
        ? err
        : new PageClosedError(err.message || "发布页面已关闭");
    }
    throw err;
  } finally {
    if (onClose) {
      if (typeof page.off === "function") {
        page.off("close", onClose);
      } else if (typeof page.removeListener === "function") {
        page.removeListener("close", onClose);
      }
    }
  }
  assertPageOpen(page);
}

/**
 * 用短周期 evaluate 轮询替代长时间 waitForFunction，避免 Puppeteer 默认
 * protocolTimeout（约 180s）下单次 CDP Runtime.callFunctionOn 超时。
 *
 * @param {import("puppeteer-core").Page} page
 * @param {Function|string} pageFn 在浏览器端执行，须可序列化、勿依赖外部闭包
 * @param {number} totalMs
 * @param {number} [stepMs=2000]
 * @param {string} [timeoutMessage] 超时时的 Error.message
 * @param {{
 *   pageArgs?: any[],
 *   heartbeatMs?: number,
 *   onHeartbeat?: (elapsedMs: number) => void,
 *   onBeforeTick?: () => void | Promise<void>,
 *   acceptResult?: (result: any) => any
 * }} [options]
 */
export async function pollPageUntil(
  page,
  pageFn,
  totalMs,
  stepMs = 2000,
  timeoutMessage,
  options = {}
) {
  const startedAt = Date.now();
  const deadline = startedAt + totalMs;
  const pageArgs =
    options && Array.isArray(options.pageArgs) ? options.pageArgs : null;
  const heartbeatMs =
    options && Number(options.heartbeatMs) > 0
      ? Number(options.heartbeatMs)
      : 0;
  const onHeartbeat =
    options && typeof options.onHeartbeat === "function"
      ? options.onHeartbeat
      : null;
  const onBeforeTick =
    options && typeof options.onBeforeTick === "function"
      ? options.onBeforeTick
      : null;
  const acceptResult =
    options && typeof options.acceptResult === "function"
      ? options.acceptResult
      : null;
  let lastHeartbeatAt = startedAt;

  while (Date.now() < deadline) {
    assertPageOpen(page);
    if (onBeforeTick) {
      await onBeforeTick();
    }
    let result = false;
    try {
      result =
        pageArgs && pageArgs.length > 0
          ? await page.evaluate(pageFn, ...pageArgs)
          : await page.evaluate(pageFn);
    } catch (err) {
      if (isPageClosedError(err)) {
        throw err instanceof PageClosedError
          ? err
          : new PageClosedError(err.message || "发布页面已关闭");
      }
      assertPageOpen(page);
      result = false;
    }
    if (acceptResult) {
      const accepted = acceptResult(result);
      if (accepted) return accepted;
    } else if (result) {
      return result;
    }
    if (heartbeatMs > 0 && onHeartbeat && Date.now() - lastHeartbeatAt >= heartbeatMs) {
      lastHeartbeatAt = Date.now();
      try {
        onHeartbeat(lastHeartbeatAt - startedAt);
      } catch (_) {}
    }
    await waitStepOrPageClose(page, stepMs);
  }
  assertPageOpen(page);
  const err = new Error(timeoutMessage || "等待页面条件超时");
  err.name = "TimeoutError";
  throw err;
}
