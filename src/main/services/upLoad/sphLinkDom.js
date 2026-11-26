"use strict";

/**
 * 视频号「链接 / 第三方属性」区域的通用 DOM 工具。
 *
 * 背景：视频号助手发布页整体跑在微前端容器 `wujie-app.wujie_iframe` 里，
 * 所有业务节点都在它的 shadowRoot 内，普通选择器（无 `>>>` 穿透）拿不到。
 * 商品流程（sphProduct.js）是已验证实现，保持原样；这里抽取一套**自包含**的
 * 浏览器端函数，供其它链接类型（当前是小程序短剧）复用，避免各写一遍 shadow DOM 穿透。
 *
 * 约束：下面带 `浏览器端` 注释的函数会被 `page.evaluate` 序列化后在页面里执行，
 * 所以它们不能引用本模块作用域的常量或闭包变量——可变数据一律走参数。
 */

import {
  assertPageOpen,
  isPageClosedError,
  waitStepOrPageClose,
} from "./uploadTimeouts.js";

/** 单步链接操作的等待上限（与商品流程保持一致） */
export const SPH_LINK_ACTION_TIMEOUT_MS = 30 * 1000;

/** 失败时最多打印多少条候选文本，便于按实际页面排查 */
const DIAGNOSTIC_TEXT_LIMIT = 30;

export function sphLinkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/* ------------------------------------------------------------------ *
 * 浏览器端：读取链接区域状态
 * ------------------------------------------------------------------ */

export function readSphLinkSection() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const link = root.querySelector(".post-with-link");
  if (!link) return { ok: false, reason: "link_entry_not_found" };

  const menu = link.querySelector(".link-list-options");
  const menuVisible = Boolean(
    menu && getComputedStyle(menu).display !== "none"
  );
  const options = menu
    ? Array.from(menu.querySelectorAll(".link-option-item")).map((item) =>
        String(item.textContent || "").replace(/\s+/g, "")
      )
    : [];
  const selected = String(
    (link.querySelector(".choosen-link-wrap span") || {}).textContent || ""
  )
    .replace(/\s+/g, "")
    .trim();
  const hasChooser = Boolean(
    link.querySelector(".post-component-choose-wrap .content-wrap")
  );
  return { ok: true, selected, options, menuVisible, hasChooser };
}

/** 浏览器端：展开「链接类型」下拉 */
export function clickSphLinkTrigger() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return false;
  const trigger = root.querySelector(".post-with-link .link-display-wrap");
  if (!trigger) return false;
  trigger.click();
  return true;
}

/**
 * 浏览器端：点击「链接类型」菜单里文本命中的选项
 * @param {{ labels: string[] }} payload 归一化后的候选文案（已去空白）
 */
export function clickSphLinkOptionByLabel(payload) {
  const labels = (payload && payload.labels) || [];
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const options = Array.from(
    root.querySelectorAll(".post-with-link .link-option-item")
  );
  const target = options.find((item) =>
    labels.includes(String(item.textContent || "").replace(/\s+/g, ""))
  );
  if (!target) {
    return {
      ok: false,
      reason: "option_not_found",
      options: options.map((item) =>
        String(item.textContent || "").replace(/\s+/g, "")
      ),
    };
  }
  target.click();
  return {
    ok: true,
    label: String(target.textContent || "").replace(/\s+/g, ""),
  };
}

/** 浏览器端：点击「选择内容」入口（商品/短剧等共用的 .post-component-choose-wrap） */
export function clickSphLinkChooser() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return false;
  const chooser = root.querySelector(
    ".post-with-link .post-component-choose-wrap .content-wrap"
  );
  if (!chooser) return false;
  chooser.click();
  return true;
}

/** 浏览器端：发布页当前已挂载内容的展示名 */
export function readSphLinkChosenName() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return "";
  const node = root.querySelector(
    ".post-with-link .post-component-choose-wrap .choose-content .name"
  );
  return String((node && node.textContent) || "").trim();
}

/* ------------------------------------------------------------------ *
 * 浏览器端：弹窗（从橱窗添加商品 / 添加短剧 …）
 * ------------------------------------------------------------------ */

