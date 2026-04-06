"use strict";

/**
 * 终端黑白块渲染（无 Electron 依赖，便于单测）
 */

export function clearTerminalScreen() {
  if (!process.stdout.isTTY) {
    return;
  }
  process.stdout.write("\x1b[2J\x1b[H\x1b[0m");
}

/**
 * @param {{ getSize: () => { width: number; height: number }; toBitmap: () => Buffer }} image
 * @param {number} maxCols
 * @returns {string[]}
 */
export function nativeImageToBlockLines(image, maxCols) {
  const { width, height } = image.getSize();
  if (!width || !height) {
    return ["（截图尺寸无效）"];
  }

  const buf = image.toBitmap();
  const bpp = 4;
  const rowBytes = width * bpp;
  const isBgr = process.platform === "win32";

  function lumAt(sx, sy) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(sx)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(sy)));
    const i = y * rowBytes + x * bpp;
    if (i + 2 >= buf.length) {
      return 255;
    }
    let r;
    let g;
    let b;
    if (isBgr) {
      b = buf[i];
      g = buf[i + 1];
      r = buf[i + 2];
    } else {
      r = buf[i];
      g = buf[i + 1];
      b = buf[i + 2];
    }
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const cols = Math.max(12, Math.min(maxCols, width));
  // 终端等宽字高约为其半宽；按方形像素格算行数会把正方形二维码拉成「纵向过长」，这里按约 2:1 字格校正
  const cellHeightOverWidth = 2;
  const rows = Math.max(
    12,
    Math.round((cols * height) / (width * cellHeightOverWidth))
  );
  const THRESH = 145;
  const lines = [];

  for (let y = 0; y < rows; y++) {
    const sy = (y + 0.5) * (height / rows);
    let line = "";
    for (let x = 0; x < cols; x++) {
      const sx = (x + 0.5) * (width / cols);
      line += lumAt(sx, sy) < THRESH ? "\u2588" : " ";
    }
    lines.push(line.replace(/\s+$/g, ""));
  }

  return lines;
}

/**
 * 用 ▀ ▄ █ 与空格：每行字符对应图像上下两半采样，垂直细节约为 nativeImageToBlockLines 的两倍，行数不变，更适合高密度二维码。
 * @param {{ getSize: () => { width: number; height: number }; toBitmap: () => Buffer }} image
 * @param {number} maxCols
 * @returns {string[]}
 */
export function nativeImageToHalfBlockLines(image, maxCols) {
  const { width, height } = image.getSize();
  if (!width || !height) {
    return ["（截图尺寸无效）"];
  }

  const buf = image.toBitmap();
  const bpp = 4;
  const rowBytes = width * bpp;
  const isBgr = process.platform === "win32";

  function lumAt(sx, sy) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(sx)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(sy)));
    const i = y * rowBytes + x * bpp;
    if (i + 2 >= buf.length) {
      return 255;
    }
    let r;
    let g;
    let b;
    if (isBgr) {
      b = buf[i];
      g = buf[i + 1];
      r = buf[i + 2];
    } else {
      r = buf[i];
      g = buf[i + 1];
      b = buf[i + 2];
    }
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const cols = Math.max(12, Math.min(maxCols, width));
  const rows = Math.max(
    12,
    Math.round((cols * height) / (width * 2))
  );
  const THRESH = 145;
  const lines = [];

  for (let y = 0; y < rows; y++) {
    const yTop = (y + 0.25) * (height / rows);
    const yBot = (y + 0.75) * (height / rows);
    let line = "";
    for (let x = 0; x < cols; x++) {
      const sx = (x + 0.5) * (width / cols);
      const t = lumAt(sx, yTop) < THRESH;
      const b = lumAt(sx, yBot) < THRESH;
      if (t && b) {
        line += "\u2588";
      } else if (t && !b) {
        line += "\u2580";
      } else if (!t && b) {
        line += "\u2584";
      } else {
        line += " ";
      }
    }
    lines.push(line.replace(/\s+$/g, ""));
  }

  return lines;
}

/**
 * 终端二维码：默认半块字符（更细）；MATRIX_CLI_QR_TERM_BLOCKS=full 则仅用 █。
 */
export function nativeImageToTerminalQrLines(image, maxCols) {
  const m = process.env.MATRIX_CLI_QR_TERM_BLOCKS;
  if (m === "full") {
    return nativeImageToBlockLines(image, maxCols);
  }
  return nativeImageToHalfBlockLines(image, maxCols);
}
