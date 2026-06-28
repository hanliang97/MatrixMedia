"use strict";

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * 获取本机 Chrome / Chromium 浏览器的可执行路径。
 * 按优先级查找：Google Chrome → Chromium → Edge → Brave → Vivaldi → Opera
 *
 * @returns {string|null} Chrome 可执行文件路径，找不到返回 null
 */
export function findChromeExecutablePath() {
  const platform = process.platform;

  if (platform === "darwin") {
    // macOS 候选路径，按优先级排列
    const macCandidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
      "/Applications/Opera.app/Contents/MacOS/Opera",
      // 用户目录下的 Chrome
      path.join(
        process.env.HOME || "/Users",
        "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      ),
    ];
    for (const candidate of macCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (platform === "win32") {
    const winCandidates = [
      // Chrome
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(
        process.env.LOCALAPPDATA || "",
        "Google\\Chrome\\Application\\chrome.exe"
      ),
      // Edge
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      // Chromium
      path.join(
        process.env.LOCALAPPDATA || "",
        "Chromium\\Application\\chrome.exe"
      ),
    ];
    for (const candidate of winCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (platform === "linux") {
    const linuxCandidates = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/usr/bin/brave-browser",
    ];
    for (const candidate of linuxCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    // 用 which 查找
    for (const binary of [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
    ]) {
      try {
        const found = execSync(`which ${binary}`, { encoding: "utf8" }).trim();
        if (found && fs.existsSync(found)) {
          return found;
        }
      } catch (_) {
        // 未找到，继续
      }
    }
  }

  return null;
}
