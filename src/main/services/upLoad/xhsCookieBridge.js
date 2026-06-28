"use strict";

import { session } from "electron";

/**
 * 小红书创作者后台登录所需的关键 Cookie 名称。
 * 这些 cookie 是从 Electron session 导出并注入真实 Chrome 的最小必要集合。
 */
const XHS_KEY_COOKIE_NAMES = [
  "access-token-creator.xiaohongshu.com",
  "customer-sso-sid",
  "galaxy_creator_session_id",
  "x-user-id-creator.xiaohongshu.com",
];

const XHS_CREATOR_DOMAIN = "creator.xiaohongshu.com";
const XHS_CREATOR_URL = "https://creator.xiaohongshu.com";

/**
 * 从 Electron session partition 导出小红书创作者后台的 cookie。
 *
 * @param {string} partition - Electron session partition 名（如 "persist:13800138000_小红书"）
 * @returns {Promise<Array<{name: string, value: string, domain: string, path: string, httpOnly?: boolean, secure?: boolean}>>}
 */
export async function exportXhsCookies(partition) {
  try {
    const ses = session.fromPartition(partition);
    const rawCookies = await ses.cookies.get({ url: XHS_CREATOR_URL });

    const keyCookies = rawCookies
      .filter((c) => XHS_KEY_COOKIE_NAMES.includes(c.name))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || XHS_CREATOR_DOMAIN,
        path: c.path || "/",
        httpOnly: c.httpOnly || false,
        secure: c.secure || true,
        expires: c.expirationDate
          ? Math.floor(c.expirationDate)
          : Math.floor(Date.now() / 1000) + 90 * 86400,
      }));

    return keyCookies;
  } catch (err) {
    console.error("[xhs-chrome] 导出 cookie 失败:", err?.message || err);
    return [];
  }
}

/**
 * 将 cookie 列表注入到 puppeteer page 中。
 * 注入前会先 navigate 到目标域（cookie domain 校验需要）。
 *
 * @param {import("puppeteer-core").Page} page
 * @param {Array} cookies - cookie 对象数组
 */
export async function injectCookiesIntoPage(page, cookies) {
  if (!cookies || cookies.length === 0) {
    console.warn("[xhs-chrome] 没有 cookie 可注入，可能需要手动登录");
    return;
  }

  try {
    // puppeteer-core 的 setCookie 支持直接设置指定 domain 的 cookie，无需先导航。
    // 如果先导航到目标域，服务端可能在响应中下发 Set-Cookie 覆盖/清除登录态。
    await page.setCookie(...cookies);
    console.log(`[xhs-chrome] 已注入 ${cookies.length} 个 cookie`);
  } catch (err) {
    console.error("[xhs-chrome] 注入 cookie 失败:", err?.message || err);
    throw new Error(`Cookie 注入失败: ${err?.message || err}`);
  }
}
