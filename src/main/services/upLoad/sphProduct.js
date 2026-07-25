"use strict";

import { pollPageUntil } from "./uploadTimeouts.js";
import { validateVideoProductId } from "../../../shared/videoProduct.js";

const PRODUCT_ACTION_TIMEOUT_MS = 30 * 1000;

function productError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function pollProductPageUntil(
  page,
  pageFn,
  pageArg,
  timeoutMessage,
  stepMs = 300
) {
  const deadline = Date.now() + PRODUCT_ACTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(pageFn, pageArg).catch(() => false);
    if (ok) return;
    await page.waitForTimeout(stepMs);
  }
  throw productError("product_action_timeout", timeoutMessage);
}

async function waitForProductDialog(page) {
  await pollPageUntil(
    page,
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      if (!app || !app.shadowRoot) return false;
      return Array.from(
        app.shadowRoot.querySelectorAll(".weui-desktop-dialog")
      ).some((dialog) =>
        String(dialog.textContent || "").includes("从橱窗添加商品")
      );
    },
    PRODUCT_ACTION_TIMEOUT_MS,
    300,
    "等待视频号商品弹窗超时"
  );
}

async function openProductDialog(page) {
  const current = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow_root_not_found" };
    const link = root.querySelector(".post-with-link");
    if (!link) return { ok: false, reason: "product_entry_not_found" };
    const selectedType = String(
      (link.querySelector(".choosen-link-wrap span") || {}).textContent || ""
    ).trim();
    return { ok: true, productTypeSelected: selectedType === "商品" };
  });
  if (!current || !current.ok) {
    throw productError(
      current && current.reason ? current.reason : "product_entry_not_found",
      "未找到视频号发布页的商品入口"
    );
  }

  if (!current.productTypeSelected) {
    const openedMenu = await page.evaluate(() => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return false;
      const trigger = root.querySelector(".post-with-link .link-display-wrap");
      if (!trigger) return false;
      trigger.click();
      return true;
    });
    if (!openedMenu) {
      throw productError(
        "product_link_menu_not_opened",
        "无法打开视频号链接类型菜单"
      );
    }

    await pollPageUntil(
      page,
      () => {
        const app = document.querySelector("wujie-app.wujie_iframe");
        const root = app && app.shadowRoot;
        if (!root) return false;
        const menu = root.querySelector(".post-with-link .link-list-options");
        return Boolean(
          menu &&
            getComputedStyle(menu).display !== "none" &&
            Array.from(menu.querySelectorAll(".link-option-item")).some(
              (item) =>
                String(item.textContent || "").replace(/\s+/g, "") === "商品"
            )
        );
      },
      PRODUCT_ACTION_TIMEOUT_MS,
      200,
      "链接类型菜单中未出现“商品”选项"
    );

    const clicked = await page.evaluate(() => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return false;
      const options = Array.from(
        root.querySelectorAll(".post-with-link .link-option-item")
      );
      const product = options.find(
        (item) => String(item.textContent || "").replace(/\s+/g, "") === "商品"
      );
      if (!product) return false;
      product.click();
      return true;
    });
    if (!clicked) {
      throw productError(
        "product_option_not_found",
        "链接菜单中未找到“商品”选项"
      );
    }

  }

  // 选择链接类型只会渲染下方商品选择框，不会直接打开商品弹窗。
  await pollPageUntil(
    page,
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return false;
      const selected = root.querySelector(
        ".post-with-link .choosen-link-wrap span"
      );
      const chooser = root.querySelector(
        ".post-with-link .post-component-choose-wrap .content-wrap"
      );
      return Boolean(
        selected &&
          String(selected.textContent || "").trim() === "商品" &&
          chooser
      );
    },
    PRODUCT_ACTION_TIMEOUT_MS,
    200,
    "视频号商品选择框未出现"
  );

  const openedDialog = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const chooser = root.querySelector(
      ".post-with-link .post-component-choose-wrap .content-wrap"
    );
    if (!chooser) return false;
    chooser.click();
    return true;
  });
  if (!openedDialog) {
    throw productError(
      "product_chooser_not_found",
      "未找到“选择需要添加的商品”入口"
    );
  }

  await waitForProductDialog(page);
}

