"use strict";

import { app, session } from "electron";
import puppeteerCore from "puppeteer-core";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { resolveChromePath } from "../chromeConfig.js";

/**
 * 视频号发布走系统 Chrome（无头）。
 *
 * 实测：以 ptConfig 里微信 WMPF UA 在 Electron 中登录得到的会话，
 * helper_upload_params 一律返回 errCode 300001，拿不到上传凭证，视频卡在 0%，
 * 换 UA 也无效；用 `cli login -p sph --browser chrome` 在系统 Chrome 里登录的会话则正常。
 * 因此 Chrome profile 已登录时，发布直接复用该 profile；未登录则由调用方回退 Electron 流程。
 */

const SPH_HOME_URL = "https://channels.weixin.qq.com/platform";

export function hasSphChrome() {
  return !!resolveChromePath();
}

// 与 cliLogin/sphChromeLoginHandler.js 共用同一个 profile
function profileDirFor(partition) {
  return path.join(
    app.getPath("userData"),
    "chrome-sph-login",
    crypto.createHash("sha256").update(partition).digest("hex")
  );
}

/** profile 目录存在才有可能已登录，避免没用过 Chrome 登录的用户每次白启动一次 Chrome */
export function hasSphChromeProfile(partition) {
  return fs.existsSync(profileDirFor(partition));
}

export async function launchSphChrome(partition) {
  const dir = profileDirFor(partition);
  try {
    fs.unlinkSync(path.join(dir, "SingletonLock"));
  } catch (_) {}
  const browser = await puppeteerCore.launch({
    executablePath: resolveChromePath(),
    headless: "new",
    userDataDir: dir,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    defaultViewport: { width: 1300, height: 800 },
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  // 无头 Chrome 的 UA 带 HeadlessChrome，换回同版本的普通 Chrome UA
  await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
  return { browser, page };
}

const isSphLoginUrl = (url) =>
  !url || !url.includes("channels.weixin.qq.com") || url.includes("login");

/** 把 Chrome 里的视频号 cookie 写回 Electron partition，供 cli accounts / 状态检测读取 */
async function syncSphCookiesToPartition(page, partition) {
  const cdp = await page.target().createCDPSession();
  const { cookies } = await cdp.send("Network.getAllCookies");
  await cdp.detach().catch(() => {});
  const ses = session.fromPartition(partition);
  for (const c of cookies) {
    if (!/(^|\.)qq\.com$/.test(c.domain.replace(/^\./, ""))) continue;
    const url = `https://${c.domain.replace(/^\./, "")}${c.path || "/"}`;
    // 先删同名旧 cookie，否则 host-only 与 domain cookie 并存，请求仍带旧 sessionid
    for (const old of await ses.cookies.get({ url, name: c.name })) {
      await ses.cookies.remove(url, old.name);
    }
    await ses.cookies.set({
      url,
      name: c.name,
      value: c.value,
      // CDP 里无前导点 = host-only，不传 domain 才能写成 host-only
      ...(c.domain.startsWith(".") ? { domain: c.domain } : {}),
      path: c.path || "/",
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
    });
  }
  await ses.cookies.flushStore();
}

/** Chrome profile 是否已登录视频号；已登录时顺带把 cookie 同步回 partition */
export async function isSphChromeLoggedIn(page, partition) {
  await page.goto(SPH_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  if (isSphLoginUrl(page.url())) return false;
  await syncSphCookiesToPartition(page, partition);
  return true;
}
