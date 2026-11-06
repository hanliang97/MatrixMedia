"use strict";

import fs from "fs";
import os from "os";
import path from "path";

function markerExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function getTelemetryPreference({
  configDir = path.join(os.homedir(), ".matrixmedia"),
  env = process.env,
} = {}) {
  const enforcedByEnvironment = Boolean(String(env.MATRIXMEDIA_DISABLE_TELEMETRY || "").trim());
  const disabledByFile = markerExists(path.join(configDir, "no-telemetry"));
  const enabledByFile = markerExists(path.join(configDir, "telemetry-enabled"));
  return { enabled: enabledByFile && !enforcedByEnvironment && !disabledByFile, enforcedByEnvironment };
}

/** 显式同意后才启用；环境禁用和原有 no-telemetry 标记始终优先。 */
export function setTelemetryEnabled(enabled, options = {}) {
  if (typeof enabled !== "boolean") throw new Error("统计开关必须是布尔值");
  const configDir = options.configDir || path.join(os.homedir(), ".matrixmedia");
  const preference = getTelemetryPreference({ ...options, configDir });
  if (enabled && preference.enforcedByEnvironment) {
    throw new Error("环境变量已禁用匿名统计，请先移除 MATRIXMEDIA_DISABLE_TELEMETRY");
  }
  const marker = path.join(configDir, "no-telemetry");
  const consent = path.join(configDir, "telemetry-enabled");
  fs.mkdirSync(configDir, { recursive: true });
  if (enabled) {
    fs.closeSync(fs.openSync(consent, "a", 0o600));
    try {
      fs.unlinkSync(marker);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } else {
    // 已存在时保留用户自己写入的内容。
    fs.closeSync(fs.openSync(marker, "a"));
    try {
      fs.unlinkSync(consent);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return getTelemetryPreference({ ...options, configDir });
}
