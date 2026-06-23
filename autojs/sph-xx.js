/*
 * 视频号消息页自动点击“谢谢”
 *
 * 适用于微信节点被混淆、AutoJS 布局分析拿不到真实节点的情况。
 * 脚本通过 paddle.ocr 识别屏幕上的“谢谢”，再按文字边界框中心点击。
 *
 * 使用方式：
 * 1. 使用支持 paddle.ocr 的 AutoJS / AutoJs6，并确认 OCR 功能可用。
 * 2. 开启截图权限与无障碍权限。
 * 3. 手动进入视频号消息的“点赞 / 评论 / 关注”相关列表页。
 * 4. 运行本脚本，脚本会点击 OCR 识别到的“谢谢”，不会点击“已感谢”，并持续上滑处理更早消息。
 */

"auto";

var CONFIG = {
  thanksText: "谢谢",
  doneText: "已感谢",
  ocrRegion: [0, 0.12, 0.58, 0.82],
  minConfidence: 0,
  clickOffsetX: 0,
  clickOffsetY: 0,
  clickDelay: 900,
  afterSwipeDelay: 1500,
  swipeDuration: 520,
  maxEmptyScreens: 10,
};

var totalClicks = 0;
var emptyScreens = 0;
var clickedPoints = {};

stopSameSourceEngines();
init();
main();

function stopSameSourceEngines() {
  var currentEngine = engines.myEngine();
  var runningEngines = engines.all();
  var currentSource = currentEngine.getSource() + "";

  if (runningEngines.length <= 1) {
    return;
  }

  runningEngines.forEach(function (compareEngine) {
    var compareSource = compareEngine.getSource() + "";

    if (currentEngine.id !== compareEngine.id && compareSource === currentSource) {
      compareEngine.forceStop();
    }
  });
}

function init() {
  if (typeof paddle === "undefined" || !paddle.ocr) {
    toastLog("当前 AutoJS 不支持 paddle.ocr，请使用可运行 OCR截图识别.js 的环境");
    exit();
  }

  if (!requestScreenCapture()) {
    toastLog("截图权限申请失败，脚本结束");
    exit();
  }

  toastLog("请停留在视频号消息列表页，3 秒后开始 OCR 点击谢谢");
  sleep(3000);
}

function main() {
  while (true) {
    var clickedInScreen = clickVisibleThanksByOcr();

    if (clickedInScreen > 0) {
      totalClicks += clickedInScreen;
      emptyScreens = 0;
      toastLog("本屏感谢 " + clickedInScreen + " 个，累计 " + totalClicks + " 个");
      sleep(CONFIG.clickDelay);
      continue;
    }

    emptyScreens += 1;
    toastLog("OCR 未找到可点击谢谢，继续上滑：" + emptyScreens + "/" + CONFIG.maxEmptyScreens);

    if (emptyScreens >= CONFIG.maxEmptyScreens) {
      break;
    }

    clickedPoints = {};
    swipeUp();
    sleep(CONFIG.afterSwipeDelay);
  }

  toastLog("已结束，累计点击谢谢 " + totalClicks + " 个");
}

function clickVisibleThanksByOcr() {
  var img = captureScreen();
  var results = detectText(img);
  var candidates = collectThanksCandidates(results);
  var clicked = 0;

  candidates.sort(function (a, b) {
    return a.y - b.y;
  });

  for (var i = 0; i < candidates.length; i += 1) {
    var item = candidates[i];
    var key = makePointKey(item.x, item.y);

    if (clickedPoints[key]) {
      continue;
    }

    clickedPoints[key] = true;
    click(item.x, item.y);
    clicked += 1;
    sleep(CONFIG.clickDelay);
  }

  if (img && img.recycle) {
    img.recycle();
  }

  return clicked;
}

function detectText(img) {
  try {
    return paddle.ocr(img) || [];
  } catch (error) {
    toastLog("OCR 识别失败：" + error);
    return [];
  }
}

function collectThanksCandidates(results) {
  var candidates = [];
  var region = getRegionPixels(CONFIG.ocrRegion);

  for (var i = 0; i < results.length; i += 1) {
    var result = results[i];
    var label = getOcrText(result);
    var bounds = getOcrBounds(result);

    if (!label || !bounds || !isThanksLabel(label) || isLowConfidence(result)) {
      continue;
    }

    bounds = normalizeBoundsCenter(bounds, region);

    if (!isPointInRegion(bounds.centerX, bounds.centerY, region)) {
      continue;
    }

    var point = getThanksClickPoint(label, bounds);

    candidates.push({
      text: label,
      x: Math.floor(point.x + CONFIG.clickOffsetX),
      y: Math.floor(point.y + CONFIG.clickOffsetY),
    });
  }

  return candidates;
}

