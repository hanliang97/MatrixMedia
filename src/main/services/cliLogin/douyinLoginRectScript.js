"use strict";

/**
 * 抖音创作者登录页：优先 #animate_qrcode_container 内 base64 img；再白卡片上溯；最后通用候选或几何兜底。
 */
export const DOUYIN_LOGIN_RECT_SCRIPT = `(function () {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  if (!vw || !vh) return null;

  var rightX = Math.floor((vw * 2) / 3);
  var rightW = vw - rightX;

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

  function intersectRect(a, b) {
    var x1 = Math.max(a.x, b.x);
    var y1 = Math.max(a.y, b.y);
    var x2 = Math.min(a.x + a.width, b.x + b.width);
    var y2 = Math.min(a.y + a.height, b.y + b.height);
    var w = x2 - x1;
    var h = y2 - y1;
    if (w < 32 || h < 32) return null;
    return { x: Math.floor(x1), y: Math.floor(y1), width: Math.ceil(w), height: Math.ceil(h) };
  }

  function bgLuminance(node) {
    try {
      var bg = window.getComputedStyle(node).backgroundColor || "";
      var m = bg.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return -1;
      var p = m[1].split(",");
      var rr = parseFloat(p[0]);
      var gg = parseFloat(p[1]);
      var bb = parseFloat(p[2]);
      if (isNaN(rr)) return -1;
      return 0.299 * rr + 0.587 * gg + 0.114 * bb;
    } catch (e) {
      return -1;
    }
  }

  /**
   * 从二维码节点向上找「白色登录卡片」：包含二维码中心、浅色底、宽高像独立卡片而非整页。
   */
  function loginCardRectAroundQr(qrEl) {
    var qr = qrEl.getBoundingClientRect();
    var cx = qr.left + qr.width / 2;
    var cy = qr.top + qr.height / 2;
    var node = qrEl.parentElement;
    var best = null;
    var bestArea = 0;
    for (var d = 0; d < 16 && node && node !== document.documentElement; d++) {
      var r = node.getBoundingClientRect();
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) {
        node = node.parentElement;
        continue;
      }
      if (r.width < 240 || r.height < 360) {
        node = node.parentElement;
        continue;
      }
      if (r.width > vw * 0.5 || r.height > vh * 0.92) {
        node = node.parentElement;
        continue;
      }
      var lum = bgLuminance(node);
      if (lum >= 0 && lum < 245) {
        node = node.parentElement;
        continue;
      }
      var area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      node = node.parentElement;
    }
    return best;
  }

  function bandLoginCardFallback() {
    var x = Math.floor(vw * 0.67);
    var w = vw - x;
    var h = Math.min(Math.floor(vh * 0.72), 620);
    var y = Math.max(0, Math.floor(vh * 0.04));
    h = Math.min(h, vh - y);
    return { x: x, y: y, width: w, height: h };
  }

  function rectOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 72 || r.height < 72) return null;
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

  var padCard = 12;
  var padQr = 10;
  var padHost = 16;

  function animateHostFirstImg(host) {
    if (!host) return null;
    var img = host.querySelector("img");
    if (img) return img;
    var sr = host.shadowRoot;
    if (!sr) return null;
    img = sr.querySelector("img");
    if (img) return img;
    var list = sr.querySelectorAll("img");
    for (var j = 0; j < list.length; j++) {
      if (list[j].src) return list[j];
    }
    return null;
  }

  var qrHost = document.getElementById("animate_qrcode_container");
  if (qrHost) {
    var qrImg = animateHostFirstImg(qrHost);
    var seed = qrImg || qrHost;
    var card = loginCardRectAroundQr(seed);
    if (card) {
      var c = clampToViewport(padRect(card, padCard));
      if (c) return c;
    }
    var hostBox = qrHost.getBoundingClientRect();
    if (hostBox.width >= 32 && hostBox.height >= 32) {
      var h = clampToViewport(padRect(hostBox, padHost));
      if (h) return h;
    }
    if (qrImg) {
      var ir = rectOf(qrImg);
      if (ir) {
        var paddedImg = {
          x: Math.max(0, Math.floor(ir.x - padQr)),
          y: Math.max(0, Math.floor(ir.y - padQr)),
          width: Math.min(vw - Math.max(0, ir.x - padQr), Math.ceil(ir.width + padQr * 2)),
          height: Math.min(vh - Math.max(0, ir.y - padQr), Math.ceil(ir.height + padQr * 2)),
        };
        var rightFull = { x: rightX, y: 0, width: rightW, height: vh };
        var clipped = intersectRect(paddedImg, rightFull);
        if (clipped) return clipped;
        var ci = clampToViewport(paddedImg);
        if (ci) return ci;
      }
    }
  }

  var bestEl = null;
  var bestScore = 0;
  var candidates = document.querySelectorAll(
    "canvas, img, [class*='qr'], [class*='QR'], [class*='Qr'], [id*='qr'], [id*='QR']"
  );
  for (var i = 0; i < candidates.length; i++) {
    var r = rectOf(candidates[i]);
    if (!r) continue;
    if (r.width > vw * 0.85 || r.height > vh * 0.85) continue;
    if (r.x + r.width <= rightX) continue;
    var tag = (candidates[i].tagName || "").toLowerCase();
    var score = Math.min(r.width, r.height);
    if (tag === "canvas" || tag === "img") score += 40;
    if (score > bestScore && score < 520) {
      bestScore = score;
      bestEl = candidates[i];
    }
  }

  if (bestEl) {
    var card2 = loginCardRectAroundQr(bestEl);
    if (card2) {
      var c2 = clampToViewport(padRect(card2, padCard));
      if (c2) return c2;
    }
    var br = rectOf(bestEl);
    if (br) {
      var padded = {
        x: Math.max(0, Math.floor(br.x - padQr)),
        y: Math.max(0, Math.floor(br.y - padQr)),
        width: Math.min(vw - Math.max(0, br.x - padQr), Math.ceil(br.width + padQr * 2)),
        height: Math.min(vh - Math.max(0, br.y - padQr), Math.ceil(br.height + padQr * 2)),
      };
      var rightFull = { x: rightX, y: 0, width: rightW, height: vh };
      var clipped = intersectRect(padded, rightFull);
      if (clipped) return clipped;
    }
  }

  return clampToViewport(bandLoginCardFallback());
})()`;
