"use strict";

import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { findChromeExecutablePath } from "./upLoad/findChrome.js";

/**
 * 全局 Chrome 浏览器路径配置。
 * 配置文件保存在 userData 目录下（如 ~/Library/Application Support/MatrixMedia/chrome-config.json）。
 * 不依赖 electron-store 等第三方库。
 */

function getConfigPath() {
  return path.join(app.getPath("userData"), "chrome-config.json");
}

function readConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function writeConfig(config) {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

/**
 * 获取用户配置的 Chrome 可执行路径。
 * 优先返回用户手动配置的路径，没有则返回空字符串。
 */
export function getConfiguredChromePath() {
  const config = readConfig();
  return config.chromePath || "";
}

/**
 * 保存用户配置的 Chrome 可执行路径。
 */
export function setConfiguredChromePath(chromePath) {
  const config = readConfig();
  config.chromePath = String(chromePath || "").trim();
  writeConfig(config);
}

/**
 * 获取生效的 Chrome 路径：优先用户配置 → 自动检测 → null。
 */
export function resolveChromePath() {
  const configured = getConfiguredChromePath();
  if (configured && fs.existsSync(configured)) {
    return configured;
  }
  return findChromeExecutablePath();
}

/**
 * 自动检测本机 Chrome 路径。
 */
export function autoDetectChromePath() {
  return findChromeExecutablePath();
}

/**
 * macOS: 将 .app 包路径解析为内部可执行文件路径。
 * 例如 "/Applications/Google Chrome.app" → "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
 *
 * 支持常见的 Chromium 内核浏览器 .app 包。
 * @param {string} appPath - .app 包的完整路径
 * @returns {string|null} 可执行文件路径，找不到返回 null
 */
export function resolveAppBundleExecutable(appPath) {
  if (!appPath || !appPath.endsWith(".app")) return null;
  const macosDir = path.join(appPath, "Contents", "MacOS");
  if (!fs.existsSync(macosDir)) return null;

  // 常见浏览器的可执行文件名映射（.app 名称 → 可执行文件名）
  const appName = path.basename(appPath, ".app");
  const knownExecutables = {
    "Google Chrome": "Google Chrome",
    "Google Chrome Canary": "Google Chrome Canary",
    "Chromium": "Chromium",
    "Microsoft Edge": "Microsoft Edge",
    "Brave Browser": "Brave Browser",
    "Vivaldi": "Vivaldi",
    "Opera": "Opera",
    "Arc": "Arc",
  };

  // 1. 先按已知名称匹配
  if (knownExecutables[appName]) {
    const execPath = path.join(macosDir, knownExecutables[appName]);
    if (fs.existsSync(execPath)) return execPath;
  }

  // 2. 兜底：尝试与 .app 同名的可执行文件
  const sameName = path.join(macosDir, appName);
  if (fs.existsSync(sameName)) return sameName;

  // 3. 最后兜底：MacOS 目录下第一个可执行文件
  try {
    const files = fs.readdirSync(macosDir);
    for (const f of files) {
      const full = path.join(macosDir, f);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch (_) {}
    }
  } catch (_) {}

  return null;
}

/**
 * 将路径转换为用户友好的显示名称。
 * macOS: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" → "Google Chrome"
 * Windows: "C:\\...\\chrome.exe" → "chrome.exe"
 */
export function getChromeDisplayName(chromePath) {
  if (!chromePath) return "";
  // macOS .app 包内的路径
  const appMatch = chromePath.match(/\/([^/]+)\.app\/Contents\/MacOS\//);
  if (appMatch) return appMatch[1];
  // 其他：取文件名
  return path.basename(chromePath);
}

/**
 * 测试 Chrome 路径是否可用：尝试启动一个 headless 实例然后立即关闭。
 * @param {string} chromePath
 * @returns {Promise<{ok: boolean, version?: string, error?: string}>}
 */
export async function testChromePath(chromePath) {
  if (!chromePath || !fs.existsSync(chromePath)) {
    return { ok: false, error: "文件不存在: " + chromePath };
  }

  let browser = null;
  // 使用临时 userDataDir，避免与用户已打开的 Chrome 实例冲突
  // （Chrome 单实例模型会锁定默认 profile，导致新进程无法输出 WS endpoint）
  const tmpDir = path.join(
    os.tmpdir(),
    `mm-chrome-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  try {
    // 动态 import，避免循环依赖
    const puppeteerCore = (await import("puppeteer-core")).default;
    const { addExtra } = await import("puppeteer-extra");
    const puppeteer = addExtra(puppeteerCore);

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      userDataDir: tmpDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
      ],
      timeout: 30000,
    });
    const version = await browser.version();
    await browser.close();
    browser = null;
    return { ok: true, version };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    // 清理临时目录
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}
