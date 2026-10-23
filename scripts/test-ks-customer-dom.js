"use strict";

// PR31 #issuecomment-6095673896 的原始 KS HTML，真实 Chromium DOM 离线回归。
// outerHTML 不含站点 CSS/事件，以下样式和筛选/选中事件都是明确的测试派生状态。
// 需要可用 Playwright + Chromium；NODE_PATH 可指向已有工具库，不更改应用依赖。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(__dirname, "fixtures/product-links/customer-ks-unselected.html"), "utf8");
const source = fs.readFileSync(path.join(root, "src/main/services/upLoad/ksProductLink.js"), "utf8");
const target = "【3瓶装】药都虎牌狼毒脚部液 足部护理60ml";
const css = `body{font:14px sans-serif} [class*="edit-form-item_"]{display:flex;align-items:center;gap:12px}
.ant-select{position:relative;display:inline-block}.ant-select-selector{display:flex;align-items:center;min-height:32px}
.ant-select-selection-search{position:absolute;left:0;top:0;width:100%}.ant-select-selection-search-input{width:100%;min-height:24px}
.ant-select-dropdown-hidden{display:none}.ant-select-dropdown{background:white;z-index:10}
.ant-select-item-option{min-height:48px;cursor:pointer}.ant-select-selection-item,.ant-select-selection-placeholder{min-height:24px}
img{max-height:48px;max-width:48px}`;

