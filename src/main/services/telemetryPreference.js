"use strict";

import fs from "fs";
import os from "os";
import path from "path";

export function getTelemetryPreference({
  configDir = path.join(os.homedir(), ".matrixmedia"),
  env = process.env,
} = {}) {
  const enforcedByEnvironment = Boolean(String(env.MATRIXMEDIA_DISABLE_TELEMETRY || "").trim());
  const disabledByFile = fs.existsSync(path.join(configDir, "no-telemetry"));
  return { enabled: !enforcedByEnvironment && !disabledByFile, enforcedByEnvironment };
}

/** GUI 与 CLI 共用原有 no-telemetry 文件，不创建第二份隐私设置。 */
export function setTelemetryEnabled(enabled, options = {}) {
  if (typeof enabled !== "boolean") throw new Error("统计开关必须是布尔值");
  const configDir = options.configDir || path.join(os.homedir(), ".matrixmedia");
  const preference = getTelemetryPreference({ ...options, configDir });
  if (enabled && preference.enforcedByEnvironment) {
    throw new Error("环境变量已禁用匿名统计，请先移除 MATRIXMEDIA_DISABLE_TELEMETRY");
  }
  const marker = path.join(configDir, "no-telemetry");
  if (enabled) {
    try {
      fs.unlinkSync(marker);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } else {
    fs.mkdirSync(configDir, { recursive: true });
    // 已存在时保留用户自己写入的内容。
    fs.closeSync(fs.openSync(marker, "a"));
  }
  return getTelemetryPreference({ ...options, configDir });
}