/** 浏览器端：读取弹窗状态；hints 用于匹配弹窗标题 */
export function readSphLinkDialog(payload) {
  const hints = (payload && payload.hints) || [];
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  // 沿祖先链判断可见性：隐藏弹窗自身 computed display 仍非 none，
  // 只有祖先 .weui-desktop-dialog__wrp 是 display:none（发布页有 30+ 残留实例）
  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog"));
  const visible = dialogs.filter(visibleInTree);
  const text = (item) => String(item.textContent || "").replace(/\s+/g, "");
  const dialog =
    (hints.length
      ? visible.find((item) => hints.some((hint) => text(item).includes(hint)))
      : null) ||
    visible[visible.length - 1] ||
    null;
  if (!dialog) {
    return {
      ok: false,
      reason: "dialog_not_found",
      dialogs: visible.map(text).map((t) => t.slice(0, 60)),
    };
  }
  const inputs = Array.from(dialog.querySelectorAll("input")).map((input) => ({
    placeholder: String(input.getAttribute("placeholder") || ""),
    type: String(input.getAttribute("type") || "text"),
  }));
  return { ok: true, title: text(dialog).slice(0, 60), inputs };
}

/** 浏览器端：在弹窗内搜索框填写内容并触发 change */
export function fillSphLinkDialogSearch(payload) {
  const hints = (payload && payload.hints) || [];
  const value = String((payload && payload.value) || "");
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    (item) => getComputedStyle(item).display !== "none"
  );
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return { ok: false, reason: "dialog_not_found" };

  const candidates = Array.from(dialog.querySelectorAll("input")).filter(
    (input) => String(input.getAttribute("type") || "text") !== "radio"
  );
  let input =
    candidates.find((item) => {
      const placeholder = String(item.getAttribute("placeholder") || "");
      return hints.some((hint) => placeholder.includes(hint));
    }) || null;
  if (!input) {
    // 兜底：常见搜索容器内的第一个文本输入框
    input =
      dialog.querySelector(
        ".search-wrap input, .search input, .weui-desktop-search input, .ant-input"
      ) || candidates[0] || null;
  }
  if (!input) return { ok: false, reason: "search_input_not_found" };

  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return {
    ok: true,
    placeholder: String(input.getAttribute("placeholder") || ""),
  };
}

/** 浏览器端：点击弹窗内的搜索按钮（若存在） */
export function clickSphLinkDialogSearch() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    (item) => getComputedStyle(item).display !== "none"
  );
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return { ok: false, reason: "dialog_not_found" };

  const byClass = dialog.querySelector(".search-btn button");
  const byText = Array.from(dialog.querySelectorAll("button")).find((button) =>
    /^(搜索|查询)$/.test(String(button.textContent || "").replace(/\s+/g, ""))
  );
  const button = byClass || byText;
  if (!button) return { ok: false, reason: "search_button_not_found" };
  button.click();
  return { ok: true };
}

/**
 * 浏览器端：列出弹窗内候选行，失败时用于诊断（也用于等待结果出现）
 * @param {{ limit?: number, hints?: string[] }} payload
 */
export function listSphLinkDialogRows(payload) {
  const limit = Number((payload && payload.limit) || 20);
  const hints = (payload && payload.hints) || [];
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  // 沿祖先链判断可见性（详见 readSphLinkDialog 中的说明）
  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    visibleInTree
  );
  const dialogText = (item) =>
    String(item.textContent || "").replace(/\s+/g, "");
  const dialog =
    (hints.length
      ? dialogs.find((item) =>
          hints.some((hint) => dialogText(item).includes(hint))
        )
      : null) ||
    dialogs[dialogs.length - 1] ||
    null;
  if (!dialog) return { ok: false, reason: "dialog_not_found" };
  const rows = Array.from(
    dialog.querySelectorAll(
      "tr[data-row-key], .ant-table-row, .list-item, li[data-key]"
    )
  );
  return {
    ok: true,
    rows: rows.slice(0, limit).map((row) => ({
      key: String(row.getAttribute("data-row-key") || ""),
      text: String(row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
    })),
  };
}

/**
 * 浏览器端：按文本选中弹窗内的目标行（兼容 antd 表格行与普通列表项）
 * @param {{ id: string }} payload
 */
export function selectSphLinkDialogRowById(payload) {
  const id = String((payload && payload.id) || "");
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    (item) => getComputedStyle(item).display !== "none"
  );
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return { ok: false, reason: "dialog_not_found" };

  const escaped = window.CSS && window.CSS.escape ? window.CSS.escape(id) : id;
  let row = dialog.querySelector(`[data-row-key="${escaped}"]`);
  if (!row) {
    row = Array.from(
      dialog.querySelectorAll(
        "tr, .ant-table-row, .list-item, .drama-item, .card-item, li"
      )
    ).find((item) => String(item.textContent || "").includes(id));
  }
  if (!row) return { ok: false, reason: "row_not_found" };

  const clickable =
    row.querySelector('input.ant-radio-input, input.ant-checkbox-input') ||
    row.querySelector(".title, .name, .commodity-info-wrap") ||
    row;
  clickable.click();

  const titleNode = row.querySelector(
    ".commodity-info-wrap .title, .title, .name"
  );
  const title = String(
    (titleNode && titleNode.textContent) ||
      String(row.textContent || "").replace(/\s+/g, " ").trim()
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return { ok: true, title };
}

