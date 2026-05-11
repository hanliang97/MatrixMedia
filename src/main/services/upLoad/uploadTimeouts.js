"use strict";

/**
 * 弱网 / 大文件场景：等待页面出现「上传完成、可继续编辑/发布」等状态的上限。
 * 例如约 2GB @ ~700KB/s 传输约 50 分钟，另预留转码与接口耗时，故用 3 小时档。
 */
export const WAIT_UPLOAD_PROCESSING_MS = 3 * 60 * 60 * 1000;

/**
 * 发布用 BrowserWindow 兜底自动关闭：必须大于弱网下大文件上传所需时间，
 * 否则定时关窗会中断仍在进行的浏览器上传。
 */
export const UPLOAD_WINDOW_AUTO_CLOSE_MS = 4 * 60 * 60 * 1000;

/** CLI `publish` 等待 puppeteerFile-done 的上限，需覆盖弱网下大文件上传 */
export const CLI_PUBLISH_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/**
 * 用短周期 evaluate 轮询替代长时间 waitForFunction，避免 Puppeteer 默认
 * protocolTimeout（约 180s）下单次 CDP Runtime.callFunctionOn 超时。
 *
 * @param {import("puppeteer-core").Page} page
 * @param {() => boolean} pageFn 在浏览器端执行，须可序列化、勿依赖外部闭包
 * @param {number} totalMs
 * @param {number} [stepMs=2000]
 * @param {string} [timeoutMessage] 超时时的 Error.message
 */
export async function pollPageUntil(page, pageFn, totalMs, stepMs = 2000, timeoutMessage) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(pageFn).catch(() => false);
    if (ok) return;
    await page.waitForTimeout(stepMs);
  }
  const err = new Error(timeoutMessage || "等待页面条件超时");
  err.name = "TimeoutError";
  throw err;
}
