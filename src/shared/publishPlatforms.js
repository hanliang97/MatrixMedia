"use strict";

/** 平台别名 → 中文 canonical 名（与 GUI 账号树、partition 一致） */
export const PLATFORM_ALIASES = {
  dy: "抖音",
  douyin: "抖音",
  抖音: "抖音",
  sph: "视频号",
  视频号: "视频号",
  blbl: "哔哩哔哩",
  bilibili: "哔哩哔哩",
  哔哩哔哩: "哔哩哔哩",
  bjh: "百家号",
  百家号: "百家号",
  tt: "头条",
  toutiao: "头条",
  头条: "头条",
  ks: "快手",
  kuaishou: "快手",
  快手: "快手",
  xhs: "小红书",
  xiaohongshu: "小红书",
  小红书: "小红书",
  fqsp: "番茄视频",
  fanqie: "番茄视频",
  fq: "番茄视频",
  番茄视频: "番茄视频",
};

/** HTTP / CLI 视频发布支持的全部平台（canonical 中文名） */
export const VIDEO_PUBLISH_CANONICAL = [
  "抖音",
  "视频号",
  "哔哩哔哩",
  "百家号",
  "头条",
  "快手",
  "小红书",
  "番茄视频",
];

/** 文档用：每个平台的主推荐 code 与自动化说明 */
export const VIDEO_PUBLISH_PLATFORM_DOCS = [
  { code: "dy", name: "抖音", aliases: ["douyin", "抖音"], automated: true },
  { code: "sph", name: "视频号", aliases: ["视频号"], automated: true },
  { code: "blbl", name: "哔哩哔哩", aliases: ["bilibili", "哔哩哔哩"], automated: true },
  { code: "bjh", name: "百家号", aliases: ["百家号"], automated: true },
  { code: "tt", name: "头条", aliases: ["toutiao", "头条"], automated: true },
  { code: "ks", name: "快手", aliases: ["kuaishou", "快手"], automated: true },
  { code: "xhs", name: "小红书", aliases: ["xiaohongshu", "小红书"], automated: true },
  {
    code: "fqsp",
    name: "番茄视频",
    aliases: ["fanqie", "fq", "番茄视频"],
    automated: false,
    note: "配置已接入，自动发布流程待完善",
  },
];

/**
 * @param {string} raw platform 字段原始值
 * @returns {string} canonical 中文平台名
 */
export function resolvePublishPlatform(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  return PLATFORM_ALIASES[trimmed] || PLATFORM_ALIASES[lower] || trimmed;
}

/**
 * @param {string} canonical
 * @returns {boolean}
 */
export function isVideoPublishPlatform(canonical) {
  return VIDEO_PUBLISH_CANONICAL.includes(canonical);
}

/**
 * 供 HTTP GET /platforms 与文档生成
 * @param {Record<string, unknown>} [ptConfig]
 */
export function getVideoPublishPlatformList(ptConfig) {
  return VIDEO_PUBLISH_PLATFORM_DOCS.map((item) => ({
    code: item.code,
    name: item.name,
    aliases: item.aliases,
    automated: item.automated,
    note: item.note || null,
    hasConfig: ptConfig ? !!ptConfig[item.name] : null,
  }));
}
