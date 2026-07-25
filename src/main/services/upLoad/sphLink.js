"use strict";

import {
  VIDEO_LINK_TYPES,
  validateVideoLinkValue,
} from "../../../shared/videoLink.js";
import { attachSphVideoProduct } from "./sphProduct.js";

function linkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * 视频号链接统一入口。当前仅开放商品策略，其它类型保留在共享能力表中。
 */
export async function attachSphVideoLink(page, option = {}) {
  if (!option || option.enabled !== true) return null;
  const checked = validateVideoLinkValue("视频号", option.type, option.value);
  if (!checked.ok || !checked.value) {
    throw linkError(
      "invalid_video_link",
      checked.error || "请填写视频号链接内容"
    );
  }

  if (option.type === VIDEO_LINK_TYPES.PRODUCT) {
    const result = await attachSphVideoProduct(page, {
      enabled: true,
      productId: checked.value,
    });
    return {
      type: option.type,
      value: checked.value,
      label: result && result.productTitle,
      detail: result,
    };
  }

  throw linkError("unsupported_video_link", "当前视频号链接类型尚未开放");
}
