"use strict";

import xhsHandler from "./xhs.js";

/**
 * 小红书 + 真实 Chrome 浏览器的发布处理器。
 *
 * 与 xhs.js（Electron BrowserWindow）的区别：
 * - 接收 puppeteer Browser 对象而非 Electron BrowserWindow
 * - 通过 fakeWindow 适配 maybeClosePublishWindow 的关闭操作
 * - 发布完成/失败后只断开 puppeteer 连接，不关闭浏览器窗口，
 *   让用户可以在浏览器中查看结果或手动操作
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
  // 真实浏览器模式：close() 只断开 puppeteer 连接，不关闭 Chrome 窗口。
  let disconnected = false;
  const fakeWindow = {
    isDestroyed() {
      return disconnected;
    },
    close() {
      if (disconnected) return;
      disconnected = true;
      console.log("[xhs-chrome] fakeWindow.close → 断开连接，保留浏览器窗口");
      try {
        fakeWindow._mmClosedByProgram = true;
      } catch (_) {}
      // disconnect 只断开 puppeteer ↔ Chrome 的 DevTools 连接，
      // Chrome 进程和窗口继续保留，用户可以手动操作或关闭
      browser.disconnect();
    },
    _mmClosedByProgram: false,
    _mmAllowCloseWithoutConfirm: false,
  };

  try {
    await xhsHandler(page, data, fakeWindow, event);
  } catch (err) {
    console.error("[xhs-chrome] 发布流程异常:", err?.message || err);
  } finally {
    // 只断开连接，不关闭浏览器 —— 让用户可以手动完成操作或查看结果
    if (!disconnected) {
      disconnected = true;
      try {
        console.log("[xhs-chrome] 发布结束，断开 puppeteer 连接，浏览器保留打开");
        browser.disconnect();
      } catch (_) {
        // 忽略断开错误
      }
    }
  }
}