async function main() {
  const { inspectKsProductDom: inspect, attachKsProductLink: attach } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const browser = await chromium.launch({ headless: true,
    ...(process.env.MATRIXMEDIA_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.MATRIXMEDIA_TEST_BROWSER_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  let requestsBlocked = 0;
  await context.route("**/*", (route) => { requestsBlocked++; return route.abort(); });
  const page = await context.newPage();
  const probe = (phase) => page.evaluate(inspect, { phase, token: "customer", target });
  const load = () => page.setContent(`<style>${css}</style>${html}`, { waitUntil: "domcontentloaded" });
  async function open() {
    await page.evaluate((value) => {
      const root = document.querySelector(".ant-select-show-search");
      const input = root.querySelector('input[role="combobox"]');
      input.value = value; input.setAttribute("aria-expanded", "true");
      const popup = root.querySelector(".ant-select-dropdown");
      popup.classList.remove("ant-select-dropdown-hidden");
      popup.style.left = "0px"; popup.style.top = "32px";
    }, target);
  }
  async function compact() {
    await page.evaluate(() => {
      const holder = document.querySelector(".rc-virtual-list-holder");
      const inner = holder.querySelector(".rc-virtual-list-holder-inner");
      // 派生“完整名称筛选后只有一项”的 UI；原始 2268px 货架另有安全拒绝断言。
      [...inner.children].slice(1).forEach((node) => node.remove());
      inner.style.position = "relative"; inner.style.transform = "translateY(0px)";
      holder.firstElementChild.style.height = "auto";
    });
  }
  try {
    await load();
    const entry = await probe("discover");
    assert.equal(entry.ok, true, JSON.stringify(entry));
    assert.equal(await page.$eval(entry.inputSelector, (node) => node.id), "rc_select_5", "不能选左边类型 input");
    assert.equal(await page.$eval(entry.selector, (node) => node.className), "ant-select-selector");
    await open();
    const fullList = await probe("options");
    assert.match(fullList.reason, /未完整展开/, "overflow:hidden 的2268px虚拟货架仍必须拒绝");
    await compact();
    assert.equal((await probe("options")).ok, true, "完整紧凑结果可选；零尺寸ARIA缓存不能充当视觉候选");
    await page.evaluate(() => {
      const inner = document.querySelector(".rc-virtual-list-holder-inner");
      inner.append(inner.firstElementChild.cloneNode(true));
    });
    assert.match((await probe("options")).reason, /同名/, "完整结果里有两个同名条目不能选首个");
    await page.evaluate(() => document.querySelector(".rc-virtual-list-holder-inner").lastElementChild.remove());
    await page.evaluate(() => document.querySelector(".rc-virtual-list-holder-inner").style.transform = "translateY(80px)");
    assert.match((await probe("options")).reason, /未完整展开/, "虚拟偏移不能被当作完整列表");
    await page.evaluate(() => document.querySelector(".rc-virtual-list-holder-inner").style.transform = "translateY(0px)");
    await page.evaluate(() => document.querySelector(".ant-select-item-option").setAttribute("aria-disabled", "true"));
    assert.match((await probe("options")).reason, /不可选/);
    await page.evaluate(() => document.querySelector(".ant-select-item-option").removeAttribute("aria-disabled"));
    await page.evaluate(() => document.querySelector(".ant-select-show-search input").value = "部分名称");
    assert.match((await probe("options")).reason, /完整商品名搜索/, "禁止搜索前的陈旧候选");
    await page.evaluate((value) => document.querySelector(".ant-select-show-search input").value = value, target);
    await page.evaluate(() => document.querySelector('[class*="_goods-title_"]').textContent = "不完整…");
    assert.match((await probe("options")).reason, /不能确认完整匹配/, "label与可见完整原文冲突必须拒绝");
    await page.evaluate((value) => {
      const root = document.querySelector(".ant-select-show-search");
      root.querySelector("input").setAttribute("aria-expanded", "false");
      root.querySelector(".ant-select-dropdown").classList.add("ant-select-dropdown-hidden");
      root.querySelector("input").value = value;
    }, target);
    assert.equal((await probe("selected")).ok, false, "输入的检索词不是选中结果");
    await page.evaluate((value) => {
      const root = document.querySelector(".ant-select-show-search");
      root.querySelector(".ant-select-selection-placeholder").remove();
      const selected = document.createElement("span");
      selected.className = "ant-select-selection-item"; selected.textContent = value;
      root.querySelector(".ant-select-selector").append(selected);
      root.querySelector("input").value = "";
    }, target);
    assert.equal((await probe("selected")).ok, true, "同一商品入口回显全名并闭合才能通过");

    // 实际 attach 序列：使用真实 DOM + 明确派生的 input/click 事件，不替换生产 probe。
    await load();
    await page.evaluate((value) => {
      const root = document.querySelector(".ant-select-show-search");
      const input = root.querySelector("input");
      const popup = root.querySelector(".ant-select-dropdown");
      const holder = popup.querySelector(".rc-virtual-list-holder");
      const inner = holder.querySelector(".rc-virtual-list-holder-inner");
      window.__ksOptionClicks = 0;
      root.querySelector(".ant-select-selector").addEventListener("click", () => {
        input.setAttribute("aria-expanded", "true");
        popup.classList.remove("ant-select-dropdown-hidden");
        popup.style.left = "0px"; popup.style.top = "32px";
      });
      input.addEventListener("input", () => {
        if (input.value !== value) return;
        [...inner.children].slice(1).forEach((node) => node.remove());
        inner.style.position = "relative"; inner.style.transform = "translateY(0px)";
        holder.firstElementChild.style.height = "auto";
      });
      inner.firstElementChild.addEventListener("click", (event) => {
        event.stopPropagation(); window.__ksOptionClicks++;
        input.setAttribute("aria-expanded", "false");
        popup.classList.add("ant-select-dropdown-hidden");
        root.querySelector(".ant-select-selection-placeholder").remove();
        const selected = document.createElement("span");
        selected.className = "ant-select-selection-item"; selected.textContent = value;
        root.querySelector(".ant-select-selector").append(selected); input.value = "";
      });
    }, target);
    const attached = await attach(page, { enabled: true, type: "product", inputKind: "product_name", value: target });
    assert.equal(attached.value, target);
    assert.equal(await page.evaluate(() => window.__ksOptionClicks), 1);
    assert.equal(await page.locator("[data-mm-ks-product]").count(), 0, "结束清除本次标记");
    console.log(JSON.stringify({ result: "passed", browser: browser.version(), requestsBlocked,
      source: "PR31 issuecomment-6095673896", realAccountVerified: false,
      note: "买方HTML + 明示CSS/派生状态回归；不证明平台搜索或挂载已经实机通过" }));
  } finally { await context.close(); await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