/** 浏览器端：点击弹窗主按钮（添加 / 确定 / 完成） */
export function clickSphLinkDialogPrimary(payload) {
  const labels = (payload && payload.labels) || [];
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    (item) => getComputedStyle(item).display !== "none"
  );
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return { ok: false, reason: "dialog_not_found" };

  const buttons = Array.from(
    dialog.querySelectorAll("button, .weui-desktop-btn")
  );
  const normalize = (button) =>
    String(button.textContent || "").replace(/\s+/g, "");
  const target = buttons.find((button) => {
    const text = normalize(button);
    return labels.some((label) => new RegExp(`^${label}(\\(\\d+\\))?$`).test(text));
  });
  if (!target) {
    return {
      ok: false,
      reason: "primary_button_not_found",
      buttons: buttons.map(normalize).filter(Boolean).slice(0, 10),
    };
  }
  if (
    target.disabled ||
    target.classList.contains("weui-desktop-btn_disabled")
  ) {
    return { ok: false, reason: "primary_button_disabled" };
  }
  target.focus();
  target.click();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Node 侧：轮询与组合步骤
 * ------------------------------------------------------------------ */

/**
 * 带参数的轮询：pollPageUntil 不支持传参，这里补齐（行匹配需要目标文本）。
 */
export async function pollSphPageUntil(
  page,
  pageFn,
  pageArg,
  timeoutMessage,
  stepMs = 250,
  totalMs = SPH_LINK_ACTION_TIMEOUT_MS
) {
  const deadline = Date.now() + totalMs;
  let last;
  while (Date.now() < deadline) {
    assertPageOpen(page);
    last = await page.evaluate(pageFn, pageArg).catch((err) => {
      if (isPageClosedError(err)) throw err;
      assertPageOpen(page);
      return null;
    });
    if (last && last.ok) return last;
    await waitStepOrPageClose(page, stepMs);
  }
  assertPageOpen(page);
  const error = sphLinkError("sph_link_timeout", timeoutMessage);
  error.detail = last || null;
  throw error;
}

export async function readSphLinkState(page) {
  return page.evaluate(readSphLinkSection).catch(() => null);
}

/**
 * 确保「链接类型」已选中候选文案之一；已选中则直接返回。
 * @returns {Promise<string>} 命中的菜单文案
 */
export async function ensureSphLinkType(page, labels) {
  const normalizedLabels = (labels || []).map((label) =>
    String(label == null ? "" : label).replace(/\s+/g, "")
  );
  // 链接区域随发布表单渲染：弱网或大文件场景下可能比前面的表单项慢，先等到位再操作。
  const current = await pollSphPageUntil(
    page,
    readSphLinkSection,
    null,
    "未找到视频号发布页的链接入口（.post-with-link）",
    500
  ).catch(async (error) => {
    await dumpSphLinkDiagnostics(page, "read-link-section");
    throw sphLinkError("link_entry_not_found", error.message);
  });
  const matchedNow = normalizedLabels.find(
    (label) => current.selected === label
  );
  if (matchedNow) return matchedNow;

  const opened = await page.evaluate(clickSphLinkTrigger).catch(() => false);
  if (!opened) {
    throw sphLinkError("link_menu_not_opened", "无法打开视频号链接类型菜单");
  }

  const clicked = await pollSphPageUntil(
    page,
    clickSphLinkOptionByLabel,
    { labels: normalizedLabels },
    `链接类型菜单中未出现「${normalizedLabels.join(" / ")}」选项`,
    250
  ).catch(async (error) => {
    await dumpSphLinkDiagnostics(page, "select-link-type");
    throw error;
  });
  return clicked.label;
}

/** 打开「选择内容」入口并等待目标弹窗 */
export async function openSphLinkChooser(page, dialogHints, chooserMessage) {
  await pollSphPageUntil(
    page,
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return { ok: false, reason: "shadow_root_not_found" };
      const chooser = root.querySelector(
        ".post-with-link .post-component-choose-wrap .content-wrap"
      );
      return { ok: Boolean(chooser) };
    },
    null,
    chooserMessage || "视频号选择内容入口未出现",
    250
  );

  const opened = await page.evaluate(clickSphLinkChooser).catch(() => false);
  if (!opened) {
    throw sphLinkError("link_chooser_not_found", "未找到视频号选择内容入口");
  }

  await pollSphPageUntil(
    page,
    readSphLinkDialog,
    { hints: dialogHints || [] },
    "等待视频号选择弹窗超时"
  ).catch(async (error) => {
    await dumpSphLinkDiagnostics(page, "open-chooser-dialog");
    throw error;
  });
}

