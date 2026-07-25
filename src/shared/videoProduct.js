"use strict";

import {
  VIDEO_LINK_TYPES,
  buildVideoLinkOption,
  getVideoLinkTypeCapability,
  normalizeVideoLinkValue,
  validateVideoLinkValue,
} from "./videoLink.js";

export function getVideoProductCapability(platform) {
  const capability = getVideoLinkTypeCapability(
    platform,
    VIDEO_LINK_TYPES.PRODUCT
  );
  if (!capability) return null;
  return {
    implemented: capability.automationSupported,
    maxItems: 1,
    selectionMode: capability.selectionMode,
  };
}

export function platformSupportsVideoProduct(platform) {
  const capability = getVideoProductCapability(platform);
  return Boolean(capability && capability.implemented);
}

export function normalizeVideoProductId(value) {
  return normalizeVideoLinkValue(value);
}

export function validateVideoProductId(value) {
  const normalized = normalizeVideoProductId(value);
  // 空编号表示未配置商品；真正启用商品时由 validateVideoLinkValue 强制非空。
  if (!normalized) return { ok: true, productId: "" };
  const checked = validateVideoLinkValue(
    "视频号",
    VIDEO_LINK_TYPES.PRODUCT,
    normalized
  );
  return checked.ok
    ? { ok: true, productId: checked.value }
    : { ok: false, productId: checked.value, error: checked.error };
}

export function buildVideoProductOption(platform, value) {
  if (!platformSupportsVideoProduct(platform)) {
    return {
      ok: true,
      value: {
        enabled: false,
        type: "video_product",
        selectionMode: "product_id",
        productId: "",
        failurePolicy: "save_draft",
      },
    };
  }
  const link = buildVideoLinkOption(platform, VIDEO_LINK_TYPES.PRODUCT, value);
  if (!link.ok) {
    return {
      ok: false,
      productId: link.value,
      error: link.error,
    };
  }
  return {
    ok: true,
    value: {
      enabled: link.value.enabled,
      type: "video_product",
      selectionMode: "product_id",
      productId: link.value.value,
      failurePolicy: "save_draft",
    },
  };
}
