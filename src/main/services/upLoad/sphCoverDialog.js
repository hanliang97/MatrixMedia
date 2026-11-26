"use strict";

/**
 * 视频号封面编辑弹窗匹配与浏览器端 DOM 辅助工具。
 *
 * 背景：
 * - 竖屏视频（如 9:16）：发表页只有一个合并槽位「个人主页和分享卡片 (3:4)」，
 *   点开 `.vertical-cover-wrap` 后 `.weui-desktop-dialog` 标题为「编辑封面」。
 * - 横屏 / 4:3 视频（宽 > 高）：发表页将封面拆成「个人主页卡片 3:4」和「分享卡片 4:3」
 *   两个独立槽位，点开 `.vertical-cover-wrap` 后弹窗标题变为「编辑个人主页卡片」
 *   （副标题「将会用在视频号个人主页」），整个弹窗内不含「编辑封面」字样。
 *
 * 约束：下方标注「浏览器端」的函数会被 Puppeteer `page.evaluate` / `page.waitForFunction`
 * 序列化后注入页面执行，不能依赖模块作用域变量或闭包，配置均通过参数 `cfg` 传入。
 */

export const SPH_COVER_DIALOG_HINTS = [
  "编辑封面",
  "编辑个人主页卡片",
  "编辑分享卡片",
  "裁剪封面",
];

export const SPH_COVER_DIALOG_SECONDARY_HINTS = [
  "效果预览",
  "个人主页",
  "分享卡片",
  "裁剪",
  "平铺展示",
];

export const SPH_COVER_DIALOG_MATCH_CONFIG = {
  hints: SPH_COVER_DIALOG_HINTS,
  secondaryHints: SPH_COVER_DIALOG_SECONDARY_HINTS,
};

export function normalizeSphCoverText(raw) {
  return String(raw || "").replace(/\s+/g, "").trim();
}

/**
 * 纯函数：判断 `.weui-desktop-dialog` 的文本是否属于视频号封面编辑弹窗。
 * 排除声明原创、草稿保留确认、商品/短剧挂载等无关弹窗。
 */
export function isSphCoverDialogText(
  rawText,
  cfg = SPH_COVER_DIALOG_MATCH_CONFIG
) {
  const text = normalizeSphCoverText(rawText);
  if (!text) return false;
  const hints = (cfg && cfg.hints) || SPH_COVER_DIALOG_HINTS;
  const secondaryHints =
    (cfg && cfg.secondaryHints) || SPH_COVER_DIALOG_SECONDARY_HINTS;
  if (hints.some((hint) => text.includes(hint))) return true;
  if (text.includes("从视频中选择封面")) return true;
  if (
    text.includes("上传封面") &&
    secondaryHints.some((hint) => text.includes(hint))
  ) {
    return true;
  }
  return false;
}

/**
 * 纯函数：从弹窗列表中选出最顶层（DOM 顺序靠后）的可见封面弹窗。
 * 若存在嵌套弹窗（如编辑个人主页卡片上方再弹裁剪弹窗），优先操作顶层。
 */
export function pickTopmostSphCoverDialog(
  dialogs,
  cfg = SPH_COVER_DIALOG_MATCH_CONFIG
) {
  const matched = (Array.isArray(dialogs) ? dialogs : []).filter(
    (item) => item && item.visible && isSphCoverDialogText(item.text, cfg)
  );
  return {
    dialog: matched.length > 0 ? matched[matched.length - 1] : null,
    count: matched.length,
  };
}

/* ------------------------------------------------------------------ *
 * 浏览器端：视频号封面槽位与弹窗操作（完全自包含，供 page.evaluate 调用）
 * ------------------------------------------------------------------ */

/** 浏览器端：读取 3:4 竖版封面槽位当前图片 src */
export function readSphVerticalCoverSrcInPage() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return "";
  const img =
    root.querySelector(".cover-img-vertical") ||
    root.querySelector(".vertical-cover-wrap img") ||
    root.querySelector(".cover-preview-wrap img");
  return img ? img.src || "" : "";
}

