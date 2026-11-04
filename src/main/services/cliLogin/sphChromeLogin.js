"use strict";

import { app, session } from "electron";
import puppeteer from "puppeteer-core";
import { resolveChromePath } from "../chromeConfig.js";
import { probeSphSession } from "../sphAuthProbe.js";
import {
  applyAccountProxyToSession,
  findAccountRecord,
  parseProxyUrl,
  pickActiveAccountProxy,
} from "../proxyConfig.js";
import { getProxyBridge } from "../socksBridge.js";
import { createSphChromeLoginHandler } from "./sphChromeLoginHandler.js";

export const runSphChromeLogin = createSphChromeLoginHandler({
  resolveChromePath,
  getProfileRoot: () => app.getPath("userData"),
  launchBrowser: options => puppeteer.launch(options),
  getTargetSession: partition => session.fromPartition(partition),
  probeImportedSession: probeSphSession,
  async getProxyOptions(options) {
    const phone = options.phone || options.partition.slice("persist:".length, -"视频号".length);
    const account = findAccountRecord(phone, "视频号");
    const proxy = pickActiveAccountProxy(account && account.proxy);
    const ses = session.fromPartition(options.partition);
    await applyAccountProxyToSession({
      electronSession: ses, partition: options.partition, phone, pt: "视频号",
    });
    if (!proxy) return {};
    const parsed = parseProxyUrl(proxy.url);
    if (!parsed.ok) return { error: "视频号代理配置无效，请检查账号的代理设置" };
    const value = parsed.value;
    // Chromium 认证代理硬伤（socks5 无凭据支持 / 407 挑战应答在 Electron 24
    // 里不触发 login 事件），带凭据的代理统一走本地桥（预发认证）
    if (
      value.hasAuth &&
      (value.scheme === "socks5" ||
        value.scheme === "socks" ||
        value.scheme === "http" ||
        value.scheme === "https")
    ) {
      try {
        const bridge = await getProxyBridge({
          scheme: value.scheme,
          host: value.host,
          port: value.port,
          username: value.username,
          password: value.password,
        });
        return { server: `http://127.0.0.1:${bridge.port}` };
      } catch (err) {
        return {
          error: `启动本地代理桥失败: ${(err && err.message) || err}`,
        };
      }
    }
    if (value.hasAuth && value.scheme === "socks4") {
      return {
        error: "socks4 代理不支持账号密码认证，请改用 socks5://用户名:密码@host:port，或去掉凭据",
      };
    }
    return {
      server: `${value.scheme === "socks" ? "socks5" : value.scheme}://${value.host}:${value.port}`,
      ...(value.hasAuth ? { authentication: { username: value.username, password: value.password } } : {}),
    };
  },
});

app.on("will-quit", () => { runSphChromeLogin.closeAll(); });