function getThanksClickPoint(label, bounds) {
  var textValue = String(label).replace(/\s/g, "");
  var index = textValue.indexOf(CONFIG.thanksText);

  if (index < 0 || typeof bounds.left !== "number" || typeof bounds.right !== "number") {
    return {
      x: bounds.centerX,
      y: bounds.centerY,
    };
  }

  var charWidth = (bounds.right - bounds.left) / Math.max(textValue.length, 1);
  var thanksCenterIndex = index + CONFIG.thanksText.length / 2;

  return {
    x: bounds.left + charWidth * thanksCenterIndex,
    y: bounds.centerY,
  };
}

function getRegionPixels(region) {
  var x = toPixel(region[0], device.width);
  var y = toPixel(region[1], device.height);
  var width = toPixel(region[2], device.width);
  var height = toPixel(region[3], device.height);

  if (width < 0) {
    width = device.width - x;
  }

  if (height < 0) {
    height = device.height - y;
  }

  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

function toPixel(value, base) {
  if (value > 0 && value < 1) {
    return Math.floor(value * base);
  }

  return Math.floor(value);
}

function normalizeBoundsCenter(bounds, region) {
  var centerX = bounds.centerX;
  var centerY = bounds.centerY;
  var offsetX = 0;
  var offsetY = 0;

  if (centerX < region.left || centerY < region.top) {
    offsetX = region.left;
    offsetY = region.top;
    centerX += offsetX;
    centerY += offsetY;
  }

  return {
    centerX: centerX,
    centerY: centerY,
    left: typeof bounds.left === "number" ? bounds.left + offsetX : null,
    top: typeof bounds.top === "number" ? bounds.top + offsetY : null,
    right: typeof bounds.right === "number" ? bounds.right + offsetX : null,
    bottom: typeof bounds.bottom === "number" ? bounds.bottom + offsetY : null,
  };
}

function isPointInRegion(x, y, region) {
  return x >= region.left &&
    x <= region.right &&
    y >= region.top &&
    y <= region.bottom;
}

function isThanksLabel(label) {
  var textValue = String(label).replace(/\s/g, "");

  return textValue.indexOf(CONFIG.thanksText) >= 0 &&
    textValue.indexOf(CONFIG.doneText) < 0;
}

function isLowConfidence(result) {
  var confidence = result.confidence || result.conf || result.score;

  if (typeof confidence !== "number") {
    return false;
  }

  return confidence < CONFIG.minConfidence;
}

function getOcrText(result) {
  return result.text || result.label || result.words || result.value || "";
}

function getOcrBounds(result) {
  var bounds = result.bounds || result.region || result.rect || result.frame;

  if (!bounds) {
    return null;
  }

  if (typeof bounds.left === "number" && typeof bounds.right === "number") {
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      centerX: (bounds.left + bounds.right) / 2,
      centerY: (bounds.top + bounds.bottom) / 2,
    };
  }

  if (typeof bounds.centerX === "function" && typeof bounds.centerY === "function") {
    return {
      left: typeof bounds.left === "number" ? bounds.left : null,
      top: typeof bounds.top === "number" ? bounds.top : null,
      right: typeof bounds.right === "number" ? bounds.right : null,
      bottom: typeof bounds.bottom === "number" ? bounds.bottom : null,
      centerX: bounds.centerX(),
      centerY: bounds.centerY(),
    };
  }

  if (typeof bounds.centerX === "number" && typeof bounds.centerY === "number") {
    return {
      left: typeof bounds.left === "number" ? bounds.left : null,
      top: typeof bounds.top === "number" ? bounds.top : null,
      right: typeof bounds.right === "number" ? bounds.right : null,
      bottom: typeof bounds.bottom === "number" ? bounds.bottom : null,
      centerX: bounds.centerX,
      centerY: bounds.centerY,
    };
  }

  if (typeof bounds.x === "number" && typeof bounds.width === "number") {
    return {
      left: bounds.x,
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height / 2,
    };
  }

  return null;
}

function makePointKey(x, y) {
  var gridX = Math.floor(x / 12);
  var gridY = Math.floor(y / 12);

  return gridX + "," + gridY;
}

function swipeUp() {
  var x = Math.floor(device.width / 2);
  var startY = Math.floor(device.height * 0.78);
  var endY = Math.floor(device.height * 0.32);

  swipe(x, startY, x, endY, CONFIG.swipeDuration);
}