/** 浏览器端：点击 3:4 封面编辑槽位 */
export function openSphCoverSlotInPage() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return false;
  const slot =
    root.querySelector(".vertical-cover-wrap") ||
    root.querySelector(".cover-preview-wrap");
  if (!slot) return false;
  if (typeof slot.scrollIntoView === "function") {
    slot.scrollIntoView({ block: "center", inline: "center" });
  }
  slot.click();
  return true;
}

/** 浏览器端：判断是否存在可见的视频号封面弹窗（供 waitForFunction 轮询） */
export function hasVisibleSphCoverDialogInPage(cfg) {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return false;
  const hints = (cfg && cfg.hints) || [];
  const secondaryHints = (cfg && cfg.secondaryHints) || [];
  const isVisible = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isCoverText = (t) => {
    if (!t) return false;
    if (hints.some((h) => t.includes(h))) return true;
    if (t.includes("从视频中选择封面")) return true;
    return (
      t.includes("上传封面") && secondaryHints.some((h) => t.includes(h))
    );
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog"));
  return dialogs.some((d) => {
    if (!isVisible(d)) return false;
    const t = String(d.textContent || "").replace(/\s+/g, "").trim();
    return isCoverText(t);
  });
}

/** 浏览器端：诊断用，读取当前所有可见弹窗的头部摘要 */
export function listVisibleSphDialogsInPage() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return [];
  const isVisible = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  return Array.from(root.querySelectorAll(".weui-desktop-dialog"))
    .filter(isVisible)
    .map((d) =>
      String(d.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)
    );
}

/** 浏览器端：在顶层可见封面弹窗内切到/点击「上传封面」入口 */
export function clickSphCoverUploadTriggerInPage(cfg) {
  const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "no-shadow" };
  const hints = (cfg && cfg.hints) || [];
  const secondaryHints = (cfg && cfg.secondaryHints) || [];
  const isVisible = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isCoverText = (t) => {
    if (!t) return false;
    if (hints.some((h) => t.includes(h))) return true;
    if (t.includes("从视频中选择封面")) return true;
    return (
      t.includes("上传封面") && secondaryHints.some((h) => t.includes(h))
    );
  };
  const matched = Array.from(
    root.querySelectorAll(".weui-desktop-dialog")
  ).filter((d) => isVisible(d) && isCoverText(norm(d.textContent)));
  const dlg = matched.length > 0 ? matched[matched.length - 1] : null;
  if (!dlg) return { ok: false, reason: "no-dialog" };
  const dialogTitle = norm(dlg.textContent).slice(0, 40);
  const nodes = Array.from(dlg.querySelectorAll("*"));
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const r = el.getBoundingClientRect();
    if (r.width === 0 || el.children.length > 2) continue;
    if (norm(el.textContent) === "上传封面") {
      el.click();
      return { ok: true, mode: "clicked", dialogTitle };
    }
  }
  // 兜底：若该形态弹窗已直接挂载图片 file input，无需强求独立 tab 点击
  const readyInput =
    dlg.querySelector('.single-cover-uploader-wrap input[type="file"]') ||
    Array.from(dlg.querySelectorAll('input[type="file"]')).find((i) =>
      /image/.test(i.accept || "")
    );
  if (readyInput) {
    return { ok: true, mode: "input-ready", dialogTitle };
  }
  return { ok: false, reason: "no-upload-entry", dialogTitle };
}

