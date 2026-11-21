"use strict";

const TIME_INPUT = 'input[placeholder="日期和时间"]';

/** 抖音创作者后台实测：2 小时后、14 天内，精确到分钟。 */
export function validateDyNativeScheduleAt(value, nowMs = Date.now()) {
  const at = Number(value);
  if (!Number.isFinite(at) || Number.isNaN(new Date(at).getTime()) || at % 60000 !== 0) {
    return { ok: false, error: "抖音原生定时需要有效时间，秒数必须为 00" };
  }
  const delta = at - nowMs;
  if (delta < 2 * 3600000 || delta > 14 * 86400000) {
    return { ok: false, error: "抖音原生定时仅支持 2 小时后至 14 天内" };
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(at));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { ok: true, at, text: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` };
}

/** 所有输入均通过控件事件提交；输入后同时校验 React 回写的属性值和勾选状态。 */
export async function prepareDyNativeSchedule(page, value) {
  const target = validateDyNativeScheduleAt(value);
  if (!target.ok) throw new Error(target.error);
  await page.emulateTimezone("Asia/Shanghai");
  const client = await page.target().createCDPSession();
  try {
    // 隐藏 Electron 窗口下 DOM focus 不等于浏览器获得焦点，CDP 输入会静默丢失。
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    const selected = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("label")].filter(el =>
        el.getClientRects().length > 0 && String(el.textContent || "").trim() === "定时发布"
      );
      if (labels.length !== 1) return false;
      const input = labels[0].querySelector("input");
      if (!input || input.disabled) return false;
      if (!input.checked) labels[0].click();
      return true;
    });
    if (!selected) throw new Error("未找到可用的抖音原生定时控件，已停止发布");
    await page.waitForSelector(TIME_INPUT, { timeout: 10000 });
    await page.evaluate(selector => {
      const input = document.querySelector(selector);
      input.focus();
      input.select();
    }, TIME_INPUT);
    // 一次插入完整日期，避免按键逐字输入时控件反复恢复旧值。
    await page.keyboard.sendCharacter(target.text);
    await page.keyboard.press("Tab");
    await assertDyNativeSchedule(page, value);
    return client;
  } catch (error) {
    await client.detach().catch(() => {});
    throw error;
  }
}

/** 点击发布前重读一次，任何控件重置或时间过期都必须中止。 */
export async function assertDyNativeSchedule(page, value) {
  const target = validateDyNativeScheduleAt(value);
  if (!target.ok) throw new Error(target.error);
  const matched = await page.evaluate((selector, expected) => {
    const input = document.querySelector(selector);
    const labels = [...document.querySelectorAll("label")];
    const selected = text => labels.filter(el =>
      el.getClientRects().length > 0 && String(el.textContent || "").trim() === text
    );
    const native = selected("定时发布");
    const immediate = selected("立即发布");
    return Boolean(input && !input.disabled && input.value === expected &&
      input.getAttribute("value") === expected &&
      native.length === 1 && native[0].querySelector("input")?.checked === true &&
      immediate.length === 1 && immediate[0].querySelector("input")?.checked === false);
  }, TIME_INPUT, target.text);
  if (!matched) throw new Error(`抖音原生定时时间回读不符（期望北京时间 ${target.text}），已停止发布`);
  return target;
}

/** 只接受后台实际使用的成功作品列表，不从页面文案或 create_time 推测排期。 */
export function dyWorkListItems(json) {
  if (!json || json.status_code !== 0 || !Array.isArray(json.aweme_list)) return null;
  return json.aweme_list;
}

export function matchesDyNativeScheduled(item, title, value, { excludedIds = [], expectedId = "" } = {}) {
  const at = Number(value);
  if (!Number.isFinite(at) || at % 60000 !== 0 || !item) return false;
  const id = item.aweme_id;
  // item_id 在 JSON 中是大整数，可能丢精度；只使用字符串 aweme_id。
  if (typeof id !== "string" || !/^\d+$/.test(id) || excludedIds.includes(id) ||
    (expectedId && id !== expectedId)) return false;
  return String(item.item_title || "").trim() === String(title || "").trim() &&
    Boolean(String(title || "").trim()) &&
    item.timer?.public_time === at / 1000 && item.timer?.status === 0 &&
    item.status?.is_delete === false && item.status?.is_prohibited === false;
}

/** 导航前挂响应监听，导航后重新读取列表，避免错过首次响应。 */
export async function readDyWorkList(page, navigate, timeoutMs = 30000) {
  let timer;
  let onResponse;
  const pending = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    onResponse = async response => {
      try {
        const url = new URL(response.url());
        if (url.origin !== "https://creator.douyin.com" ||
          url.pathname !== "/janus/douyin/creator/pc/work_list" || response.status() !== 200) return;
        const items = dyWorkListItems(await response.json());
        if (items) resolve(items);
      } catch (_) { /* 解析失败保持待核对，不可降级为成功。 */ }
    };
    page.on("response", onResponse);
  });
  try {
    await navigate();
    return await pending;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
    page.off("response", onResponse);
  }
}

/** 同名、精确排期且提交前列表中没有的新作品才确认；也可按已知作品 ID 只读复核。 */
export async function verifyDyNativeScheduled(page, title, value, options = {}) {
  try {
    await page.waitForFunction(() => location.pathname.startsWith("/creator-micro/content/manage"),
      { timeout: 30000, polling: 200 });
    const items = await readDyWorkList(page, () => page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }));
    return Boolean(items && items.some(item => matchesDyNativeScheduled(item, title, value, options)));
  } catch (_) {
    return false;
  }
}
