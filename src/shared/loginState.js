"use strict";

/**
 * 登录态判定：主进程（GUI / CLI）与共享层复用的统一规则。
 *
 * 背景：原先各处只判断「登录 cookie 是否存在」，cookie 被服务端提前失效后
 * 依然显示已登录，用户发布时才失败。这里集中做三件事：
 *   1. cookie 存在性 + 是否已过期（按 expires 判断）
 *   2. 各平台的登录 cookie 名称 / 附加条件
 *   3. 登录页 URL 识别（供导航后二次确认）
 */

/** 各平台登录 cookie 规则；返回 boolean 表示该 cookie 可作为「已登录」凭据 */
export const LOGIN_COOKIE_RULE = {
  抖音: c => c.name === "passport_assist_user" && !!c.value,
  百家号: c => c.name === "BDUSS" && !!c.value,
  头条: c => c.name === "odin_tt" && !!c.value && c.value.length > 65,
  视频号: c => c.name === "sessionid" && !!c.value,
  番茄视频: c => c.name === "sessionid" && !!c.value,
  哔哩哔哩: c => c.name === "SESSDATA" && !!c.value,
  快手: c => c.name === "userId" && !!c.value,
  掘金: c => c.name === "passport_csrf_token" && !!c.value && c.value.length > 10,
};

/** 小红书需要多个 cookie 同时存在才算登录 */
export const XHS_LOGIN_COOKIE_NAMES = [
  "access-token-creator.xiaohongshu.com",
  "customer-sso-sid",
  "galaxy_creator_session_id",
  "x-user-id-creator.xiaohongshu.com",
];

/**
 * 取 cookie 过期时间（毫秒）；无过期时间（会话 cookie）返回 null。
 */
export function getCookieExpireMs(cookie) {
  if (!cookie) return null;
  const exp = cookie.expirationDate;
  if (exp == null || Number.isNaN(exp)) return null;
  return Math.floor(exp * 1000);
}

/**
 * 判断一组 cookie 是否代表「已登录」。
 *
 * 相比旧实现（只看 cookie 是否存在），这里额外排除：
 *   - 已过期但仍留在 cookie jar 里的凭据
 *
 * @param {string} platform 平台名，如「视频号」
 * @param {Array<{name:string,value:string,expirationDate?:number}>} cookies
 * @param {number} [nowMs] 便于测试注入当前时间
 * @returns {{loggedIn:boolean, reason:string, expireMs:number|null}}
 */
export function evaluateLoginCookies(platform, cookies, nowMs = Date.now()) {
  const list = Array.isArray(cookies) ? cookies : [];

  if (platform === "小红书") {
    const hits = new Map();
    for (const c of list) {
      if (!XHS_LOGIN_COOKIE_NAMES.includes(c.name) || !c.value) continue;
      const exp = getCookieExpireMs(c);
      if (exp == null || exp <= nowMs) continue;
      hits.set(c.name, exp);
    }
    if (!XHS_LOGIN_COOKIE_NAMES.every(name => hits.has(name))) {
      return { loggedIn: false, reason: "登录 cookie 不完整或已过期", expireMs: null };
    }
    return {
      loggedIn: true,
      reason: "",
      expireMs: Math.min(...hits.values()),
    };
  }

  const rule = LOGIN_COOKIE_RULE[platform];
  if (!rule) return { loggedIn: false, reason: "未知平台", expireMs: null };

  const hit = list.find(rule);
  if (!hit) return { loggedIn: false, reason: "无登录 cookie", expireMs: null };

  const expireMs = getCookieExpireMs(hit);
  if (expireMs != null && expireMs <= nowMs) {
    return { loggedIn: false, reason: "cookie 已过期", expireMs };
  }
  return { loggedIn: true, reason: "", expireMs };
}

/** 视频号鉴权探测接口：errCode=0 表示会话有效，其余为失败 */
export const SPH_AUTH_PROBE = {
  url: "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data",
  method: "POST",
  body: "{}",
  referer: "https://channels.weixin.qq.com/platform/post/list",
  /**
   * 已确认代表「会话不可用」的错误码。
   * 实测：300330 = 凭据无效；300334 = 会话被服务端作废（账号长期未用 / 异地登录等）。
   * 两种都会让发布页跳到 login.html，因此都按未登录处理。
   */
  invalidErrCodes: [300330, 300334],
};

/** 视频号会话失效的错误码（服务端作废 sessionid） */
export function isSphSessionInvalid(payload) {
  if (!payload) return false;
  const code = payload.errCode != null ? payload.errCode : payload.errcode;
  return SPH_AUTH_PROBE.invalidErrCodes.includes(Number(code));
}

/** 探测响应是否明确表示「会话有效」 */
export function isSphSessionValid(payload) {
  if (!payload) return false;
  const code = payload.errCode != null ? payload.errCode : payload.errcode;
  return Number(code) === 0;
}

/** 各失效错误码对应的人话，便于用户判断是「重新登录」还是「换个账号」 */
const SPH_INVALID_REASONS = {
  300330: "视频号登录凭据无效，请重新登录",
  300334: "视频号会话已失效（服务端已作废），请重新登录",
};

/** 把探测错误码翻成可读原因 */
export function sphInvalidReason(errCode) {
  return SPH_INVALID_REASONS[Number(errCode)] || "视频号会话已失效，请重新登录";
}

/** 是否为视频号登录页地址（用于识别重定向到登录页的失效会话） */
export function isSphLoginUrl(rawUrl) {
  const url = String(rawUrl || "");
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.origin === "https://channels.weixin.qq.com" &&
      (u.pathname === "/login.html" || u.pathname.startsWith("/login/"))
    );
  } catch (_) {
    return url.startsWith("https://channels.weixin.qq.com/login");
  }
}