/** 浏览器端：优先从当前顶层封面弹窗内定位图片 file input，找不到再回退整个 shadowRoot */
export function findSphCoverFileInputInPage(cfg) {
  const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return null;
  const hints = (cfg && cfg.hints) || [];
  const secondaryHints = (cfg && cfg.secondaryHints) || [];
  const isVisible = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isCoverText = (t) => {
    if (!t) return false;
    if (hints.some((h) => t.includes(h))) return true;
    if (t.includes("从视频中选择封面")) return true;
    return (
      t.includes("上传封面") && secondaryHints.some((h) => t.includes(h))
    );
  };
  const matched = Array.from(
    root.querySelectorAll(".weui-desktop-dialog")
  ).filter((d) => isVisible(d) && isCoverText(norm(d.textContent)));
  const dlg = matched.length > 0 ? matched[matched.length - 1] : null;
  if (dlg) {
    const dlgInput =
      dlg.querySelector('.single-cover-uploader-wrap input[type="file"]') ||
      Array.from(dlg.querySelectorAll('input[type="file"]')).find((i) =>
        /image/.test(i.accept || "")
      ) ||
      dlg.querySelector('input[type="file"]');
    if (dlgInput) return dlgInput;
  }
  return (
    root.querySelector('.single-cover-uploader-wrap input[type="file"]') ||
    Array.from(root.querySelectorAll('input[type="file"]')).find((i) =>
      /image/.test(i.accept || "")
    ) ||
    null
  );
}

/** 浏览器端：点击顶层可见封面弹窗中的「确定 / 确认」按钮 */
export function confirmSphCoverDialogInPage(cfg) {
  const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "no-shadow" };
  const hints = (cfg && cfg.hints) || [];
  const secondaryHints = (cfg && cfg.secondaryHints) || [];
  const isVisible = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isCoverText = (t) => {
    if (!t) return false;
    if (hints.some((h) => t.includes(h))) return true;
    if (t.includes("从视频中选择封面")) return true;
    return (
      t.includes("上传封面") && secondaryHints.some((h) => t.includes(h))
    );
  };
  const matched = Array.from(
    root.querySelectorAll(".weui-desktop-dialog")
  ).filter((d) => isVisible(d) && isCoverText(norm(d.textContent)));
  const dlg = matched.length > 0 ? matched[matched.length - 1] : null;
  if (!dlg) return { ok: false, reason: "no-dialog" };
  const dialogTitle = norm(dlg.textContent).slice(0, 40);
  const labels = ["确定", "确认"];
  const buttons = Array.from(
    dlg.querySelectorAll("button,.weui-desktop-btn,[role='button']")
  );
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    for (let j = 0; j < buttons.length; j++) {
      const b = buttons[j];
      const r = b.getBoundingClientRect();
      const disabled =
        b.disabled ||
        b.getAttribute("aria-disabled") === "true" ||
        (b.classList && b.classList.contains("weui-desktop-btn_disabled"));
      if (r.width > 0 && r.height > 0 && !disabled && norm(b.textContent) === label) {
        b.click();
        return {
          ok: true,
          label,
          dialogCount: matched.length,
          dialogTitle,
        };
      }
    }
  }
  return {
    ok: false,
    reason: "no-确定/确认",
    dialogCount: matched.length,
    dialogTitle,
  };
}

/** 浏览器端：读取封面确认后的槽位 src 与封面弹窗残留状态 */
export function readSphCoverAfterStateInPage(cfg) {
  const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { src: "", dialogOpen: false, dialogCount: 0, dialogTitle: "" };
  const img =
    root.querySelector(".cover-img-vertical") ||
    root.querySelector(".vertical-cover-wrap img") ||
    root.querySelector(".cover-preview-wrap img");
  const hints = (cfg && cfg.hints) || [];
  const secondaryHints = (cfg && cfg.secondaryHints) || [];
  const isVisible = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isCoverText = (t) => {
    if (!t) return false;
    if (hints.some((h) => t.includes(h))) return true;
    if (t.includes("从视频中选择封面")) return true;
    return (
      t.includes("上传封面") && secondaryHints.some((h) => t.includes(h))
    );
  };
  const matched = Array.from(
    root.querySelectorAll(".weui-desktop-dialog")
  ).filter((d) => isVisible(d) && isCoverText(norm(d.textContent)));
  const top = matched.length > 0 ? matched[matched.length - 1] : null;
  return {
    src: img ? img.src || "" : "",
    dialogOpen: matched.length > 0,
    dialogCount: matched.length,
    dialogTitle: top ? norm(top.textContent).slice(0, 40) : "",
  };
}
