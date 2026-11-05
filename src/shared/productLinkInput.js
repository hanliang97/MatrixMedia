"use strict";

export const DOUYIN_PRODUCT_URL_MAX_LENGTH = 2048;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ENCODED_CONTROL_CHARACTERS = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

function isLocalIpv4(parts) {
  const [first, second, third] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 168 || (second === 0 && third === 0))) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isLocalIpv6(hostname) {
  // URL 已校验 IPv6 语法，并把内嵌 IPv4 转成十六进制分组。
  const halves = hostname.slice(1, -1).split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    .map((word) => parseInt(word, 16));

  if (
    (words[0] & 0xfe00) === 0xfc00 || // 唯一本地地址
    (words[0] & 0xffc0) === 0xfe80 || // 链路本地地址
    (words[0] & 0xffc0) === 0xfec0 || // 已废弃的站点本地地址
    (words[0] & 0xff00) === 0xff00 // 组播地址
  ) return true;

  const zeroPrefix = words.slice(0, 5).every((word) => word === 0);
  const mapped = zeroPrefix && (words[5] === 0 || words[5] === 0xffff);
  const translated = words.slice(0, 4).every((word) => word === 0) &&
    words[4] === 0xffff && words[5] === 0;
  const nat64 = words[0] === 0x64 && words[1] === 0xff9b &&
    words.slice(2, 6).every((word) => word === 0);
  if (mapped || translated || nat64) {
    return isLocalIpv4([
      words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255,
    ]);
  }
  return false;
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) return isLocalIpv6(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return isLocalIpv4(host.split(".").map(Number));
  }
  return !host.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(host) ||
    /(?:^|\.)home\.arpa$/.test(host);
}

/**
 * 仅校验抖音商品链接输入；不确认商品归属、权限或平台支持情况。
 * 优先使用 HTTPS，但不擅自升级 HTTP 或改写商品编号、查询参数。
 * 不提取分享文案，不请求链接、不查 DNS、不跟随重定向；不能用作网络访问授权。
 * 快手商品输入的类型需按平台页面确认，不能复用本函数推定为 URL。
 */
export function validateDouyinProductUrl(input) {
  if (typeof input !== "string") {
    return { ok: false, value: "", error: "请填写完整的商品链接" };
  }
  const value = input.trim();
  const invalid = (error) => ({ ok: false, value, error });
  if (!value) return invalid("请填写商品链接");
  if (CONTROL_CHARACTERS.test(input) || ENCODED_CONTROL_CHARACTERS.test(value)) {
    return invalid("商品链接不能包含换行或控制字符");
  }
  if (value.length > DOUYIN_PRODUCT_URL_MAX_LENGTH) {
    return invalid(`商品链接不能超过 ${DOUYIN_PRODUCT_URL_MAX_LENGTH} 个字符`);
  }
  // 拒绝 URL 构造器会静默修复的缺失主机、反斜杠及夹带分享文案。
  const authority = value.match(/^https?:\/\/([^/?#]+)/i);
  if (!authority || /\s|\\/.test(value)) {
    return invalid("请填写完整的 HTTP 或 HTTPS 商品链接");
  }
  if (authority[1].includes("@")) return invalid("商品链接不能包含用户名或密码");

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    return invalid("商品链接格式不正确");
  }
  if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) {
    return invalid("请填写完整的 HTTP 或 HTTPS 商品链接");
  }
  if (parsed.username || parsed.password) return invalid("商品链接不能包含用户名或密码");
  if (isLocalHost(parsed.hostname)) return invalid("商品链接不能使用本地或内网地址");
  if (parsed.href.length > DOUYIN_PRODUCT_URL_MAX_LENGTH) {
    return invalid(`商品链接不能超过 ${DOUYIN_PRODUCT_URL_MAX_LENGTH} 个字符`);
  }
  return { ok: true, value: parsed.href };
}
