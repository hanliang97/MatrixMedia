"use strict";

export function normalizeAccountPublishSettings(settings = {}) {
  return {
    defaultPublishToDraft: Boolean(settings.defaultPublishToDraft),
    useRealBrowser: Boolean(settings.useRealBrowser),
  };
}

export function isDefaultPublishToDraftEnabled(account = {}) {
  return Boolean(account.defaultPublishToDraft);
}

export function resolveEffectivePublishMode(requestDraftMode, account = {}) {
  // 使用真实浏览器时，仍然尊重用户主动选择的草稿模式和账号级别的默认草稿设置。
  // 真实浏览器同样支持点击"暂存离开"按钮进行草稿发布，不应静默覆盖用户意图。
  const publishToDraft =
    Boolean(requestDraftMode) || isDefaultPublishToDraftEnabled(account);
  return {
    publishMode: publishToDraft ? "draft" : "publish",
    publishToDraft,
  };
}

function normalizePhone(value) {
  return String(value || "").split("-")[0];
}

export function updateAccountTreePublishSettings(accountTree = {}, patch = {}) {
  const targetPhone = normalizePhone(patch.phone);
  const targetPt = String(patch.pt || "");
  const nextTree = JSON.parse(JSON.stringify(accountTree || {}));
  if (!targetPhone || !targetPt) return nextTree;

  Object.keys(nextTree).forEach((phoneKey) => {
    const group = nextTree[phoneKey];
    const children = Array.isArray(group && group.children)
      ? group.children
      : [];
    children.forEach((child) => {
      const samePhone = normalizePhone(child && child.phone) === targetPhone;
      const samePt = String((child && child.pt) || "") === targetPt;
      if (samePhone && samePt) {
        child.defaultPublishToDraft = Boolean(patch.defaultPublishToDraft);
        if (typeof patch.useRealBrowser === "boolean") {
          child.useRealBrowser = patch.useRealBrowser;
        }
      }
    });
  });

  return nextTree;
}
