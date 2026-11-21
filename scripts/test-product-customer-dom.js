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
const ksSourceRoot = process.env.MATRIXMEDIA_KS_SOURCE_ROOT || sourceRoot;
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
const dy = productionFunction("src/main/services/upLoad/dyProductLink.js", "dyProductLinkDom", dySourceRoot);
const ks = productionFunction("src/main/services/upLoad/ksProductLink.js", "inspectKsProductDom", ksSourceRoot);
const dyHtml = fs.readFileSync(path.join(fixtureRoot, "customer-dy-selected.html"), "utf8");
const ksHtml = fs.readFileSync(path.join(fixtureRoot, "customer-ks-unselected.html"), "utf8");
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
    await load(ksHtml);
    const entry = await result(page, ks, { phase: "discover", token: "fixture", target: "【3瓶装】药都虎牌狼毒脚部液 足部护理60ml" });
    results.push({ name: "ks-customer-exact-entry", ...entry });
    // 原始真实DOM的入口测试，不用 mock querySelector/compareDocumentPosition/getComputedStyle。
    if (!baseline) assert.equal(entry.value && entry.value.ok, true, JSON.stringify(entry));
    if (entry.value && entry.value.ok) {
      await page.evaluate(() => {
        const input = document.getElementById("rc_select_5");
        input.value = "【3瓶装】药都虎牌狼毒脚部液 足部护理60ml";
        input.setAttribute("aria-expanded", "true");
        const popup = document.querySelector(".ant-select-dropdown");
        popup.classList.remove("ant-select-dropdown-hidden"); popup.style.left = "0px"; popup.style.top = "32px";
      });
      const dimensions = await page.evaluate(() => {
        const h = document.querySelector(".rc-virtual-list-holder");
        return {clientHeight:h.clientHeight, scrollHeight:h.scrollHeight, overflowY:getComputedStyle(h).overflowY};
      });
      assert.ok(dimensions.scrollHeight > dimensions.clientHeight, "真实片段保留被截断的虚拟列表几何");
      const partial = await result(page, ks, {phase:"options",token:"fixture",target:"【3瓶装】药都虎牌狼毒脚部液 足部护理60ml"});
      results.push({name:"ks-customer-hidden-overflow-partial-shelf",...partial,dimensions});
      if (!baseline) assert.equal(partial.value && partial.value.ok,false,"虚拟货架尚不完整时不能把挂载项唯一当整表唯一");
      if (baseline) assert.equal(partial.value && partial.value.ok,true,"旧版未拦截 overflow:hidden 的不完整虚拟货架");
      if (!baseline) {
        // 明确派生已完成过滤状态：只保留目标选项，虚拟总高度同步为一项。
        // 这不是声称买方账号已经实现/验证了搜索事件。
        await page.evaluate(() => {
          const inner = document.querySelector(".rc-virtual-list-holder-inner");
          const keep = inner.firstElementChild;
          [...inner.children].slice(1).forEach(el => el.remove());
          inner.parentElement.style.height = "64px";
          keep.style.height = "64px";
          document.querySelector(".rc-virtual-list-holder").style.height = "64px";
        });
        const filtered = await result(page,ks,{phase:"options",token:"fixture",target:"【3瓶装】药都虎牌狼毒脚部液 足部护理60ml"});
        results.push({name:"ks-derived-complete-filtered-option",...filtered});
        assert.equal(filtered.value && filtered.value.ok,true,JSON.stringify(filtered));
        // 无身份信息可消歧的同名项，即使当前区域完整，也不得选首项。
        await page.evaluate(() => {
          const inner = document.querySelector(".rc-virtual-list-holder-inner");
          const copy = inner.firstElementChild.cloneNode(true); copy.removeAttribute("data-mm-ks-product"); inner.append(copy);
          inner.parentElement.style.height = "128px";document.querySelector(".rc-virtual-list-holder").style.height = "128px";
        });
        const duplicate = await result(page,ks,{phase:"options",token:"fixture",target:"【3瓶装】药都虎牌狼毒脚部液 足部护理60ml"});
        results.push({name:"ks-derived-duplicate-filtered-option",...duplicate});
        assert.equal(duplicate.value && duplicate.value.ok,false);
        assert.match(duplicate.value.reason,/同名/);
        // 占位消失、同一商品控件回显、关联弹层关闭；保留隐藏ARIA/视觉候选。
        await page.evaluate(() => {
          const input = document.getElementById("rc_select_5"); input.setAttribute("aria-expanded","false");input.value="";
          const root = input.closest(".ant-select");
          root.querySelector(".ant-select-dropdown").classList.add("ant-select-dropdown-hidden");
          root.querySelector(".ant-select-selection-placeholder").remove();
          const label = document.createElement("span"); label.className="ant-select-selection-item";
          label.textContent="【3瓶装】药都虎牌狼毒脚部液 足部护理60ml"; root.querySelector(".ant-select-selector").append(label);
        });
        const confirmed = await result(page,ks,{phase:"selected",token:"fixture",target:"【3瓶装】药都虎牌狼毒脚部液 足部护理60ml"});
        results.push({name:"ks-derived-own-control-closed-echo",...confirmed});
        assert.equal(confirmed.value && confirmed.value.ok,true,JSON.stringify(confirmed));
        await page.evaluate(() => {document.querySelectorAll(".ant-select-selection-item")[1].textContent="其他商品";});
        const wrong = await result(page,ks,{phase:"selected",token:"fixture",target:"【3瓶装】药都虎牌狼毒脚部液 足部护理60ml"});
        assert.equal(wrong.value && wrong.value.ok,false,"隐藏下拉的目标不能代替当前回显");
        results.push({name:"ks-derived-wrong-echo-hidden-target",...wrong});
      }

    }
    console.log(JSON.stringify({ baseline, sourceRoot, dySourceRoot, ksSourceRoot, node: process.version, chromium: browser.version(), results, blockedRequests: blockedRequests.length, note: "HTML-only regression; fixture CSS and state transitions are explicit, no real account acceptance." }, null, 2));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
