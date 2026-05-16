function shouldSaveToutiaoDraft({ requestedDraft, hasTagSelector }) {
  return Boolean(requestedDraft && hasTagSelector);
}

function getToutiaoCoverMode({ hasTagSelector }) {
  return hasTagSelector ? "horizontal" : "vertical";
}

function getToutiaoCoverItemSelector() {
  return "body .Dialog-container .m-server-bg-list .m-system-i";
}

function getToutiaoCoverTriggerSelector() {
  // 新版页面横屏挂在 .video-form-item-control，竖屏挂在 .xigua-poster-editor.portrait；
  // 保留老版 .video-form-basic .form-item-poster 兜底。
  return [
    ".video-form-item-control .fake-upload-trigger",
    ".xigua-poster-editor.portrait .fake-upload-trigger",
    ".video-form-basic .form-item-poster .fake-upload-trigger",
    ".xigua-poster-editor .fake-upload-trigger",
  ].join(", ");
}

function getToutiaoPosterDialogSelector() {
  return "body .Dialog-container .m-poster-upgrade";
}

function shouldClickToutiaoCoverClip({ hasTagSelector }) {
  return Boolean(hasTagSelector);
}

function isToutiaoProgressComplete(progress = {}) {
  const values = [
    progress.style,
    progress.width,
    progress.ariaValueNow,
    progress.textContent,
  ]
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value).replace(/\s+/g, "").toLowerCase());

  return values.some(value =>
    value === "100" ||
    value === "100%" ||
    value.includes("width:100%") ||
    value.includes("width:100.0%")
  );
}

function shouldRetryToutiaoProgressMissing({ missingCount, maxMissingCount = 10 }) {
  return Number(missingCount) >= maxMissingCount;
}

module.exports = {
  getToutiaoCoverItemSelector,
  getToutiaoCoverMode,
  getToutiaoCoverTriggerSelector,
  getToutiaoPosterDialogSelector,
  isToutiaoProgressComplete,
  shouldRetryToutiaoProgressMissing,
  shouldClickToutiaoCoverClip,
  shouldSaveToutiaoDraft,
};
