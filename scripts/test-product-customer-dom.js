"use strict";
// 买方 HTML 在独立 Chromium DOM 内执行生产函数；不访问平台、账号或发布入口。
// 需要可用 Playwright + Chromium；可用 NODE_PATH 指向外置验证工具，不更改应用依赖。
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const sourceRoot = process.env.MATRIXMEDIA_PRODUCT_SOURCE_ROOT || path.resolve(__dirname, "..");
const fixtureRoot = path.join(__dirname, "fixtures", "product-links");
const dySourceRoot = process.env.MATRIXMEDIA_DY_SOURCE_ROOT || sourceRoot;
const baseline = process.argv.includes("--baseline");
function productionFunction(relative, name, platformRoot = sourceRoot) {
  const source = fs.readFileSync(path.join(platformRoot, relative), "utf8");
  const start = source.indexOf(`export function ${name}(`);
  const end = source.indexOf("\nexport async function ", start);
  const privateAsync = source.indexOf("\nasync function ", start);
  const stop = Math.min(...[end, privateAsync, source.length].filter((n) => n >= 0));
  if (start < 0) throw new Error(`Missing production export: ${name}`);
  return Function(source.slice(start, stop).replace(/^export /, "") + `\nreturn ${name};`)();
}
// 快手商品挂载暂缓合入（#31 待实机校验），本测试只回归抖音买方 DOM。
const dy = productionFunction("src/main/services/upLoad/dyProductLink.js", "dyProductLinkDom", dySourceRoot);
const dyHtml = fs.readFileSync(path.join(fixtureRoot, "customer-dy-selected.html"), "utf8");
// 买方只给 outerHTML，无站点 CSS。以下只建立可见盒和控件并排几何，绝不改 DOM/ARIA。
const css = `body{font:14px sans-serif} [class*="anchor-container-"]{display:flex;align-items:center;gap:12px}
.semi-select{display:inline-flex;min-width:120px;height:32px;align-items:center}
[class*="input-"]{display:inline-flex;align-items:center;gap:8px}input{min-height:24px}
[class*="edit-form-item_"]{display:flex;align-items:center;gap:12px}
.ant-select{position:relative;display:inline-block}.ant-select-selector{display:flex;align-items:center;min-height:32px}
.ant-select-selection-search{position:absolute;left:0;top:0}.ant-select-selection-search-input{width:100%}
.ant-select-dropdown-hidden{display:none}.ant-select-dropdown{background:white;z-index:10}
.ant-select-item-option{min-height:48px;cursor:pointer}.ant-select-selection-item,.ant-select-selection-placeholder{min-height:24px}
img{max-height:48px;max-width:48px}`;
async function result(page, fn, arg) {
  try { return { value: await page.evaluate(fn, arg) }; }
  catch (error) { return { error: error.message.split("\n")[0] }; }
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.MATRIXMEDIA_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.MATRIXMEDIA_TEST_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const blockedRequests = [];
  await context.route("**/*", route => { blockedRequests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const results = [];
  async function load(html) { await page.setContent(`<style>${css}</style>${html}`, { waitUntil: "domcontentloaded" }); }
  try {
    await load(dyHtml);
    const selected = await result(page, dy, { action: "prepareCart" });
    assert.equal(selected.value && selected.value.selected, true, "买方原快照购物车已选，不能声称复现之前的入口失败");
    results.push({ name: "dy-customer-exact-selected", ...selected });
    // 派生未选状态：真实 Semi 容器保持不变，仅移除已经选中后出现的商品输入区。
    await page.evaluate(() => {
      document.querySelector(".semi-select-selection-text").textContent = "不添加";
      document.getElementById("douyin_creator_pc_anchor_jump").remove();
      window.__clicks = 0;
      document.querySelector(".semi-select").addEventListener("click", () => window.__clicks++);
    });
    const initial = await result(page, dy, { action: "prepareCart" });
    results.push({ name: "dy-derived-unselected-semi", ...initial });
    if (baseline) assert.match(initial.error || "", /无法确认添加标签下拉行/);
    else { assert.equal(initial.value && initial.value.ready, true); assert.equal(await page.evaluate(() => window.__clicks), 1); }
    await load(dyHtml);
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder="粘贴商品链接"]'); input.value = "https://example.com/product";
      window.__clicks = 0; document.querySelector('[class*="cart-mybtn-disable-"]').addEventListener("click", () => window.__clicks++);
    });
    const disabled = await result(page, dy, { action: "addLink", value: "https://example.com/product" });
    const disabledClicks = await page.evaluate(() => window.__clicks);
    results.push({ name: "dy-customer-disabled-span", ...disabled, clicks: disabledClicks });
    if (baseline) { assert.equal(disabled.value && disabled.value.ready, true); assert.equal(disabledClicks, 1); }
    else { assert.equal(disabled.value && disabled.value.ready, false); assert.equal(disabledClicks, 0); }
    console.log(JSON.stringify({ baseline, sourceRoot, dySourceRoot, ksSourceRoot, node: process.version, chromium: browser.version(), results, blockedRequests: blockedRequests.length, note: "HTML-only regression; fixture CSS and state transitions are explicit, no real account acceptance; ks part deferred to #31." }, null, 2));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
