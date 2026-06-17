"use strict";

import { session } from "electron";
import { changeData } from "../server/utils.js";
import {
  parseProxyUrl,
  isAccountProxyEnabled,
} from "../../shared/accountProxy.js";

export { parseProxyUrl, isAccountProxyEnabled } from "../../shared/accountProxy.js";

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
  const partitionKey = String(partition || "").split("-")[0];
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
  await ses.setProxy({
    proxyRules: value.proxyRules,
    proxyBypassRules: "<local>",
  });

  if (value.hasAuth) {
    partitionProxyAuth.set(partitionKey, {
      username: value.username,
      password: value.password,
    });
  } else {
    partitionProxyAuth.delete(partitionKey);
  }

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
