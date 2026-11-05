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

import {
  legacyPhoneGroup,
  recordAccountKeyOf,
} from "./accountIdentity.js";

export function updateAccountTreePublishSettings(accountTree = {}, patch = {}) {
  const targetPt = String(patch.pt || "");
  const nextTree = JSON.parse(JSON.stringify(accountTree || {}));
  if (!targetPt) return nextTree;

  // 匹配键：优先 accountKey（新分组模型，同一登录态只属一个平台账号），
  // patch 未携带 accountKey 时回退历史 phone "-" 前缀匹配
  const targetKey = patch.accountKey
    ? String(patch.accountKey)
    : legacyPhoneGroup(patch.phone);
  if (!targetKey) return nextTree;

  Object.keys(nextTree).forEach((phoneKey) => {
    const group = nextTree[phoneKey];
    const children = Array.isArray(group && group.children)
      ? group.children
      : [];
    children.forEach((child) => {
      // accountTree children 结构为 { meta: { phone, pt, ... }, ... }
      const meta = (child && child.meta) || child || {};
      const sameKey = recordAccountKeyOf(meta) === targetKey;
      const samePt = String(meta.pt || "") === targetPt;
      if (sameKey && samePt) {
        if (!child.meta) child.meta = {};
        child.meta.defaultPublishToDraft = Boolean(patch.defaultPublishToDraft);
        if (typeof patch.useRealBrowser === "boolean") {
          child.meta.useRealBrowser = patch.useRealBrowser;
        }
      }
    });
  });

  return nextTree;
}
