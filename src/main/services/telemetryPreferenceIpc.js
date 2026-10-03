"use strict";

import { getTelemetryPreference, setTelemetryEnabled } from "./telemetryPreference.js";

function isLocalSettingsSender(event) {
  try {
    const frame = new URL(String((event.senderFrame && event.senderFrame.url) || ""));
    return (frame.protocol === "file:" && !frame.hostname) ||
      (["http:", "https:"].includes(frame.protocol) &&
        ["localhost", "127.0.0.1"].includes(frame.hostname));
  } catch (_) {
    return false;
  }
}

export function registerTelemetryPreferenceIpc(ipcMain, {
  getPreference = getTelemetryPreference,
  setEnabled = setTelemetryEnabled,
} = {}) {
  ipcMain.handle("telemetry:get-preference", (event) => {
    if (!isLocalSettingsSender(event)) return { ok: false, message: "不允许外部页面读取设置" };
    try {
      return { ok: true, ...getPreference() };
    } catch (error) {
      return { ok: false, message: error.message || "读取隐私设置失败" };
    }
  });
  ipcMain.handle("telemetry:set-enabled", (event, enabled) => {
    if (!isLocalSettingsSender(event)) return { ok: false, message: "不允许外部页面修改设置" };
    try {
      return { ok: true, ...setEnabled(enabled) };
    } catch (error) {
      return { ok: false, message: error.message || "保存隐私设置失败" };
    }
  });
}
