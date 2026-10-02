"use strict";

/**
 * 发布失败 / 发布异常时的页面截图。
 *
 * 目的：平台发布失败时用户只能看到一句「上传失败」，无法判断是登录过期、
 * 风控弹窗、还是元素改版。这里在失败瞬间把发布页截下来落盘，
 * 视频管理里点「失败 / 异常」次数即可回看当时的画面。
 *
 * 落盘位置与业务数据一致，放在「文档/MatrixMedia/fail-screenshots」下，
 * 卸载应用后仍可保留，方便用户附到问题反馈里。
 */

import fs from "fs";
import path from "path";

/** 截图保留天数，超期自动清理，避免长期发布把磁盘撑满 */
export const FAIL_SCREENSHOT_RETENTION_DAYS = 14;

/** 截图只用于诊断，不能让失败回执等待 CDP 默认的数分钟超时。 */
export const FAIL_SCREENSHOT_TIMEOUT_MS = 10000;

export async function withScreenshotTimeout(operation, timeoutMs = FAIL_SCREENSHOT_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("发布失败截图超时")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 单次清理最多删除的文件数，避免目录极大时阻塞发布流程 */
const PRUNE_LIMIT_PER_RUN = 200;

const DIR_NAME = "fail-screenshots";
const ROOT_NAME = "MatrixMedia";

/**
 * 截图根目录。与 server/utils.js 的数据目录同一个父级（文档/MatrixMedia）。
 * 非 Electron 环境（单测）回退到模块同级目录，便于直接跑 node 脚本。
 */
export function getFailScreenshotDir() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("documents"), ROOT_NAME, DIR_NAME);
    }
  } catch (_) {
    /* 非 Electron 主进程环境 */
  }
  return path.resolve(__dirname, DIR_NAME);
}

/** 文件名里不能出现的字符（Windows 最严格），中文保留 */
function sanitizeSegment(value, fallback) {
  const text = String(value == null ? "" : value)
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, "")
    .slice(0, 40)
    .trim();
  return text || fallback;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * 生成「平台-账号-时间.png」文件名，便于用户在文件夹里直接辨认。
 * @param {object} data 发布任务数据
 * @param {Date} [now]
 */
export function buildFailScreenshotName(data = {}, now = new Date()) {
  const pt = sanitizeSegment(data.pt, "未知平台");
  const phone = sanitizeSegment(
    String(data.phone || "").split("-")[0],
    "未知账号"
  );
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}` +
    `-${String(now.getMilliseconds()).padStart(3, "0")}`;
  return `${pt}-${phone}-${stamp}.png`;
}

/**
 * 清理过期截图。失败时静默忽略——清理不成功不应该影响发布回执。
 * @param {string} dir
 * @param {number} [retentionDays]
 * @param {number} [nowMs]
 * @returns {number} 实际删除的文件数
 */
export function pruneFailScreenshots(
  dir,
  retentionDays = FAIL_SCREENSHOT_RETENTION_DAYS,
  nowMs = Date.now()
) {
  let removed = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const deadline = nowMs - retentionDays * 24 * 60 * 60 * 1000;
    const names = fs.readdirSync(dir);
    for (const name of names) {
      if (removed >= PRUNE_LIMIT_PER_RUN) break;
      if (!name.toLowerCase().endsWith(".png")) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        if (stat.mtimeMs >= deadline) continue;
        fs.unlinkSync(full);
        removed++;
      } catch (_) {
        /* 单个文件删不掉就跳过 */
      }
    }
  } catch (e) {
    console.warn("[fail-shot] 清理过期截图失败:", (e && e.message) || e);
  }
  return removed;
}

/** 页面是否还能截图（窗口已关 / page 已销毁时直接放弃） */
function canScreenshot(page) {
  if (!page || typeof page.screenshot !== "function") return false;
  try {
    if (typeof page.isClosed === "function" && page.isClosed()) return false;
  } catch (_) {
    return false;
  }
  return true;
}

/**
 * 截取当前发布页并落盘。
 *
 * 任何异常都吞掉并返回空串：截图只是辅助定位，绝不能因为截图失败
 * 把一条本来能正常上报的失败回执打断。
 *
 * @param {import("puppeteer-core").Page} page
 * @param {object} data 发布任务数据（取 pt / phone 命名）
 * @param {object} [deps] 便于单测注入
 * @returns {Promise<string>} 截图绝对路径，失败返回 ""
 */
export async function capturePublishFailureScreenshot(page, data = {}, deps = {}) {
  const fileSystem = deps.fs || fs;
  const dir = deps.dir || getFailScreenshotDir();
  try {
    if (!canScreenshot(page)) return "";
    fileSystem.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, buildFailScreenshotName(data, deps.now));
    // fullPage 在长页面 / 懒加载站点上容易超时或产出巨图，这里只截可视区，
    // 弹窗、报错提示都在首屏，足够定位问题。
    const buffer = await withScreenshotTimeout(
      () => page.screenshot({ type: "png" }),
      deps.timeoutMs === undefined ? FAIL_SCREENSHOT_TIMEOUT_MS : deps.timeoutMs
    );
    if (!buffer || !buffer.length) return "";
    fileSystem.writeFileSync(file, buffer);
    console.log(`[fail-shot] 已保存发布失败截图: ${file}`);
    pruneFailScreenshots(dir, FAIL_SCREENSHOT_RETENTION_DAYS, Date.now());
    return file;
  } catch (e) {
    console.warn("[fail-shot] 保存发布失败截图失败:", (e && e.message) || e);
    return "";
  }
}

/**
 * 读取截图并转成 data URL，供渲染进程 <img> 直接显示。
 * 打包后页面是 file:// 协议，直接引用本地绝对路径在 Windows 上
 * 容易因盘符 / 中文路径转义出错，统一走 IPC 返回 base64 更稳。
 *
 * @param {string} filePath
 * @returns {{ ok: boolean, dataUrl?: string, message?: string }}
 */
export function readFailScreenshotDataUrl(filePath) {
  try {
    const target = String(filePath || "");
    if (!target) return { ok: false, message: "没有截图路径" };
    if (!fs.existsSync(target)) {
      return { ok: false, message: "截图文件不存在或已被清理" };
    }
    const buffer = fs.readFileSync(target);
    return {
      ok: true,
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    };
  } catch (e) {
    return { ok: false, message: (e && e.message) || "读取截图失败" };
  }
}
