"use strict";

import crypto from "crypto";
import path from "path";
import { SPH_AUTH_PROBE, isSphSessionValid } from "../../../shared/loginState.js";
import { isSphCookie, replaceSphCookies } from "../sphCookieSession.js";

const ORIGIN = "https://channels.weixin.qq.com";
const LOGIN_URL = ORIGIN + "/platform";
const POLL_MS = 2000;

/**
 * 系统 Chrome 登录回退。浏览器/会话/时钟由边界注入，便于在无账号环境验证。
 * 仅同步视频号域名 Cookie；Chrome 与 Electron 两侧鉴权均成功才返回成功。
 */
export function createSphChromeLoginHandler(deps) {
  const active = new Map();
  const now = deps.now || Date.now;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  async function run(options, entry) {
    let stage = "启动浏览器";
    let rollback = null;
    let target = null;
    let previousUserAgent;
    let completed = false;
    try {
      const executablePath = await deps.resolveChromePath();
      if (!executablePath) {
        return { ok: false, exitCode: 1, message: "未找到本机 Chrome / Chromium，请先安装浏览器或配置 Chrome 路径" };
      }
      const proxy = deps.getProxyOptions ? await deps.getProxyOptions(options) : {};
      if (proxy.error) return { ok: false, exitCode: 2, message: proxy.error };
      if (entry.cancelled) return { ok: false, exitCode: 3, message: "视频号登录已取消" };
      const accountDir = crypto.createHash("sha256").update(options.partition).digest("hex");
      const args = ["--no-first-run", "--no-default-browser-check"];
      if (proxy.server) args.push("--proxy-server=" + proxy.server);
      entry.browser = await deps.launchBrowser({
        executablePath,
        headless: false,
        userDataDir: path.join(deps.getProfileRoot(), "chrome-sph-login", accountDir),
        args,
        timeout: 30000,
      });
      const browser = entry.browser;
      let pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      if (proxy.authentication) await page.authenticate(proxy.authentication);
      stage = "加载登录页";
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      const deadline = now() + (options.timeoutMs || 900000);

      while (now() < deadline && !entry.cancelled && browser.isConnected()) {
        pages = await browser.pages();
        // 微信扫码可能打开新标签页；从仍处于视频号域名的页进行同源鉴权。
        const current = pages.slice().reverse().find(p =>
          !p.isClosed() && p.url().startsWith(ORIGIN + "/")
        );
        if (!current) {
          if (pages.length === 0) break;
          await sleep(POLL_MS);
          continue;
        }
        const cookies = (await current.cookies(ORIGIN)).filter(isSphCookie);
        const hasSession = cookies.some(c => c.name === "sessionid" && c.value &&
          (!(c.expires > 0) || c.expires * 1000 > Date.now()));
        if (hasSession) {
          stage = "检查 Chrome 会话";
          // 不只看 sessionid 出现/变化，避免把服务端拒绝的会话记为登录成功。
          const payload = await current.evaluate(async probe => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
              const response = await fetch(probe.url, {
                method: probe.method,
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: probe.body,
                signal: controller.signal,
              });
              return response.ok ? await response.json() : null;
            } catch (_) {
              return null;
            } finally {
              clearTimeout(timer);
            }
          }, SPH_AUTH_PROBE);
          if (isSphSessionValid(payload)) {
            stage = "同步会话";
            target = deps.getTargetSession(options.partition);
            previousUserAgent = target.getUserAgent();
            target.setUserAgent(await browser.userAgent());
            rollback = await replaceSphCookies(target, cookies.filter(cookie =>
              !(cookie.expires > 0) || cookie.expires * 1000 > Date.now()
            ));
            stage = "检查应用会话";
            const verified = await deps.probeImportedSession(options.partition);
            if (verified.ok && verified.loggedIn === true) {
              completed = true;
              return { ok: true, exitCode: 0, message: "视频号登录成功，Chrome 会话已同步到该账号" };
            }
            return { ok: false, exitCode: 3, message: "Chrome 已登录，但应用会话鉴权未通过，请重新登录后再试" };
          }
        }
        await sleep(POLL_MS);
      }
      return { ok: false, exitCode: 3, message: "视频号登录未完成：窗口已关闭或等待超时；请确认扫码微信拥有视频号或已被授权运营" };
    } catch (_) {
      if (entry.cancelled || (entry.browser && !entry.browser.isConnected())) {
        return { ok: false, exitCode: 3, message: "视频号登录窗口已关闭" };
      }
      // cookies.set 等异常可能包含 Cookie 值，不把原始异常传给 renderer/日志。
      return { ok: false, exitCode: 1, message: `视频号 Chrome 登录失败（${stage}），请重试并检查浏览器/网络配置` };
    } finally {
      try {
        if (!completed && rollback) await rollback();
      } finally {
        if (!completed && target && previousUserAgent != null) target.setUserAgent(previousUserAgent);
        if (entry.browser) {
          try { await entry.browser.close(); } catch (_) {}
        }
      }
    }
  }

  const handler = options => {
    const partition = String((options && options.partition) || "");
    if (!partition.startsWith("persist:") || !partition.endsWith("视频号")) {
      return Promise.resolve({ ok: false, exitCode: 2, message: "需要完整的视频号账号 partition" });
    }
    if (partition.includes("-")) {
      return Promise.resolve({ ok: false, exitCode: 2, message: "当前发布端不支持含连字符的视频号分区，请使用与 GUI 一致的账号分区" });
    }
    const existing = active.get(partition);
    if (existing) return existing.promise;
    const entry = { browser: null, cancelled: false };
    entry.promise = run({ ...options, partition }, entry).finally(() => active.delete(partition));
    active.set(partition, entry);
    return entry.promise;
  };
  handler.closeAll = async () => {
    await Promise.all(Array.from(active.values()).map(async entry => {
      entry.cancelled = true;
      if (entry.browser) {
        try { await entry.browser.close(); } catch (_) {}
      }
    }));
  };
  return handler;
}
