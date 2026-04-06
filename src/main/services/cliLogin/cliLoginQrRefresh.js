"use strict";

/** 终端 / save-qr-png 二维码刷新间隔（毫秒） */
export const CLI_LOGIN_QR_REFRESH_MS = 10000;

/** 首次绘制延迟，避免刚进页空白过久 */
export const CLI_LOGIN_QR_FIRST_DELAY_MS = 5000;

/**
 * 终端 █ 图列数：高密度二维码列数过少会合并模块导致无法识别，默认按图片宽度保留细节（约每 2.2px 一列），上限为终端可用宽。
 * 需要刻意缩小可设 MATRIX_CLI_QR_TERM_COLS（24～260）。
 * @param {number} [imagePixelWidth] 当前要绘制的图片宽度（像素）
 * @returns {number}
 */
export function cliLoginQrTerminalBlockWidth(imagePixelWidth) {
  const tty = process.stdout.columns || 80;
  const usable = Math.max(40, tty - 4);

  const env = process.env.MATRIX_CLI_QR_TERM_COLS;
  if (env !== undefined && env !== null && String(env).trim() !== "") {
    const n = parseInt(String(env).trim(), 10);
    if (Number.isFinite(n) && n >= 24 && n <= 260) {
      return Math.min(usable, n);
    }
  }

  const w =
    typeof imagePixelWidth === "number" && imagePixelWidth > 0 ? imagePixelWidth : usable;
  const detailCols = Math.ceil(w / 1.85);
  return Math.min(usable, Math.max(72, detailCols));
}
