"use strict";

import {
  VIDEO_LINK_TYPES,
  validateVideoLinkValue,
} from "../../../shared/videoLink.js";
import { attachSphVideoProduct } from "./sphProduct.js";
import { attachSphVideoMiniDrama } from "./sphDrama.js";
import { attachSphVideoSeries } from "./sphSeries.js";

function linkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * 视频号链接统一入口。
 * 已开放：商品（sphProduct.js）、小程序短剧（sphDrama.js）、视频号剧集（sphSeries.js）；
 * 其它类型（公众号文章 / 红包封面 / 小游戏）仍保留在共享能力表中，未开放自动化。
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

  if (option.type === VIDEO_LINK_TYPES.MINI_DRAMA) {
    const result = await attachSphVideoMiniDrama(page, {
      enabled: true,
      dramaId: checked.value,
    });
    return {
      type: option.type,
      value: checked.value,
      label: result && result.dramaTitle,
      detail: result,
    };
  }

  if (option.type === VIDEO_LINK_TYPES.SPH_SERIES) {
    const result = await attachSphVideoSeries(page, {
      enabled: true,
      seriesId: checked.value,
    });
    return {
      type: option.type,
      value: checked.value,
      label: result && result.seriesTitle,
      detail: result,
    };
  }

  throw linkError("unsupported_video_link", "当前视频号链接类型尚未开放");
}
