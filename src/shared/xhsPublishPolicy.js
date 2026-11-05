"use strict";

export const XHS_SECOND_CLICK_DELAY_MIN_MS = 5000;
export const XHS_SECOND_CLICK_DELAY_MAX_MS = 10000;
export const XHS_PLATFORM_STAGGER_MIN_MS = 15000;
export const XHS_PLATFORM_STAGGER_MAX_MS = 30000;

export function isXhsPlatform(pt) {
  return String(pt || "").includes("小红书");
}

export function applyXhsConservativePublishOptions(payload) {
  if (!isXhsPlatform(payload && payload.pt)) return payload;
  return {
    ...payload,
    show: true,
    closeWindowAfterPublish: false,
    xhsConservativeMode: true,
  };
}

export function getPublishAttemptLimit(data, defaultLimit = 5) {
  if (isXhsPlatform(data && data.pt)) return 1;
  const platform = String((data && data.pt) || "");
  const link = data && data.publishOptions && data.publishOptions.link;
  // 挂车失败需要用户核对商品/权限；重开窗口重传既不能修复输入，
  // 也无法排除前次点击已生效。仅限制抖快显式开启的商品任务。
  if (
    (platform.includes("抖音") || platform.includes("快手")) &&
    link &&
    link.enabled === true &&
    link.type === "product"
  ) {
    return 1;
  }
  return defaultLimit;
}

export function getRandomDelayMs(min, max, random = Math.random) {
  const safeMin = Number(min) || 0;
  const safeMax = Math.max(safeMin, Number(max) || safeMin);
  return Math.round(safeMin + (safeMax - safeMin) * random());
}

export function getXhsSecondClickDelayMs(random = Math.random) {
  return getRandomDelayMs(
    XHS_SECOND_CLICK_DELAY_MIN_MS,
    XHS_SECOND_CLICK_DELAY_MAX_MS,
    random
  );
}

export function getXhsPlatformStaggerDelayMs(random = Math.random) {
  return getRandomDelayMs(
    XHS_PLATFORM_STAGGER_MIN_MS,
    XHS_PLATFORM_STAGGER_MAX_MS,
    random
  );
}
