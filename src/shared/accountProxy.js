"use strict";

const SUPPORTED_SCHEMES = new Set(["http", "https", "socks4", "socks5", "socks"]);

/**
 * @param {string} rawUrl
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseProxyUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return { ok: false, error: "代理 URL 不能为空" };
  }

  let urlStr = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(urlStr)) {
    urlStr = `http://${urlStr}`;
  }

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch (_) {
    return { ok: false, error: "代理 URL 格式无效" };
  }

  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (!SUPPORTED_SCHEMES.has(scheme)) {
    return { ok: false, error: `不支持的代理协议: ${scheme}` };
  }

  const host = parsed.hostname;
  if (!host) {
    return { ok: false, error: "代理地址缺少 host" };
  }

  const defaultPort =
    scheme === "https" ? "443" : scheme.startsWith("socks") ? "1080" : "80";
  const port = parsed.port || defaultPort;
  const username = decodeURIComponent(parsed.username || "");
  const password = decodeURIComponent(parsed.password || "");

  let proxyRules;
  if (scheme === "socks4") {
    proxyRules = `socks4=${host}:${port}`;
  } else if (scheme === "socks5" || scheme === "socks") {
    proxyRules = `socks5=${host}:${port}`;
  } else {
    proxyRules = `http=${host}:${port};https=${host}:${port}`;
  }

  return {
    ok: true,
    value: {
      url: urlStr,
      scheme,
      host,
      port,
      username,
      password,
      proxyRules,
      hasAuth: Boolean(username || password),
      display: `${host}:${port}`,
    },
  };
}

/**
 * @param {{ enabled?: boolean, url?: string } | null | undefined} proxy
 * @returns {{ ok: true, value: { enabled: boolean, url: string } } | { ok: false, error: string }}
 */
export function normalizeAccountProxy(proxy) {
  const enabled = Boolean(proxy && proxy.enabled);
  const url = String((proxy && proxy.url) || "").trim();
  if (!enabled) {
    return { ok: true, value: { enabled: false, url: "" } };
  }
  if (!url) {
    return { ok: false, error: "启用代理时必须填写代理 URL" };
  }
  const parsed = parseProxyUrl(url);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    value: {
      enabled: true,
      url: parsed.value.url,
    },
  };
}

/**
 * @param {{ enabled?: boolean, url?: string } | null | undefined} proxy
 * @returns {boolean}
 */
export function isAccountProxyEnabled(proxy) {
  return Boolean(
    proxy &&
      proxy.enabled &&
      String(proxy.url || "").trim()
  );
}

/**
 * @param {{ enabled?: boolean, url?: string } | null | undefined} proxy
 * @returns {string}
 */
export function getAccountProxyDisplay(proxy) {
  if (!isAccountProxyEnabled(proxy)) return "";
  const parsed = parseProxyUrl(proxy.url);
  if (!parsed.ok) return "代理配置无效";
  return parsed.value.display;
}
