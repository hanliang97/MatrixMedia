import { SPH_LOCATION_MODES } from "../../../shared/accountPublishSettings.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";

const ROOT = "wujie-app.wujie_iframe >>> ";
const SEL_POSITION_DISPLAY = `${ROOT}.post-position-wrap .position-display`;
const SEL_LOCATION_NAME = `${ROOT}.post-position-wrap .position-display .location-name`;
const LOCATION_NONE_TEXT = "不显示位置";
const LOCATION_ACTION_TIMEOUT_MS = 10 * 1000;

async function readCurrentLocationName(page) {
  const handle = await page.$(SEL_LOCATION_NAME);
  if (!handle) return "";
  return handle.evaluate((el) => String(el.textContent || "").trim());
}

async function waitForLocationHidden(page, previousName) {
  const deadline = Date.now() + LOCATION_ACTION_TIMEOUT_MS;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await page
      .evaluate(() => {
        const app = document.querySelector("wujie-app.wujie_iframe");
        const root = app && app.shadowRoot;
        if (!root) return { ready: false, reason: "shadow_root_not_found" };

        const wrap = root.querySelector(".post-position-wrap");
        if (!wrap) return { ready: false, reason: "position_wrap_not_found" };

        const menu = wrap.querySelector(".location-filter-wrap");
        const place = wrap.querySelector(".position-display .place");
        const name = wrap.querySelector(".position-display .location-name");
        const menuVisible = Boolean(
          menu && window.getComputedStyle(menu).display !== "none"
        );
        const placeVisible = Boolean(
          place &&
            window.getComputedStyle(place).display !== "none" &&
            window.getComputedStyle(place).visibility !== "hidden"
        );

        return {
          ready: true,
          menuVisible,
          placeVisible,
          hasLocationName: Boolean(name),
          locationName: String((name && name.textContent) || "").trim(),
        };
      })
      .catch(() => null);

    if (lastState && lastState.ready && !lastState.menuVisible) {
      const currentName = lastState.locationName || "";
      if (
        !lastState.placeVisible ||
        !lastState.hasLocationName ||
        !currentName ||
        currentName === LOCATION_NONE_TEXT ||
        currentName !== previousName
      ) {
        return lastState;
      }
    }
    await page.waitForTimeout(200);
  }

  const error = new Error(
    `视频号位置未切换为“不显示位置”，最终状态：${JSON.stringify(lastState)}`
  );
  error.name = "TimeoutError";
  throw error;
}

/**
 * 视频号账号关闭“使用平台默认位置”后，选择“不显示位置”。
 * 地址列表虽然常驻 DOM，但必须先展开组件，再用真实点击触发平台状态更新。
 */
export async function applySphLocationMode(page, mode) {
  if (mode !== SPH_LOCATION_MODES.NONE) {
    return { mode: SPH_LOCATION_MODES.PLATFORM_DEFAULT, changed: false };
  }

  const display = await page.waitForSelector(SEL_POSITION_DISPLAY, {
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  if (!display) throw new Error("未找到视频号位置设置");

  const currentName = await readCurrentLocationName(page);
  if (currentName === LOCATION_NONE_TEXT) {
    return { mode, changed: false };
  }

  console.log(`[sph][location] 当前显示位置：${currentName || "未知"}`);
  console.log("[sph][location] 正在展开位置选项");
  await display.click({ delay: 120 });
  await pollPageUntil(
    page,
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      if (!app || !app.shadowRoot) return false;
      const menu = app.shadowRoot.querySelector(
        ".post-position-wrap .location-filter-wrap"
      );
      return !!menu && window.getComputedStyle(menu).display !== "none";
    },
    LOCATION_ACTION_TIMEOUT_MS,
    100,
    "视频号位置选项未展开"
  );
  console.log("[sph][location] 位置选项已展开，正在选择不显示位置");

  const selected = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow_root_not_found" };
    const menu = root.querySelector(
      ".post-position-wrap .location-filter-wrap"
    );
    if (!menu || getComputedStyle(menu).display === "none") {
      return { ok: false, reason: "location_menu_not_visible" };
    }
    const options = Array.from(menu.querySelectorAll(".option-item"));
    const noneOption = options.find((item) => {
      const name = item.querySelector(".location-item-info .name");
      return String((name && name.textContent) || "").trim() === "不显示位置";
    });
    if (!noneOption) {
      return {
        ok: false,
        reason: "location_none_option_not_found",
        optionCount: options.length,
      };
    }
    noneOption.click();
    return { ok: true, optionCount: options.length };
  });
  if (!selected || !selected.ok) {
    throw new Error(
      `未能点击视频号“不显示位置”选项：${
        (selected && selected.reason) || "unknown"
      }`
    );
  }
  console.log(
    `[sph][location] 已触发不显示位置选项，候选地址数：${selected.optionCount}`
  );

  const finalState = await waitForLocationHidden(page, currentName);
  console.log("[sph][location] 不显示位置状态已确认:", finalState);

  return { mode, changed: true };
}
