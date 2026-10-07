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
    if (value.hasAuth && value.scheme.startsWith("socks")) {
      return { error: "系统 Chrome 登录不支持带用户名/密码的 SOCKS 代理，请改用 HTTP 代理" };
    }
    return {
      server: `${value.scheme === "socks" ? "socks5" : value.scheme}://${value.host}:${value.port}`,
      ...(value.hasAuth ? { authentication: { username: value.username, password: value.password } } : {}),
    };
  },
});

app.on("will-quit", () => { runSphChromeLogin.closeAll(); });
