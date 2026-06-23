"use strict";

export function normalizeAccountPublishSettings(settings = {}) {
  return {
    defaultPublishToDraft: Boolean(settings.defaultPublishToDraft),
  };
}

export function isDefaultPublishToDraftEnabled(account = {}) {
  return Boolean(account.defaultPublishToDraft);
}

export function resolveEffectivePublishMode(requestDraftMode, account = {}) {
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
      }
    });
  });

  return nextTree;
}