async function searchProduct(page, productId) {
  const searched = await page.evaluate((id) => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow_root_not_found" };
    const dialogs = Array.from(root.querySelectorAll(".weui-desktop-dialog"));
    const dialog = dialogs.find((item) =>
      String(item.textContent || "").includes("从橱窗添加商品")
    );
    if (!dialog) return { ok: false, reason: "product_dialog_not_found" };
    const input = dialog.querySelector(
      'input[placeholder="请输入商品名称/编码搜索"]'
    );
    if (!input) return { ok: false, reason: "product_search_input_not_found" };
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, id);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const button = dialog.querySelector(".search-btn button");
    if (!button) return { ok: false, reason: "product_search_button_not_found" };
    button.click();
    return { ok: true };
  }, productId);
  if (!searched || !searched.ok) {
    throw productError(
      searched && searched.reason ? searched.reason : "product_search_failed",
      "视频号商品搜索失败"
    );
  }
}

async function selectExactProduct(page, productId) {
  await pollProductPageUntil(
    page,
    (id) => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return false;
      return Boolean(
        root.querySelector(`.weui-desktop-dialog tr[data-row-key="${id}"]`)
      );
    },
    productId,
    `未找到商品编码 ${productId}`
  );

  const selected = await page.evaluate((id) => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow_root_not_found" };
    const row = root.querySelector(
      `.weui-desktop-dialog tr[data-row-key="${id}"]`
    );
    if (!row) return { ok: false, reason: "product_not_found" };
    const input = row.querySelector(`input.ant-radio-input[value="${id}"]`);
    if (!input) return { ok: false, reason: "product_radio_not_found" };
    const title = String(
      (row.querySelector(".commodity-info-wrap .title") || {}).textContent || ""
    ).trim();
    input.click();
    return { ok: true, title };
  }, productId);
  if (!selected || !selected.ok) {
    throw productError(
      selected && selected.reason ? selected.reason : "product_select_failed",
      `选择商品 ${productId} 失败`
    );
  }

  await pollProductPageUntil(
    page,
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return false;
      const dialog = Array.from(
        root.querySelectorAll(".weui-desktop-dialog")
      ).find(
        (item) =>
          String(item.textContent || "").includes("从橱窗添加商品") &&
          getComputedStyle(item).display !== "none"
      );
      if (!dialog) return false;
      const button = Array.from(
        dialog.querySelectorAll(".weui-desktop-btn_primary")
      ).find((item) =>
        /^添加(?:\(\d+\))?$/.test(
          String(item.textContent || "").replace(/\s+/g, "")
        )
      );
      return Boolean(
        button &&
          !button.classList.contains("weui-desktop-btn_disabled") &&
          !button.disabled
      );
    },
    null,
    "商品已选择，但“添加”按钮仍不可用",
    200
  );

  const added = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const dialog = Array.from(
      root.querySelectorAll(".weui-desktop-dialog")
    ).find(
      (item) =>
        String(item.textContent || "").includes("从橱窗添加商品") &&
        getComputedStyle(item).display !== "none"
    );
    if (!dialog) return false;
    const button = Array.from(
      dialog.querySelectorAll(".weui-desktop-btn_primary")
    ).find((item) =>
      /^添加(?:\(\d+\))?$/.test(
        String(item.textContent || "").replace(/\s+/g, "")
      )
    );
    if (
      !button ||
      button.disabled ||
      button.classList.contains("weui-desktop-btn_disabled")
    ) {
      return false;
    }
    button.focus();
    button.click();
    return true;
  });
  if (!added) {
    throw productError("product_add_failed", "点击商品“添加”按钮失败");
  }

  const productTitle = selected.title;
  await pollProductPageUntil(
    page,
    (expectedTitle) => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return false;
      const name = root.querySelector(
        ".post-with-link .post-component-choose-wrap .choose-content .name"
      );
      const actual = String((name && name.textContent) || "").trim();
      return Boolean(actual && (!expectedTitle || actual === expectedTitle));
    },
    productTitle,
    "商品弹窗已提交，但发布页未显示已挂商品"
  );

  return { productId, productTitle };
}

export async function attachSphVideoProduct(page, option = {}) {
  if (!option || option.enabled !== true) return null;
  const checked = validateVideoProductId(option.productId);
  if (!checked.ok || !checked.productId) {
    throw productError(
      "invalid_product_id",
      checked.error || "请填写视频号商品编码"
    );
  }
  await openProductDialog(page);
  await searchProduct(page, checked.productId);
  return selectExactProduct(page, checked.productId);
}
