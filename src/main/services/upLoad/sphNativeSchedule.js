"use strict";

import { isSphLoginUrl, isSphSessionInvalid } from "../../../shared/loginState.js";

const ORIGIN = "https://channels.weixin.qq.com";
const LIST_URL = ORIGIN + "/platform/post/list";
const LIST_PATH = "/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list";
const SHADOW = "wujie-app.wujie_iframe >>> ";

export function validateSphNativeScheduleAt(value, now = Date.now()) {
  const at = Number(value);
  if (!Number.isFinite(at) || at % 60000 !== 0 || !Number.isFinite(new Date(at).getTime())) {
    return { ok: false, error: "视频号原生定时需要有效时间，秒数必须为 00" };
  }
  if (at <= now) return { ok: false, error: "视频号原生定时时间必须在未来" };
  // 视频号表单以北京时间显示；可选范围由平台按账号和当前时间决定。
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { ok: true, at, year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: p.hour, minute: p.minute, text: p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute };
}

/** 用真实日历和时分选项触发页面更新；只读日期框不能直接赋值。 */
export async function prepareSphNativeSchedule(page, value) {
  const target = validateSphNativeScheduleAt(value);
  if (!target.ok) throw new Error(target.error);
  await page.emulateTimezone("Asia/Shanghai");
  await page.waitForSelector(SHADOW + '.post-time-wrap input[type="radio"][value="1"]',
    { timeout: 10000 });
  // evaluate 会把函数序列化到网页。每次只做一个 DOM 操作，避免构建后
  // async 回调引用 Babel 的进程内辅助函数，也让 Vue 有一轮时间更新控件。
  const deadline = Date.now() + 5000;
  let step;
  do {
    step = await page.evaluate(target => {
      const visible = el => Boolean(el?.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
      const enabled = el => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true" &&
        !el.classList.contains("weui-desktop-picker__disabled");
      if (location.origin !== "https://channels.weixin.qq.com" ||
          location.pathname !== "/platform/post/create") return { error: "未处于发表页" };
      const root = document.querySelector("wujie-app.wujie_iframe")?.shadowRoot;
      const wrap = root?.querySelector(".post-time-wrap");
      const radio = wrap?.querySelector('input[type="radio"][value="1"]');
      if (!radio || radio.disabled || radio.closest("label")?.innerText.trim() !== "定时") {
        return { error: "定时选项不可用" };
      }
      if (!radio.checked) {
        radio.click();
        return {};
      }
      const picker = wrap.querySelector(".weui-desktop-picker__date-time");
      const dateInput = picker?.querySelector('input[placeholder="请选择发表时间"]');
      const dateButton = picker?.querySelector(":scope > dt .weui-desktop-picker__icon-wrap");
      const datePanel = picker?.querySelector(":scope > dd");
      if (!dateInput || !enabled(dateButton) || !datePanel) return { error: "找不到日期选择器" };
      if (dateInput.value === target.text) {
        if (!visible(datePanel)) return { done: true };
        dateButton.click();
        return {};
      }
      if (!visible(datePanel)) {
        dateButton.click();
        return {};
      }
      if (dateInput.value.slice(0, 10) !== target.text.slice(0, 10)) {
        const [year, month] = [...datePanel.querySelectorAll(".weui-desktop-picker__panel__label")]
          .map(el => Number(el.textContent.trim().replace(/[年月]$/, "")));
        if (!Number.isInteger(year) || !(month >= 1 && month <= 12)) return { error: "未能读取日历年月" };
        const difference = target.year * 12 + target.month - (year * 12 + month);
        if (difference) {
          if (Math.abs(difference) > 2) return { error: "日期超出可选月份" };
          const button = datePanel.querySelector(".weui-desktop-btn__icon__" + (difference > 0 ? "right" : "left"));
          if (!enabled(button)) return { error: "日历无法切换至目标月份" };
          button.click();
          return {};
        }
        const days = [...datePanel.querySelectorAll(".weui-desktop-picker__table a")].filter(el =>
          enabled(el) && !el.classList.contains("weui-desktop-picker__faded") &&
          el.textContent.trim() === String(target.day));
        if (days.length !== 1) return { error: "平台未开放该日期" };
        days[0].click();
        return {};
      }
      const timePicker = datePanel.querySelector(".weui-desktop-picker__time");
      const timeButton = timePicker?.querySelector(":scope > dt .weui-desktop-icon__time");
      const timePanel = timePicker?.querySelector(":scope > dd");
      if (!enabled(timeButton) || !timePanel) return { error: "找不到时分选择器" };
      if (!visible(timePanel)) {
        timeButton.click();
        return {};
      }
      const hourMatches = dateInput.value.slice(11, 13) === target.hour;
      const unit = hourMatches ? "minute" : "hour";
      const time = hourMatches ? target.minute : target.hour;
      const options = [...timePanel.querySelectorAll(".weui-desktop-picker__time__" + unit + " li")]
        .filter(el => enabled(el) && el.textContent.trim() === time);
      if (options.length !== 1) return { error: "平台未开放该时分" };
      options[0].click();
      return {};
    }, target);
    if (step.done) return inspectSphNativeSchedule(page, value);
    if (step.error) break;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw new Error("视频号无法设置北京时间 " + target.text + "：" + (step.error || "时间回读超时"));
}


/** 点击前在同一次页面执行中重读模式、时间和按钮，防止回填被重置后立即发表。 */
export async function inspectSphNativeSchedule(page, value, submit = false) {
  const target = validateSphNativeScheduleAt(value);
  if (!target.ok) throw new Error(target.error);
  const ok = await page.evaluate((expected, at, submit) => {
    if (location.origin !== "https://channels.weixin.qq.com" ||
      location.pathname !== "/platform/post/create" || Date.now() >= at) return false;
    const root = document.querySelector("wujie-app.wujie_iframe")?.shadowRoot;
    const wrap = root?.querySelector(".post-time-wrap");
    const timed = wrap?.querySelector('input[type="radio"][value="1"]');
    const immediate = wrap?.querySelector('input[type="radio"][value="0"]');
    const input = wrap?.querySelector('input[placeholder="请选择发表时间"]');
    if (!timed?.checked || timed.disabled || immediate?.checked !== false ||
      !input?.getClientRects().length || input.disabled || input.value !== expected ||
      wrap.querySelector(".pub-time-err-tip")?.getClientRects().length) return false;
    if (submit) {
      const button = root.querySelector(".form-btns button.weui-desktop-btn_primary");
      if (!button?.getClientRects().length || button.disabled || button.getAttribute("aria-disabled") === "true" ||
        button.classList.contains("weui-desktop-btn_disabled") || button.innerText.trim() !== "发表") return false;
      button.click();
    }
    return true;
  }, target.text, target.at, submit);
  if (!ok) throw new Error("视频号定时设置或发表按钮校验未通过（预期北京时间 " + target.text + "）");
  return target;
}

export function sphWorkListItems(payload) {
  if (!payload || payload.errCode !== 0 ||
      (payload.data?.baseResp?.errcode != null && payload.data.baseResp.errcode !== 0)) return null;
  if (Array.isArray(payload.data?.list)) return payload.data.list;
  return payload.data?.totalCount === 0 ? [] : null;
}

export function sphWorkId(item) {
  if (typeof item?.objectId === "string" && /^\d+$/.test(item.objectId) && item.objectId !== "0") {
    return item.objectId;
  }
  return typeof item?.exportId === "string" ? item.exportId.trim() : "";
}

export function matchesSphNativeScheduled(item, text, value, { excludedIds, submittedAt }, now = Date.now()) {
  const id = sphWorkId(item);
  const at = Number(value);
  if (!id || excludedIds.has(id) || !Number.isFinite(at) || at <= now || at % 60000 !== 0 ||
      (typeof item.effectiveTime !== "number" && typeof item.effectiveTime !== "string") ||
      Number(item.effectiveTime) !== at / 1000) return false;
  // 作品列表只读取首页。秒级创建时间额外排除翻页后才出现的旧作；
  // 管理页把 handleStatus=2（或未返回该字段）视为处理成功。
  const createdAt = Number(item.createTime) * 1000;
  if (!Number.isFinite(submittedAt) || !Number.isFinite(createdAt) ||
      createdAt < Math.floor(submittedAt / 1000) * 1000 || createdAt > now ||
      (item.handleStatus !== undefined && item.handleStatus !== 2)) return false;
  const description = String(text.description || "").trim();
  const shortTitle = String(text.shortTitle || "").trim();
  if (!description && !shortTitle) return false;
  const actualDescription = item.desc?.description;
  const actualShortTitle = item.desc?.shortTitle?.[0]?.shortTitle;
  return (!description || (typeof actualDescription === "string" && actualDescription.trim() === description)) &&
    (!shortTitle || (typeof actualShortTitle === "string" && actualShortTitle.trim() === shortTitle));
}

/** 读取官方作品管理页请求的响应。失败或登录失效时不当作空列表。 */
export async function readSphWorkList(page, { timeout = 18000 } = {}) {
  let timer;
  let listener;
  const pending = new Promise(resolve => {
    timer = setTimeout(() => resolve({ error: "等待作品列表响应超时" }), timeout);
    listener = async response => {
      try {
        const url = new URL(response.url());
        if (url.origin !== ORIGIN || url.pathname !== LIST_PATH) return;
        const query = JSON.parse(response.request().postData() || "{}");
        // 官方视频管理页使用 11；旧版混合列表使用 0。
        if ((query.userpageType !== 11 && query.userpageType !== 0) || query.currentPage !== 1) return;
        if (!response.ok()) return resolve({ error: "作品列表 HTTP " + response.status() });
        const payload = await response.json();
        const items = sphWorkListItems(payload);
        if (items) return resolve({ items });
        if (isSphSessionInvalid(payload)) return resolve({ error: "视频号登录已失效" });
        const code = [payload?.errCode, payload?.data?.baseResp?.errcode]
          .find(value => Number.isSafeInteger(value) && value !== 0);
        resolve({ error: code === undefined ? "作品列表响应格式无法识别" : "平台错误码 " + code });
      } catch (_) { /* 无法辨认的列表不能当成成功。 */ }
    };
    page.on("response", listener);
  });
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout });
    if (isSphLoginUrl(page.url())) return { error: "助手跳转到了登录页" };
    const result = await pending;
    return isSphLoginUrl(page.url()) ? { error: "助手跳转到了登录页" } : result;
  } catch (_) {
    return { error: "无法打开视频号作品管理页" };
  } finally {
    clearTimeout(timer);
    page.off("response", listener);
  }
}

/** 平台任务生成是异步的；短暂轮询列表，同文案多条命中时留给人工核对。 */
export async function verifySphNativeScheduled(page, text, at, baseline) {
  for (let attempt = 0; attempt < 3 && Date.now() < at; attempt++) {
    if (attempt) await page.waitForTimeout(1500);
    const { items } = await readSphWorkList(page, { timeout: 10000 });
    const matches = (items || []).filter(item => matchesSphNativeScheduled(item, text, at, baseline));
    if (matches.length) return matches.length === 1;
  }
  return false;
}
