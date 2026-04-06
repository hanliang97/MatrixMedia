"use strict";

const jsQR = require("jsqr");
const qrcodeTerminal = require("qrcode-terminal");

/**
 * 从 NativeImage 位图解码 QR 内容（供 qrcode-terminal 按模块重绘，与 @tencent-weixin/openclaw-weixin 所用思路一致）。
 * @param {import("electron").NativeImage} image
 * @returns {string | null}
 */
function tryDecodeQrPayloadFromNativeImage(image) {
  try {
    const { width, height } = image.getSize();
    if (!width || !height || width < 32 || height < 32) {
      return null;
    }
    const buf = image.toBitmap();
    const bpp = 4;
    const rowBytes = width * bpp;
    const isBgr = process.platform === "win32";
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const si = y * rowBytes + x * bpp;
        const di = (y * width + x) * 4;
        let r;
        let g;
        let b;
        let a;
        if (isBgr) {
          b = buf[si];
          g = buf[si + 1];
          r = buf[si + 2];
          a = buf[si + 3];
        } else {
          r = buf[si];
          g = buf[si + 1];
          b = buf[si + 2];
          a = buf[si + 3];
        }
        data[di] = r;
        data[di + 1] = g;
        data[di + 2] = b;
        data[di + 3] = a !== undefined && a !== null ? a : 255;
      }
    }
    const code = jsQR(data, width, height, {
      inversionAttempts: "attemptBoth",
    });
    return code && code.data ? code.data : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} payload
 * @returns {Promise<string>}
 */
function renderQrPayloadWithQrcodeTerminal(payload) {
  if (!payload || typeof payload !== "string") {
    return Promise.resolve("");
  }
  const useAnsiCells = process.env.MATRIX_CLI_QR_TERMINAL_STYLE === "ansi";
  return new Promise(resolve => {
    qrcodeTerminal.generate(payload, { small: !useAnsiCells }, out => {
      resolve(typeof out === "string" ? out : "");
    });
  });
}

export { tryDecodeQrPayloadFromNativeImage, renderQrPayloadWithQrcodeTerminal };
