import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

/**
 * 封面归一（cover compat）：源图尺寸/比例五花八门（用户随手截图、横图、webp），
 * 平台封面上传框对 3:4 竖图体验最好（抖音/快手/视频号的竖版封面槽位都是 3:4，
 * 视频号 file input 明确只收 jpeg/jpg/png）。这里用 Electron nativeImage 把任意
 * 源图统一成 1080×1440 JPEG：
 *   - 非 3:4 → 先按 3:4 居中裁切（只裁不拉伸，避免封面人物变形）
 *   - 再缩放到 1080×1440（quality best）
 *   - 输出 JPEG（视频号勿传 webp；jpg 体积小、三平台通吃）
 *
 * 原则：归一只是「锦上添花」，任何一步失败（非 Electron 环境跑测试、
 * nativeImage 解不了 webp/gif、写盘失败……）都回退原图继续走上传，
 * 绝不能因为归一失败把整个发布流程阻断。
 */

export const COVER_TARGET_WIDTH = 1080;
export const COVER_TARGET_HEIGHT = 1440;

/**
 * 3:4 居中裁切矩形计算（纯函数，便于单测）。
 * 同比例（含误差容限）返回 null 表示无需裁切；异常尺寸也返回 null。
 */
export function computeCenterCrop(
  srcW,
  srcH,
  targetW = COVER_TARGET_WIDTH,
  targetH = COVER_TARGET_HEIGHT
) {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH)) return null;
  if (srcW <= 0 || srcH <= 0) return null;
  const targetAspect = targetW / targetH;
  const srcAspect = srcW / srcH;
  if (Math.abs(srcAspect - targetAspect) < 1e-6) return null; // 同比：不裁
  let x = 0;
  let y = 0;
  let w;
  let h;
  if (srcAspect > targetAspect) {
    // 偏宽（含横图）：裁两侧，保留全高
    h = srcH;
    w = Math.round(srcH * targetAspect);
    x = Math.round((srcW - w) / 2);
  } else {
    // 偏高：裁上下，保留全宽
    w = srcW;
    h = Math.round(srcW / targetAspect);
    y = Math.round((srcH - h) / 2);
  }
  // 防御：数值异常时不越界（越界 crop 在 nativeImage 上产出空图）
  w = Math.min(w, srcW);
  h = Math.min(h, srcH);
  x = Math.max(0, Math.min(x, srcW - w));
  y = Math.max(0, Math.min(y, srcH - h));
  if (w <= 0 || h <= 0) return null;
  return { x, y, width: w, height: h };
}

function isJpeg(buf) {
  return (
    buf && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8
  );
}

function isPng(buf) {
  return (
    buf &&
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

/**
 * 惰性取 Electron nativeImage：
 * - 打包/运行于 Electron main 进程：require("electron") 返回 API 对象
 * - 纯 node（跑测试/CLI 直跑脚本）：require("electron") 返回二进制路径字符串
 *   或抛错 → 返回 null，上层回退原图
 * 不用顶层 import，保证本模块在纯 node 下可加载（测试直接 esbuild 打包）。
 */
let cachedNativeImage;
function loadNativeImage() {
  if (cachedNativeImage !== undefined) return cachedNativeImage;
  try {
    // eslint-disable-next-line global-require
    const electron = require("electron");
    cachedNativeImage =
      electron &&
      typeof electron === "object" &&
      electron.nativeImage &&
      typeof electron.nativeImage.createFromBuffer === "function"
        ? electron.nativeImage
        : null;
  } catch (_) {
    cachedNativeImage = null;
  }
  return cachedNativeImage;
}

/** 归一产物路径：按源路径+大小+mtime hash 命名，同一源图重试复用同一产物，tmpdir 不膨胀 */
function tempCoverPath(coverPath, stat) {
  const key = crypto
    .createHash("sha1")
    .update(`${coverPath}|${stat.size}|${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), `mm-cover-${key}.jpg`);
}

/**
 * 归一封面到 1080×1440（3:4 居中裁切不拉伸，JPEG 输出）。
 * 返回可用封面路径：归一成功 → tmpdir 内的 jpg；任何失败 → 原路径（回退）。
 * opts.nativeImage 供测试注入 fake 实现；缺省在 Electron main 下取真实实现。
 */
export async function normalizeCoverForUpload(coverPath, opts = {}) {
  const targetW = opts.width || COVER_TARGET_WIDTH;
  const targetH = opts.height || COVER_TARGET_HEIGHT;
  try {
    const stat = fs.statSync(coverPath);
    if (!stat.isFile()) return coverPath;

    const nativeImage = opts.nativeImage || loadNativeImage();
    if (!nativeImage) {
      console.warn(
        "[cover-compat] 无 nativeImage（非 Electron 环境），使用原封面:",
        coverPath
      );
      return coverPath;
    }

    const srcBuf = fs.readFileSync(coverPath);
    const img = nativeImage.createFromBuffer(srcBuf);
    if (!img || img.isEmpty()) {
      // webp/gif 等nativeImage 解不了的格式：回退原图（平台上传框自己处理）
      console.warn(
        "[cover-compat] nativeImage 无法解析封面格式，使用原封面:",
        coverPath
      );
      return coverPath;
    }
    const { width: srcW, height: srcH } = img.getSize();
    if (!srcW || !srcH) return coverPath;

    // 已是目标尺寸的 jpg/png：免重编码透传（保画质、省时间）
    if (srcW === targetW && srcH === targetH && (isJpeg(srcBuf) || isPng(srcBuf))) {
      return coverPath;
    }

    let work = img;
    const rect = computeCenterCrop(srcW, srcH, targetW, targetH);
    if (rect) work = img.crop(rect);
    const resized = work.resize({ width: targetW, height: targetH, quality: "best" });
    if (!resized || resized.isEmpty()) {
      console.warn("[cover-compat] 裁切/缩放失败，使用原封面:", coverPath);
      return coverPath;
    }
    const jpg = resized.toJPEG(92);
    if (!jpg || !jpg.length) {
      console.warn("[cover-compat] JPEG 编码失败，使用原封面:", coverPath);
      return coverPath;
    }

    const outPath = tempCoverPath(coverPath, stat);
    fs.writeFileSync(outPath, jpg);
    console.log(
      `[cover-compat] 封面已归一 ${srcW}×${srcH} → ${targetW}×${targetH} (jpg): ${outPath}`
    );
    return outPath;
  } catch (e) {
    console.warn(
      `[cover-compat] 封面归一失败，使用原封面: ${(e && e.message) || e}`
    );
    return coverPath;
  }
}
