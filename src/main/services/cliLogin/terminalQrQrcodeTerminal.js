"use strict";

const fs = require("fs");
const path = require("path");
const jsQR = require("jsqr");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode-terminal/vendor/QRCode");
const QRErrorCorrectLevel = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");
const { nativeImage } = require("electron");

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
  return new Promise((resolve) => {
    qrcodeTerminal.generate(payload, { small: !useAnsiCells }, (out) => {
      resolve(typeof out === "string" ? out : "");
    });
  });
}

/**
 * 将 QR payload 重绘为可扫描 PNG（与终端 jsQR + qrcode-terminal 思路一致，避免直接存整页/动效截图）。
 * @param {string} payload
 * @param {{ pixelPerModule?: number, margin?: number }} [opts]
 * @returns {Buffer}
 */
function renderQrPayloadToPngBuffer(payload, opts = {}) {
  const pixelPerModule = opts.pixelPerModule || 10;
  const margin = opts.margin || 4;
  const qrcode = new QRCode(-1, QRErrorCorrectLevel.L);
  qrcode.addData(payload);
  qrcode.make();

  const moduleCount = qrcode.getModuleCount();
  const size = (moduleCount + margin * 2) * pixelPerModule;
  const rowBytes = size * 4;
  const buf = Buffer.alloc(size * size * 4);
  const isBgr = process.platform === "win32";

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / pixelPerModule) - margin;
      const my = Math.floor(y / pixelPerModule) - margin;
      let isBlack = false;
      if (mx >= 0 && mx < moduleCount && my >= 0 && my < moduleCount) {
        isBlack = Boolean(qrcode.modules[my][mx]);
      }
      const v = isBlack ? 0 : 255;
      const idx = y * rowBytes + x * 4;
      if (isBgr) {
        buf[idx] = v;
        buf[idx + 1] = v;
        buf[idx + 2] = v;
        buf[idx + 3] = 255;
      } else {
        buf[idx] = v;
        buf[idx + 1] = v;
        buf[idx + 2] = v;
        buf[idx + 3] = 255;
      }
    }
  }

  const image = nativeImage.createFromBitmap(buf, {
    width: size,
    height: size,
  });
  return image.toPNG();
}

function shouldSkipQrDecode() {
  const v = process.env.MATRIX_CLI_QR_NO_DECODE;
  return (
    v !== undefined &&
    v !== null &&
    String(v).trim() !== "" &&
    String(v).trim() !== "0"
  );
}

/**
 * 写入 --save-qr-png：优先 jsQR 解码后重绘干净 PNG；其次 data: 原图；最后才用截图栅格。
 * @param {{ image: import("electron").NativeImage, saveQrPngPath: string, rawBuf?: Buffer | null, fromDataUrl?: boolean }} opts
 */
function writeLoginQrPngFile({
  image,
  saveQrPngPath,
  rawBuf = null,
  fromDataUrl = false,
}) {
  const out = path.resolve(saveQrPngPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const payload = shouldSkipQrDecode()
    ? null
    : tryDecodeQrPayloadFromNativeImage(image);
  let pngBuf;
  if (payload) {
    pngBuf = renderQrPayloadToPngBuffer(payload);
  } else if (fromDataUrl && rawBuf && rawBuf.length) {
    pngBuf = rawBuf;
  } else {
    pngBuf = image.toPNG();
  }

  fs.writeFileSync(out, pngBuf);
}

export {
  tryDecodeQrPayloadFromNativeImage,
  renderQrPayloadWithQrcodeTerminal,
  renderQrPayloadToPngBuffer,
  writeLoginQrPngFile,
};
