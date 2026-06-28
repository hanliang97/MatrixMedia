"use strict";

import xhsHandler from "./xhs.js";

/**
 * 小红书 + 真实 Chrome 浏览器的发布处理器。
 *
 * 与 xhs.js（Electron BrowserWindow）的区别：
 * - 接收 puppeteer Browser 对象而非 Electron BrowserWindow
 * - 通过 fakeWindow 适配 maybeClosePublishWindow 的关闭操作
 * - handler 返回后强制关闭真实浏览器窗口
 *
 * @param {import("puppeteer-core").Page} page - puppeteer page（真实Chrome中的页面）
 * @param {object} data - 发布数据，与 xhs.js 格式一致
 * @param {import("puppeteer-core").Browser} browser - puppeteer Browser 对象
 * @param {object} event - transport 对象（支持 event.reply(channel, payload)）
 */
export default async function xhsChromeHandler(page, data, browser, event) {
  console.log("[xhs-chrome] 小红书真实浏览器发布开始:", data.partition || data.pt);

  // 构造与 Electron BrowserWindow 兼容的 fakeWindow，
  // 让 xhs.js 内部的 maybeClosePublishWindow / closeWindow 调用能正常工作。
  let closed = false;
  const fakeWindow = {
    isDestroyed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      console.log("[xhs-chrome] fakeWindow.close → 关闭浏览器");
      try {
        // 标记为程序关窗，避免重试逻辑误判
        fakeWindow._mmClosedByProgram = true;
      } catch (_) {}
      browser.close().catch((err) => {
        console.warn("[xhs-chrome] browser.close 失败:", err?.message || err);
      });
    },
    _mmClosedByProgram: false,
    _mmAllowCloseWithoutConfirm: false,
  };

  try {
    await xhsHandler(page, data, fakeWindow, event);
  } catch (err) {
    console.error("[xhs-chrome] 发布流程异常:", err?.message || err);
  } finally {
    // 确保浏览器被关闭（即使 xhs handler 内部未触发 close）
    if (!closed) {
      try {
        await browser.close();
      } catch (_) {
        // 忽略关闭错误
      }
    }
  }
}
