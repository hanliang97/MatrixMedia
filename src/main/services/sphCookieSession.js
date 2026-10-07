"use strict";

const HOST = "channels.weixin.qq.com";
const pending = new WeakMap();

export function isSphCookie(cookie) {
  const domain = String(cookie.domain || "").replace(/^\./, "");
  return domain === HOST || domain === "weixin.qq.com";
}

function cookieUrl(cookie) {
  return "https://" + String(cookie.domain || HOST).replace(/^\./, "") + (cookie.path || "/");
}

/** 保留 host-only、path 与真实有效期，不能把 host-only Cookie 扩成域 Cookie。 */
export function toSphSetCookie(cookie) {
  const value = {
    url: cookieUrl(cookie), name: cookie.name, value: cookie.value,
    path: cookie.path || "/", httpOnly: Boolean(cookie.httpOnly), secure: Boolean(cookie.secure),
  };
  if (cookie.hostOnly === false || String(cookie.domain).startsWith(".")) value.domain = cookie.domain;
  const expires = cookie.expirationDate == null ? cookie.expires : cookie.expirationDate;
  if (expires > 0) value.expirationDate = expires;
  const sameSite = { Strict: "strict", Lax: "lax", None: "no_restriction" };
  if (cookie.sameSite) value.sameSite = sameSite[cookie.sameSite] || cookie.sameSite;
  return value;
}

function locked(ses, work) {
  const previous = pending.get(ses) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  pending.set(ses, next);
  const cleanup = () => { if (pending.get(ses) === next) pending.delete(ses); };
  next.then(cleanup, cleanup);
  return next;
}

function cookieIdentity(cookie) {
  let domain = String(cookie.domain || "");
  if (cookie.hostOnly === false && !domain.startsWith(".")) domain = "." + domain;
  return domain + "|" + (cookie.path || "/") + "|" + cookie.name;
}

async function clearSphCookies(ses, wanted = []) {
  const cookies = (await ses.cookies.get({})).filter(isSphCookie);
  const retained = new Set(wanted.map(cookieIdentity));
  // remove(url, name) 会同时删除适用于该 URL 的父域同名 Cookie。
  // 用相同 domain/path identity 的过期写入精确删除，保留 .qq.com 等其他作用域。
  for (const cookie of cookies) {
    if (!retained.has(cookieIdentity(cookie))) {
      await ses.cookies.set({ ...toSphSetCookie(cookie), expirationDate: 1 });
    }
  }
}

async function writeSphCookies(ses, cookies) {
  for (const cookie of cookies) await ses.cookies.set(toSphSetCookie(cookie));
  await ses.cookies.flushStore();
  await ses.flushStorageData();
}

async function replace(ses, cookies) {
  const snapshot = (await ses.cookies.get({})).filter(isSphCookie);
  const restore = async () => {
    try {
      await clearSphCookies(ses, snapshot);
      await writeSphCookies(ses, snapshot);
    } catch (_) {
      throw new Error("恢复视频号会话失败，请重新登录该账号");
    }
  };
  try {
    await clearSphCookies(ses, cookies);
    await writeSphCookies(ses, cookies.filter(isSphCookie));
  } catch (_) {
    await restore();
    throw new Error("写入视频号会话失败，已恢复原会话");
  }
  return restore;
}

/** 完整替换同一视频号分区的 Cookie，返回失败时可调用的回滚函数。 */
export function replaceSphCookies(ses, cookies) {
  return locked(ses, () => replace(ses, cookies)).then(restore => () => locked(ses, restore));
}

/**
 * 旧域 Cookie 与扫码写入的 host-only sessionid 并存时，旧值会随请求一起发送。
 * 候选会话须先通过服务端鉴权，替换后原生鉴权仍需通过；未知/拒绝结果不提交整理。
 */
export function reconcileSphCookies(ses, verifySession) {
  return locked(ses, async () => {
    const cookies = (await ses.cookies.get({})).filter(isSphCookie);
    const sessions = cookies.filter(c => c.name === "sessionid");
    if (sessions.length < 2 || typeof verifySession !== "function") return { changed: false };
    const candidates = sessions.filter(c => (c.path || "/") === "/" && c.value &&
      (!(c.expirationDate > 0) || c.expirationDate * 1000 > Date.now()));
    candidates.sort((a, b) => Number(b.hostOnly && b.domain === HOST) - Number(a.hostOnly && a.domain === HOST));
    for (const candidate of candidates) {
      const selected = cookies.filter(c => c.name !== "sessionid" || c === candidate);
      const verdict = await verifySession(selected);
      if (!verdict.ok || verdict.loggedIn !== true) continue;
      const restore = await replace(ses, selected);
      try {
        const actual = await verifySession();
        if (actual.ok && actual.loggedIn === true) return { changed: true, verified: true, removed: sessions.length - 1 };
      } catch (_) {
        // 仍需恢复，不能因探测错误销毁原会话。
      }
      await restore();
    }
    return { changed: false };
  });
}
