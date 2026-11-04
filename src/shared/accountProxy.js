"use strict";

const SUPPORTED_SCHEMES = new Set([
  "http",
  "https",
  "socks4",
  "socks5",
  "socks",
]);

/** 报错信息里附上原始输入（截断），便于定位是哪一行配置写错了 */
function truncateForError(raw) {
  const text = String(raw || "").trim();
  if (!text) return "（空字符串）";
  // 凭据打码，避免密码整段出现在日志/提示里
  const masked = text.replace(
    /^(https?|socks[45]?):\/\/([^:@/\s]+):([^@/\s]+)@/,
    "$1://$2:***@"
  );
  return masked.length > 80 ? masked.slice(0, 80) + "…" : masked;
}

/**
 * 手动解析代理 URL。
 *
 * 为什么不用 new URL()：Chromium 的 WHATWG URL 对 `socks5:` 这类「非特殊
 * 协议」不做 authority 解析——`new URL('socks5://user:pass@host:port')` 的
 * hostname/username 全是空串，整段被当成 opaque path（Node 的 URL 实现则
 * 能正确解析）。渲染进程保存代理时走 Chromium，会导致误报「缺少 host」。
 * 这里按 RFC 3986 手写解析，所有环境行为一致。
 *
 * @param {string} rawUrl
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseProxyUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return { ok: false, error: "代理 URL 不能为空" };
  }

  // 悟空代理等隧道服务商复制出来的「host|端口|账号|密码」格式（如
  // 183.131.35.19|21203|f9hm4uc1|yk0yi9k），自动转换为 http 带认证代理 URL，
  // 用户直接整段粘贴即可保存
  const pipeMatch = trimmed.match(
    /^([a-zA-Z0-9.-]+)\|(\d{1,5})\|([^|\s]+)\|([^|\s]+)$/
  );
  const normalized = pipeMatch
    ? `http://${encodeURIComponent(pipeMatch[3])}:${encodeURIComponent(
        pipeMatch[4]
      )}@${pipeMatch[1]}:${pipeMatch[2]}`
    : trimmed;

  const schemeMatch = normalized.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "http";
  if (!SUPPORTED_SCHEMES.has(scheme)) {
    return { ok: false, error: `不支持的代理协议: ${scheme}` };
  }
  return parseAuthority(scheme, normalized, schemeMatch);
}

/**
 * 解析 scheme:// 之后的 authority 部分（[user[:pass]@]host[:port]）。
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function parseAuthority(scheme, original, schemeMatch) {
  // 去掉路径/查询/锚点（代理 URL 不含这些，容忍用户误粘贴）
  let rest = schemeMatch
    ? original.slice(schemeMatch[0].length)
    : original;
  const cutAt = (() => {
    const candidates = [rest.indexOf("/"), rest.indexOf("?"), rest.indexOf("#")].filter(
      (i) => i >= 0
    );
    return candidates.length ? Math.min(...candidates) : rest.length;
  })();
  rest = rest.slice(0, cutAt);

  let userinfo = "";
  const atIndex = rest.lastIndexOf("@");
  if (atIndex >= 0) {
    userinfo = rest.slice(0, atIndex);
    rest = rest.slice(atIndex + 1);
  }

  let username = "";
  let password = "";
  if (userinfo) {
    const colonIndex = userinfo.indexOf(":");
    if (colonIndex >= 0) {
      username = userinfo.slice(0, colonIndex);
      password = userinfo.slice(colonIndex + 1);
    } else {
      username = userinfo;
    }
    // 凭据里的百分号编码可能畸形（如 "user%"、"%FF"），decodeURIComponent 会抛
    // URIError，这里按函数约定转成 { ok: false, error }，不让异常扩散到保存链路
    try {
      username = decodeURIComponent(username);
      password = decodeURIComponent(password);
    } catch (_) {
      return {
        ok: false,
        error:
          "代理账号或密码包含无效的百分号编码（例如单独的 % 或 %GG），请检查后重新填写",
      };
    }
  }

  // host[:port]，IPv6 字面量 [::1]:443
  let host = "";
  let port = "";
  if (rest.startsWith("[")) {
    const closeIndex = rest.indexOf("]");
    if (closeIndex < 0) {
      return { ok: false, error: "代理 URL 的 IPv6 地址缺少右中括号" };
    }
    host = rest.slice(1, closeIndex);
    const after = rest.slice(closeIndex + 1);
    if (after.startsWith(":")) port = after.slice(1);
    else if (after) {
      return { ok: false, error: "代理 URL 格式无效（IPv6 地址后有多余内容）" };
    }
  } else {
    const colonIndex = rest.lastIndexOf(":");
    if (colonIndex >= 0) {
      host = rest.slice(0, colonIndex);
      port = rest.slice(colonIndex + 1);
    } else {
      host = rest;
    }
  }

  if (!host) {
    return {
      ok: false,
      error: `代理地址缺少 host，请检查是否漏填了地址（收到: ${truncateForError(original)}）`,
    };
  }
  if (port && !/^\d{1,5}$/.test(port)) {
    return { ok: false, error: `代理端口无效（收到: ${truncateForError(original)}）` };
  }

  const defaultPort =
    scheme === "https" ? "443" : scheme.startsWith("socks") ? "1080" : "80";
  const finalPort = port || defaultPort;

  let proxyRules;
  if (scheme === "socks4") {
    proxyRules = `socks4=${host}:${finalPort}`;
  } else if (scheme === "socks5" || scheme === "socks") {
    proxyRules = `socks5=${host}:${finalPort}`;
  } else {
    proxyRules = `http=${host}:${finalPort};https=${host}:${finalPort}`;
  }

  return {
    ok: true,
    value: {
      url: `${scheme}://${original.slice(
        (schemeMatch ? schemeMatch[0].length : 0)
      )}`.replace(/\/$/, ""),
      scheme,
      host,
      port: finalPort,
      username,
      password,
      proxyRules,
      hasAuth: Boolean(username || password),
      display: `${host}:${finalPort}`,
    },
  };
}

function normalizeProxyItem(item) {
  const enabled = Boolean(item && item.enabled);
  const url = String((item && item.url) || "").trim();
  if (!enabled) {
    return { ok: true, value: { enabled: false, url } };
  }
  if (!url) {
    return { ok: false, error: "启用代理时必须填写代理 URL" };
  }
  const parsed = parseProxyUrl(url);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      enabled: true,
      url: parsed.value.url,
    },
  };
}

/**
 * @param {{ enabled?: boolean, url?: string, proxies?: Array<{ enabled?: boolean, url?: string }> } | null | undefined} proxy
 * @returns {{ ok: true, value: { proxies: Array<{ enabled: boolean, url: string }> } } | { ok: false, error: string }}
 */
