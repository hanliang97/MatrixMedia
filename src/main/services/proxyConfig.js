"use strict";

import { session } from "electron";
import { changeData } from "../server/utils.js";
import {
  parseProxyUrl,
  isAccountProxyEnabled,
  pickActiveAccountProxy,
} from "../../shared/accountProxy.js";
import { getProxyBridge } from "./socksBridge.js";

export {
  parseProxyUrl,
  isAccountProxyEnabled,
  pickActiveAccountProxy,
} from "../../shared/accountProxy.js";

/** @type {Map<string, { username: string, password: string }>} */
const partitionProxyAuth = new Map();
/** @type {WeakSet<Electron.Session>} */
const sessionsWithLoginHandler = new WeakSet();

function normalizePhone(phone) {
  return String(phone || "").split("-")[0];
}

/**
 * 从 account 数据源查找账号记录
 * @param {string} phone
 * @param {string} pt
 * @returns {object | null}
 */
export function findAccountRecord(phone, pt) {
  const phoneSeg = normalizePhone(phone);
  const platform = String(pt || "").trim();
  if (!phoneSeg || !platform) return null;

  const result = changeData({
    fileName: "account",
    type: "get",
    item: { page: 1, pageSize: 9999 },
  });
  const grouped = (result && result.data) || {};

  for (const dateKey of Object.keys(grouped)) {
    const rows = grouped[dateKey] || [];
    for (const item of rows) {
      if (
        String(item.pt || "").trim() === platform &&
        normalizePhone(item.phone) === phoneSeg
      ) {
        return item;
      }
    }
  }
  return null;
}

/**
 * @param {Electron.Session} ses
 * @param {string} partition
 */
function ensureProxyLoginHandler(ses, partition) {
  if (sessionsWithLoginHandler.has(ses)) return;
  sessionsWithLoginHandler.add(ses);
  ses.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo || !authInfo.isProxy) return;
    const creds = partitionProxyAuth.get(partition);
    if (!creds) return;
    event.preventDefault();
    callback(creds.username, creds.password);
  });
}

/**
 * @param {object} options
 * @param {Electron.Session} [options.electronSession]
 * @param {string} options.partition
 * @param {string} [options.phone]
 * @param {string} [options.pt]
 * @param {{ enabled?: boolean, url?: string }} [options.proxyOverride]
 * @returns {Promise<{ applied: boolean, mode: string, display?: string, error?: string }>}
 */
export async function applyAccountProxyToSession({
  electronSession,
  partition,
  phone,
  pt,
  proxyOverride,
}) {
  // partition 用完整值：标准 partition（persist:<账号"-"前缀><平台>）本身不含 "-"，
  // 历史上这里再 split("-")[0] 会把非常规 partition 截到错误的 session 上，
  // 代理配置与登录/发布落在两个会话
  const partitionKey = String(partition || "");
  if (!partitionKey) {
    return { applied: false, mode: "direct", error: "partition 无效" };
  }

  const ses = electronSession || session.fromPartition(partitionKey);
  ensureProxyLoginHandler(ses, partitionKey);

  let proxy = proxyOverride;
  if (proxy === undefined) {
    const account = findAccountRecord(phone, pt);
    proxy = account && account.proxy;
  }
  proxy = pickActiveAccountProxy(proxy);

  if (!isAccountProxyEnabled(proxy)) {
    partitionProxyAuth.delete(partitionKey);
    await ses.setProxy({ mode: "direct" });
    return { applied: false, mode: "direct" };
  }

  const parsed = parseProxyUrl(proxy.url);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  const { value } = parsed;
  let proxyRules = value.proxyRules;

  // Chromium 认证代理的两类硬伤，统一改走本地代理桥（无认证本地 HTTP 代理，
  // 桥负责对上游预发认证，与 curl 行为一致）：
  //  1. socks5= 规则在协议层面不支持账号密码认证；
  //  2. HTTP 代理走「407 挑战应答」，实测 Electron 24 中 session 级 login 事件
  //     对代理认证不触发，主进程 net 模块（SimpleURLLoader）更是完全不触发，
  //     407 无人应答 → net::ERR_TUNNEL_CONNECTION_FAILED → 页面白屏/请求全挂。
  // Electron → 127.0.0.1:<桥端口> → 认证上游代理 → 目标站点
  if (value.hasAuth && (value.scheme === "socks5" || value.scheme === "socks" ||
      value.scheme === "http" || value.scheme === "https")) {
    try {
      const bridge = await getProxyBridge({
        scheme: value.scheme,
        host: value.host,
        port: value.port,
        username: value.username,
        password: value.password,
      });
      proxyRules = `http=127.0.0.1:${bridge.port};https=127.0.0.1:${bridge.port}`;
      console.log(
        `[proxy] partition=${partitionKey} 认证代理改走本地桥 127.0.0.1:${bridge.port}（上游 ${value.display}）`
      );
    } catch (err) {
      throw new Error(`启动本地代理桥失败: ${err && err.message}`);
    }
    partitionProxyAuth.delete(partitionKey);
  } else if (value.hasAuth && value.scheme === "socks4") {
    throw new Error(
      "socks4 代理不支持账号密码认证，请改用 socks5://用户名:密码@host:port，或去掉凭据"
    );
  } else if (value.hasAuth) {
    partitionProxyAuth.set(partitionKey, {
      username: value.username,
      password: value.password,
    });
  } else {
    partitionProxyAuth.delete(partitionKey);
  }

  await ses.setProxy({
    proxyRules,
    // localhost.weixin.qq.com 解析到 127.0.0.1，是网页视频号与本机微信客户端
    // 的本地通信端口（130xx/140xx），走代理必然失败且无意义，必须直连
    proxyBypassRules: "<local>,localhost.weixin.qq.com,*.localhost.weixin.qq.com",
  });

  console.log(
    `[proxy] partition=${partitionKey} 已应用代理 ${value.display}${
      value.hasAuth ? "（含认证）" : ""
    }`
  );

  return {
    applied: true,
    mode: "proxy",
    display: value.display,
  };
}

/**
 * @param {object} options
 * @param {string} options.partition
 * @param {string} [options.phone]
 * @param {string} [options.pt]
 * @returns {Promise<{ applied: boolean, mode: string, display?: string }>}
 */
export async function applyAccountProxyForTask(options) {
  return applyAccountProxyToSession(options);
}
