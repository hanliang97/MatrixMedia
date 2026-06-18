"use strict";

/**
 * 视频号登录页二维码区域定位脚本。
 * 视频号登录页 (channels.weixin.qq.com/platform) 通常在页面居中显示一个微信扫码二维码。
 * 优先找 .login__type__container_qrcode 或 img[class*='qrcode']，再回退通用候选。
 */
export const SPH_LOGIN_RECT_SCRIPT = `(function () {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  if (!vw || !vh) return null;

  function clampToViewport(r) {
    if (!r) return null;
    var x = Math.max(0, Math.floor(r.x));
    var y = Math.max(0, Math.floor(r.y));
    var x2 = Math.min(vw, Math.ceil(r.x + r.width));
    var y2 = Math.min(vh, Math.ceil(r.y + r.height));
    var w = x2 - x;
    var h = y2 - y;
    if (w < 32 || h < 32) return null;
    return { x: x, y: y, width: w, height: h };
  }

  function rectOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 48 || r.height < 48) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function padRect(r, px) {
    if (!r) return null;
    return {
      x: r.x - px,
      y: r.y - px,
      width: r.width + 2 * px,
      height: r.height + 2 * px,
    };
  }

  var padQr = 16;

  /* 视频号登录页常见选择器 */
  var selectors = [
    ".login__type__container_qrcode img",
    ".login__type__container_qrcode canvas",
    ".login__type__container_qrcode",
    ".qrcode img",
    ".qrcode canvas",
    ".qrcode",
    "img[class*='qrcode']",
    "img[class*='qr']",
    "canvas[class*='qrcode']",
    "canvas[class*='qr']",
  ];

  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el) {
      var r = rectOf(el);
      if (r) {
        var c = clampToViewport(padRect(r, padQr));
        if (c) return c;
      }
    }
  }

  /* wujie shadow DOM 内查找 */
  var wujie = document.querySelector("wujie-app");
  if (wujie && wujie.shadowRoot) {
    for (var j = 0; j < selectors.length; j++) {
      var el2 = wujie.shadowRoot.querySelector(selectors[j]);
      if (el2) {
        var r2 = rectOf(el2);
        if (r2) {
          var c2 = clampToViewport(padRect(r2, padQr));
          if (c2) return c2;
        }
      }
    }
  }

  /* 通用候选：找页面中合适尺寸的 canvas 或 img */
  var bestEl = null;
  var bestScore = 0;
  var candidates = document.querySelectorAll(
    "canvas, img, [class*='qr'], [class*='QR'], [class*='Qr'], [id*='qr'], [id*='QR']"
  );
  for (var k = 0; k < candidates.length; k++) {
    var cr = rectOf(candidates[k]);
    if (!cr) continue;
    if (cr.width > vw * 0.85 || cr.height > vh * 0.85) continue;
    var tag = (candidates[k].tagName || "").toLowerCase();
    var score = Math.min(cr.width, cr.height);
    if (tag === "canvas" || tag === "img") score += 40;
    if (score > bestScore && score < 520) {
      bestScore = score;
      bestEl = candidates[k];
    }
  }

  if (bestEl) {
    var br = rectOf(bestEl);
    if (br) {
      var cb = clampToViewport(padRect(br, padQr));
      if (cb) return cb;
    }
  }

  /* 最终兜底：页面居中区域 */
  var fw = Math.min(400, Math.floor(vw * 0.4));
  var fh = Math.min(400, Math.floor(vh * 0.5));
  var fx = Math.floor((vw - fw) / 2);
  var fy = Math.floor((vh - fh) / 2);
  return clampToViewport({ x: fx, y: fy, width: fw, height: fh });
})()`;