export function normalizeAccountProxy(proxy) {
  const source = Array.isArray(proxy && proxy.proxies)
    ? proxy.proxies
    : proxy && (proxy.enabled || proxy.url)
    ? [proxy]
    : [];
  const proxies = [];

  for (const item of source) {
    const normalized = normalizeProxyItem(item);
    if (!normalized.ok) return normalized;
    const value = normalized.value;
    if (value.enabled || value.url) proxies.push(value);
  }

  return { ok: true, value: { proxies } };
}

/**
 * @param {{ enabled?: boolean, url?: string, proxies?: Array<{ enabled?: boolean, url?: string }> } | null | undefined} proxy
 * @returns {boolean}
 */
export function isAccountProxyEnabled(proxy) {
  return getEnabledAccountProxies(proxy).length > 0;
}

/**
 * @param {{ enabled?: boolean, url?: string, proxies?: Array<{ enabled?: boolean, url?: string }> } | null | undefined} proxy
 * @returns {Array<{ enabled: boolean, url: string }>}
 */
export function getEnabledAccountProxies(proxy) {
  const normalized = normalizeAccountProxy(proxy);
  if (!normalized.ok) return [];
  return normalized.value.proxies.filter(
    (item) => item.enabled && String(item.url || "").trim()
  );
}

/**
 * @param {{ enabled?: boolean, url?: string, proxies?: Array<{ enabled?: boolean, url?: string }> } | null | undefined} proxy
 * @returns {string}
 */
export function getAccountProxyDisplay(proxy) {
  const enabledProxies = getEnabledAccountProxies(proxy);
  if (enabledProxies.length === 0) return "";
  const parsed = parseProxyUrl(enabledProxies[0].url);
  if (!parsed.ok) return "代理配置无效";
  return enabledProxies.length > 1
    ? `${parsed.value.display} 等 ${enabledProxies.length} 个`
    : parsed.value.display;
}

/**
 * @param {{ enabled?: boolean, url?: string, proxies?: Array<{ enabled?: boolean, url?: string }> } | null | undefined} proxy
 * @returns {{ enabled: true, url: string } | null}
 */
export function pickActiveAccountProxy(proxy) {
  const enabledProxies = getEnabledAccountProxies(proxy);
  if (enabledProxies.length === 0) return null;
  return enabledProxies[0];
}