/**
 * 浏览器端：用「正规途径」关闭视频号发布页上所有可见的弹窗（第一级清场）。
 *
 * 只做平台认可的操作：点弹窗右上角关闭按钮；没有关闭按钮时点「取消」。
 * **不碰** `style.display` 等强制隐藏手段（那是第三级兜底，见
 * `forceHideSphMasks`），以免绕过平台内部状态导致后续保存异常。
 *
 * @returns {{ok: boolean, closedDialogs: number, reason?: string}}
 */
export function closeSphDialogs() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };

  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  let closedDialogs = 0;
  const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog")).filter(
    visibleInTree
  );
  for (const dialog of dialogs) {
    const closeBtn = dialog.querySelector(
      ".weui-desktop-dialog__close-btn, .weui-desktop-icon-btn"
    );
    if (closeBtn) {
      closeBtn.click();
      closedDialogs++;
      continue;
    }
    const cancelBtn = Array.from(dialog.querySelectorAll("button")).find(
      (item) => String(item.textContent || "").replace(/\s+/g, "") === "取消"
    );
    if (cancelBtn) {
      cancelBtn.click();
      closedDialogs++;
    }
  }

  return { ok: true, closedDialogs };
}

/**
 * 浏览器端：第三级兜底 —— 强制隐藏残留遮罩。
 *
 * 仅在「点关闭按钮 + Esc」都无效、遮罩仍在拦截底部按钮时才调用。
 * 先尝试点击遮罩（触发平台自身的关闭逻辑），仍可见才写 `display:none`。
 *
 * @returns {{ok: boolean, removedMasks: number, forced: number, reason?: string}}
 */
export function forceHideSphMasks() {
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };

  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  let removedMasks = 0;
  let forced = 0;
  const masks = Array.from(root.querySelectorAll(".weui-desktop-mask")).filter(
    visibleInTree
  );
  for (const mask of masks) {
    try {
      mask.click();
    } catch (_) {
      /* ignore */
    }
    if (visibleInTree(mask)) {
      mask.style.display = "none";
      forced++;
    }
    removedMasks++;
  }

  return { ok: true, removedMasks, forced };
}

/**
 * 浏览器端：检测底部「保存草稿 / 发表」按钮是否真的可点。
 *
 * 注意：不能单靠 `document.elementFromPoint` 判断 —— 该按钮位于页面底部，
 * 坐标常落在视口之外，此时 elementFromPoint 返回 null，会把「正常可点」
 * 误判为「被遮挡」。正确判据：
 *   1) 按钮被禁用 → 不可点；
 *   2) 存在可见遮罩（.weui-desktop-mask）→ 不可点（这才是拦截点击的元素）；
 *   3) 按钮已在视口内 → 用 elementFromPoint 复核中心点是否命中按钮；
 *   4) 按钮在视口外且无遮罩 → 视为可点（click 会自动滚动到元素）。
 *
 * @param {{ selector?: string }} payload
 */
export function isSphFooterButtonClickable(payload) {
  const selector =
    (payload && payload.selector) || ".form-btns>div:first-child button";
  const app = document.querySelector("wujie-app.wujie_iframe");
  const root = app && app.shadowRoot;
  if (!root) return { ok: false, reason: "shadow_root_not_found" };
  const button = root.querySelector(selector);
  if (!button) return { ok: false, reason: "button_not_found" };
  if (
    button.disabled ||
    button.classList.contains("weui-desktop-btn_disabled")
  ) {
    return { ok: false, reason: "button_disabled" };
  }

  const visibleInTree = (el) => {
    let node = el;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      node = node.parentElement;
    }
    return true;
  };

  const visibleMasks = Array.from(
    root.querySelectorAll(".weui-desktop-mask")
  ).filter(visibleInTree);
  if (visibleMasks.length) {
    return {
      ok: false,
      reason: "button_covered_by_mask",
      masks: visibleMasks.length,
    };
  }

  const rect = button.getBoundingClientRect();
  const inViewport =
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth;

  if (inViewport) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top =
      (root.elementFromPoint && root.elementFromPoint(cx, cy)) ||
      document.elementFromPoint(cx, cy);
    const hit = Boolean(top && (top === button || button.contains(top)));
    return {
      ok: hit,
      reason: hit ? "" : "button_not_hit_in_viewport",
      inViewport: true,
      topElement: top
        ? `${top.tagName}.${String(top.className || "")}`.slice(0, 80)
        : null,
    };
  }

  // 视口外且无遮罩：click 会自动滚动，视为可点
  return { ok: true, inViewport: false, masks: 0 };
}

