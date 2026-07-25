"use strict";

export const VIDEO_LINK_TYPES = {
  NONE: "none",
  OFFICIAL_ARTICLE: "official_article",
  RED_PACKET_COVER: "red_packet_cover",
  PRODUCT: "product",
  MINI_GAME: "mini_game",
  MINI_DRAMA: "mini_drama",
};

/**
 * 平台链接能力表。
 * platformAvailable 表示平台页面存在该能力；automationSupported 表示工具已完成并验证自动化。
 * 会员专区不进入工具能力表；小游戏与短剧仅预留结构，未验证前不向用户开放。
 */
const VIDEO_LINK_CAPABILITIES = {
  视频号: {
    platformKey: "sph",
    maxItems: 1,
    types: [
      {
        type: VIDEO_LINK_TYPES.NONE,
        label: "无",
        inputKind: "none",
        placeholder: "",
        maxLength: 0,
        platformAvailable: true,
        automationSupported: true,
        selectionMode: "none",
      },
      {
        type: VIDEO_LINK_TYPES.PRODUCT,
        label: "商品",
        inputKind: "entity_id",
        placeholder: "输入视频号商品 ID",
        maxLength: 32,
        platformAvailable: true,
        automationSupported: true,
        selectionMode: "product_id",
      },
      {
        type: VIDEO_LINK_TYPES.OFFICIAL_ARTICLE,
        label: "公众号文章",
        inputKind: "url",
        placeholder: "粘贴公众号文章链接",
        maxLength: 2048,
        platformAvailable: true,
        automationSupported: false,
      },
      {
        type: VIDEO_LINK_TYPES.RED_PACKET_COVER,
        label: "红包封面",
        inputKind: "url",
        placeholder: "粘贴红包封面链接",
        maxLength: 2048,
        platformAvailable: true,
        automationSupported: false,
      },
      {
        type: VIDEO_LINK_TYPES.MINI_GAME,
        label: "小游戏",
        inputKind: "entity_id",
        placeholder: "输入小游戏编号",
        maxLength: 64,
        platformAvailable: true,
        automationSupported: false,
      },
      {
        type: VIDEO_LINK_TYPES.MINI_DRAMA,
        label: "小程序短剧",
        inputKind: "entity_id",
        placeholder: "输入短剧编号",
        maxLength: 64,
        platformAvailable: true,
        automationSupported: false,
      },
    ],
  },
};

export function getVideoLinkCapability(platform) {
  const name = String(platform || "");
  const key = Object.keys(VIDEO_LINK_CAPABILITIES).find((fragment) =>
    name.includes(fragment)
  );
  return key ? VIDEO_LINK_CAPABILITIES[key] : null;
}

export function getVideoLinkTypeCapability(platform, type) {
  const capability = getVideoLinkCapability(platform);
  if (!capability) return null;
  return (
    capability.types.find((item) => item.type === String(type || "")) || null
  );
}

/** GUI 可展示的平台链接类型（含尚未开放自动化的占位项）。 */
export function getDisplayableVideoLinkTypes(platform) {
  const capability = getVideoLinkCapability(platform);
  if (!capability) return [];
  return capability.types.filter((item) => item.platformAvailable);
}

/** 已支持自动化的链接类型。 */
export function getSupportedVideoLinkTypes(platform) {
  return getDisplayableVideoLinkTypes(platform).filter(
    (item) => item.automationSupported
  );
}

export function platformSupportsVideoLink(platform) {
  return getDisplayableVideoLinkTypes(platform).some(
    (item) => item.type !== VIDEO_LINK_TYPES.NONE
  );
}

export function normalizeVideoLinkValue(value) {
  return String(value == null ? "" : value).trim();
}

export function validateVideoLinkValue(platform, type, value) {
  const normalized = normalizeVideoLinkValue(value);
  const resolvedType = String(type || VIDEO_LINK_TYPES.NONE);
  const typeCapability = getVideoLinkTypeCapability(platform, resolvedType);
  if (resolvedType === VIDEO_LINK_TYPES.NONE) return { ok: true, value: "" };
  if (!typeCapability) {
    return { ok: false, value: normalized, error: "当前链接类型尚未开放" };
  }
  if (!typeCapability.automationSupported) {
    return { ok: false, value: normalized, error: "当前链接类型尚未开放" };
  }
  if (!normalized) {
    return {
      ok: false,
      value: "",
      error:
        resolvedType === VIDEO_LINK_TYPES.PRODUCT
          ? "请选择或填写商品编号"
          : "请填写链接内容",
    };
  }
  if (resolvedType === VIDEO_LINK_TYPES.PRODUCT && !/^\d+$/.test(normalized)) {
    return { ok: false, value: normalized, error: "商品编码只能包含数字" };
  }
  return { ok: true, value: normalized };
}

export function buildVideoLinkOption(platform, type, value) {
  const supportedTypes = getSupportedVideoLinkTypes(platform);
  const resolvedType = String(type || (supportedTypes[0] || {}).type || "");
  const typeCapability = getVideoLinkTypeCapability(platform, resolvedType);
  const checked = validateVideoLinkValue(platform, resolvedType, value);
  if (!checked.ok) return checked;
  const enabled = Boolean(
    resolvedType !== VIDEO_LINK_TYPES.NONE &&
      checked.value &&
      typeCapability &&
      typeCapability.automationSupported
  );
  return {
    ok: true,
    value: {
      enabled,
      type: resolvedType,
      inputKind: (typeCapability && typeCapability.inputKind) || "text",
      value: enabled ? checked.value : "",
      selectionMode:
        (typeCapability && typeCapability.selectionMode) || "direct_input",
      failurePolicy: "save_draft",
    },
  };
}

/** 读取通用链接结构；未配置时使用“无”。 */
export function resolveVideoLinkOption(platform, publishOptions = {}) {
  const options = publishOptions || {};
  const link = options.link;
  if (link && typeof link === "object") {
    const resolvedType = String(link.type || VIDEO_LINK_TYPES.NONE);
    const typeCapability = getVideoLinkTypeCapability(platform, resolvedType);
    return {
      enabled: resolvedType !== VIDEO_LINK_TYPES.NONE && link.enabled === true,
      type: resolvedType,
      inputKind:
        link.inputKind ||
        (typeCapability && typeCapability.inputKind) ||
        "text",
      value: normalizeVideoLinkValue(link.value),
      selectionMode:
        link.selectionMode ||
        (typeCapability && typeCapability.selectionMode) ||
        "direct_input",
      failurePolicy: link.failurePolicy || "save_draft",
    };
  }
  return buildVideoLinkOption(platform, VIDEO_LINK_TYPES.NONE, "").value;
}
