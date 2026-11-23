"use strict";

import { resolvePublishPlatform } from "./publishPlatforms.js";

/** 与原有软件定时保持一致：输入使用操作系统本地时区。 */
export function parsePublishAt(value, nowMs = Date.now()) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return { ok: false, error: "定时发布时间格式应为 YYYY-MM-DD HH:mm:ss" };
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    date.getFullYear() !== year || date.getMonth() !== month - 1 ||
    date.getDate() !== day || date.getHours() !== hour ||
    date.getMinutes() !== minute || date.getSeconds() !== second
  ) return { ok: false, error: "定时发布时间不是有效日期" };
  if (date.getTime() <= nowMs) return { ok: false, error: "定时发布时间必须是未来时间" };
  return { ok: true, value: date.getTime(), text };
}

export function supportsNativeSchedule(platform) {
  return ["抖音", "视频号"].includes(resolvePublishPlatform(platform));
}

/** 所有入口共用路由；原生排期绝不登记成会到期执行的软件任务。 */
export function resolveVideoSchedule({
  platform, publishAt, preferNativeSchedule = false, draft = false,
}, nowMs = Date.now()) {
  if (!publishAt) {
    return preferNativeSchedule
      ? { ok: false, error: "优先原生定时需要同时指定发布时间" }
      : { ok: true, mode: "immediate", fields: {
          scheduleMode: "immediate", scheduledTask: false,
          nativeScheduleAt: null, nativeScheduleVerified: false,
          scheduledPublishAt: null, scheduledPublishAtText: "",
        } };
  }
  if (draft) return { ok: false, error: "发布到草稿不支持定时发布" };
  const parsed = parsePublishAt(publishAt, nowMs);
  if (!parsed.ok) return parsed;
  const native = preferNativeSchedule && supportsNativeSchedule(platform);
  // 原生排期按分钟提交，不悄悄截断调用方指定的秒数。
  if (native && new Date(parsed.value).getSeconds() !== 0) {
    return { ok: false, error: "原生定时精度为分钟，发布时间的秒数请设为 00" };
  }
  return {
    ok: true,
    mode: native ? "native" : "local",
    fields: {
      scheduleMode: native ? "native" : "local",
      scheduledTask: !native,
      scheduledPublishAt: parsed.value,
      scheduledPublishAtText: parsed.text,
      nativeScheduleAt: native ? parsed.value : null,
      nativeScheduleVerified: false,
    },
  };
}