/**
 * Node 侧：失败兜底前清场 —— 确保底部「保存草稿」按钮真的可点。
 *
 * 链接挂载失败时，选择弹窗与其遮罩（.weui-desktop-mask，z-index 1500）
 * 会留在页面上，遮住底部「保存草稿」按钮，导致点击被吞掉、草稿未保存。
 *
 * 清场顺序（由轻到重，优先正规途径）：
 *   第 1 级：点弹窗关闭按钮 / 「取消」
 *   第 2 级：按 Esc
 *   第 3 级：强制隐藏残留遮罩（display:none），仅在前两级无效时兜底
 *
 * @param {import("puppeteer-core").Page} page
 * @param {string} [footerSelector] 底部按钮选择器（默认保存草稿按钮）
 * @returns {Promise<{ok: boolean, closedDialogs: number, removedMasks: number, forced: number, clickable: boolean, reason?: string}>}
 */
export async function clearSphOverlaysForFooter(
  page,
  footerSelector = ".form-btns>div:first-child button"
) {
  let closedDialogs = 0;
  let removedMasks = 0;
  let forced = 0;

  const checkClickable = async () =>
    page
      .evaluate(isSphFooterButtonClickable, { selector: footerSelector })
      .catch(() => null);

  // ---------- 第 1 级：正规关闭弹窗（关闭按钮 / 取消）----------
  for (let attempt = 0; attempt < 2; attempt++) {
    const closed = await page.evaluate(closeSphDialogs).catch(() => null);
    if (closed && closed.ok) closedDialogs += closed.closedDialogs || 0;

    let state = await checkClickable();
    if (state && state.ok) {
      return { ok: true, closedDialogs, removedMasks, forced, clickable: true };
    }
    if (state && state.reason === "button_not_found") {
      return {
        ok: false,
        closedDialogs,
        removedMasks,
        forced,
        clickable: false,
        reason: "button_not_found",
      };
    }
    await page.waitForTimeout(400);
  }

  // ---------- 第 2 级：Esc 关闭最上层弹窗 ----------
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.keyboard.press("Escape");
    } catch (_) {
      /* ignore */
    }
    await page.waitForTimeout(600);

    const state = await checkClickable();
    if (state && state.ok) {
      return { ok: true, closedDialogs, removedMasks, forced, clickable: true };
    }
  }

  // ---------- 第 3 级：强制隐藏残留遮罩（兜底）----------
  const masks = await page.evaluate(forceHideSphMasks).catch(() => null);
  if (masks && masks.ok) {
    removedMasks += masks.removedMasks || 0;
    forced += masks.forced || 0;
  }
  await page.waitForTimeout(400);

  const finalState = await checkClickable();
  const clickable = Boolean(finalState && finalState.ok);
  return {
    ok: clickable,
    closedDialogs,
    removedMasks,
    forced,
    clickable,
    // 注意：可点时 reason 为空串，不能用 `|| "still_covered"` 兜底，
    // 否则会把"已可点"误报成"仍被遮挡"（曾导致日志自相矛盾）。
    reason: clickable ? "" : (finalState && finalState.reason) || "still_covered",
    topElement: clickable ? null : finalState && finalState.topElement,
  };
}

/**
 * 失败诊断：把当前页面里的菜单项、弹窗输入框、候选行打到日志，
 * 便于按实际页面调整 sphDrama.js 顶部的候选文案常量。
 */
export async function dumpSphLinkDiagnostics(page, tag, dialogHints) {
  try {
    const section = await readSphLinkState(page);
    const dialog = await page
      .evaluate(readSphLinkDialog, { hints: dialogHints || [] })
      .catch(() => null);
    const rows = await page
      .evaluate(listSphLinkDialogRows, {
        limit: DIAGNOSTIC_TEXT_LIMIT,
        hints: dialogHints || [],
      })
      .catch(() => null);
    const payload = {
      tag,
      linkSection: section,
      dialog,
      rows: rows && rows.ok ? rows.rows : rows,
    };
    console.log(
      `[sph][link][诊断] ${JSON.stringify(payload).slice(0, 2000)}`
    );
  } catch (error) {
    console.log(
      `[sph][link][诊断] 采集失败: ${
        error && error.message ? error.message : error
      }`
    );
  }
}
