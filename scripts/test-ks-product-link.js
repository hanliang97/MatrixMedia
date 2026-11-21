"use strict";

// 只验证离线控制流与发布门禁，不是快手真实 DOM、账号权限或实际发布验收。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const moduleSource = fs.readFileSync(path.join(root, "src/main/services/upLoad/ksProductLink.js"), "utf8");
const link = { enabled: true, type: "product", inputKind: "product_name", value: "完整商品名称 60ml" };

function pageFor(failurePhase, reason) {
  const events = [];
  const page = {
    events,
    keyboard: { type: async () => {} },
    waitForSelector: async () => {},
    $: async () => ({ uploadFile: async () => {}, click: async () => {} }),
    click: async (selector) => { events.push(["click", selector]); },
    waitForTimeout: async () => {},
    waitForFunction: async (_, __, text) => { events.push(["ready-submit", text]); },
    evaluate: async (fn, arg) => {
      if (arg && typeof arg === "object" && arg.phase) {
        events.push(["probe", arg.phase]);
        if (arg.phase === failurePhase) return { ok: false, reason };
        if (arg.phase === "discover") return { ok: true, selector: "[data-test=entry]" };
        if (arg.phase === "options") return { ok: true, selector: "[data-test=product]" };
        if (arg.phase === "selected") return { ok: true, value: arg.target };
        return { ok: true };
      }
      events.push(["submit", arg]);
      return { ok: true, via: "offline-harness" };
    },
  };
  return page;
}

async function main() {
  const { attachKsProductLink, inspectKsProductDom } = await import(url(moduleSource));
  for (const badLink of [null, {}, { ...link, enabled: false }, { ...link, type: "other" },
    { ...link, inputKind: "url" }, { ...link, value: "" }, { ...link, value: "商品\n名" },
    { ...link, value: "商".repeat(201) }]) {
    const page = pageFor();
    await assert.rejects(attachKsProductLink(page, badLink), /完整原名/);
    assert.equal(page.events.length, 0, "无效输入不能操作页面");
  }
  for (const [phase, reason] of [
    ["discover", "无法唯一定位可见的作者服务行"],
    ["options", "存在同名商品，不能自动选择"],
    ["options", "商品名称原文含省略号，不能确认完整名称"],
    ["options", "未找到完整名称精确匹配的可见商品"],
    ["selected", "商品入口未回显完整目标名称"],
  ]) {
    const page = pageFor(phase, reason);
    await assert.rejects(attachKsProductLink(page, link), new RegExp(reason));
    assert.deepEqual(page.events.at(-1), ["probe", "cleanup"]);
    if (phase !== "selected") assert.ok(!page.events.some((x) => x[1] === "[data-test=product]"));
  }
  const success = pageFor();
  assert.deepEqual(await attachKsProductLink(success, link), {
    type: "product", value: link.value, label: link.value,
  });
  assert.deepEqual(success.events, [
    ["probe", "discover"], ["click", "[data-test=entry]"], ["probe", "options"],
    ["click", "[data-test=product]"], ["probe", "selected"], ["probe", "cleanup"],
  ]);

  // 小型标准 ARIA 契约模型，只执行真实 DOM 检查函数的匹配分支。
  // 这是合成单元测试，不声称代表快手当前 HTML 或平台实测。
  class Element {
    constructor(label = "", attrs = {}) {
      this.label = label; this.attrs = attrs; this.children = []; this.parentElement = null;
      this.tagName = "DIV"; this.nodeType = 1; this.isConnected = true;
      this.scrollWidth = 600; this.clientWidth = 100; // 模拟 CSS 省略但保留完整 DOM 原文。
    }
    append(child) { this.children.push(child); child.parentElement = this; return child; }
    get innerText() { return this.label || this.children.map((x) => x.innerText).join(" "); }
    getAttribute(key) { return this.attrs[key] || null; }
    hasAttribute(key) { return key in this.attrs; }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    getBoundingClientRect() { return { width: 100, height: 20 }; }
    contains(node) { return node === this || this.children.some((x) => x.contains(node)); }
    matches(selector) {
      return selector.split(",").some((s) => {
        if (s === "*") return true;
        const match = s.match(/^\[([^=]+)="([^"]+)"\]$/);
        if (match) return this.getAttribute(match[1]) === match[2];
        return this.tagName.toLowerCase() === s;
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      for (let p = this; p; p = p.parentElement) if (p.matches(selector)) return p;
      return null;
    }
  }
  const originalDocument = global.document;
  const originalStyle = global.getComputedStyle;
  try {
    const doc = new Element();
    const body = doc.append(new Element());
    doc.body = body;
    doc.getElementById = (id) => doc.querySelector(`[id="${id}"]`);
    const trigger = body.append(new Element("", { "data-mm-ks-product": "unit-trigger", "aria-controls": "products" }));
    const popup = body.append(new Element("", { id: "products", role: "listbox" }));
    const option = popup.append(new Element("", { role: "option" }));
    const label = option.append(new Element(link.value));
    global.document = doc;
    global.getComputedStyle = (node) => ({ display: "block", visibility: "visible", opacity: "1", cursor: "default", overflowY: node.overflowY || "visible" });
    const inspect = (target = link.value) => inspectKsProductDom({ phase: "options", token: "unit", target });
    assert.equal(inspect().ok, true, "CSS clipping 不应否定已完整匹配的 DOM 原文");
    label.label = "完整商品名称…";
    assert.equal(inspect().ok, false, "字面截断不得做包含匹配");
    assert.match(inspect(label.label).reason, /省略号/, "用户也填写省略名时仍拒绝");
    label.label = link.value;
    const duplicate = popup.append(new Element("", { role: "option" }));
    duplicate.append(new Element(link.value));
    assert.match(inspect().reason, /同名/, "可见同名选项不得选第一个");
    duplicate.attrs["aria-hidden"] = "true";
    assert.equal(inspect().ok, true, "隐藏 ARIA 副本不算第二个可见选项");
    popup.overflowY = "auto";
    popup.clientHeight = 100;
    popup.scrollHeight = 300;
    assert.match(inspect().reason, /未完整展开/, "可滚动列表无法证明无隐藏同名项，必须停止");
    popup.overflowY = "visible";
    option.attrs["aria-setsize"] = "10";
    assert.match(inspect().reason, /未完整展开/, "ARIA 总量大于已展示选项时不能当作唯一");
    trigger.append(new Element(link.value));
    const selected = () => inspectKsProductDom({ phase: "selected", token: "unit", target: link.value });
    assert.equal(selected().ok, false, "下拉仍可见时不能把选项文字当作选中成功");
    popup.hidden = true;
    assert.equal(selected().ok, true, "同一入口的完整名称回显且下拉关闭才可通过");
    trigger.children = [];
    const searchInput = trigger.append(new Element());
    searchInput.tagName = "INPUT";
    searchInput.value = link.value;
    assert.equal(selected().ok, false, "搜索输入值不能冒充选中回显");
  } finally {
    if (originalDocument === undefined) delete global.document; else global.document = originalDocument;
    if (originalStyle === undefined) delete global.getComputedStyle; else global.getComputedStyle = originalStyle;
  }

  // 原样执行 ks.js 的发布分支，只替换外部系统依赖；挂车模块使用真实实现。
  const imports = {
    "./ksProductLink.js": url(moduleSource),
    "./publishOutcome.js": url(`
      export const readPageUrl=()=>"https://offline.invalid/publish";
      export async function replyPublishFailure(data){globalThis.__ksProductTest.push({kind:"failure",...data});}
      export async function replyPublishOutcome(data){globalThis.__ksProductTest.push({kind:"outcome",...data});}
    `),
    "../../../shared/creativeStatement.js": url(`export const isCreativeStatementNone=()=>true; export const resolveKsCreativeStatementLabel=()=>"";`),
    "../../../shared/videoMetadata.js": url(`export const buildPlatformVideoText=()=>({description:""});`),
    "../../../shared/videoLink.js": url(`export const resolveVideoLinkOption=(_,options)=>options?.link||{enabled:false};`),
    "./uploadTimeouts.js": url(`export const WAIT_SELECTOR_APPEAR_MS=1; export const WAIT_UPLOAD_PROCESSING_MS=1; export const pollPageUntil=async()=>{};`),
  };
  let publisherSource = fs.readFileSync(path.join(root, "src/main/services/upLoad/ks.js"), "utf8");
  for (const [specifier, replacement] of Object.entries(imports)) {
    assert.ok(publisherSource.includes(`"${specifier}"`), `dependency exists: ${specifier}`);
    publisherSource = publisherSource.replace(`"${specifier}"`, `"${replacement}"`);
  }
  const publish = (await import(url(publisherSource))).default;
  const oldLog = console.log;
  const oldError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    for (const publishMode of ["publish", "draft"]) {
      for (const phase of ["discover", "options", "selected"]) {
        globalThis.__ksProductTest = [];
        const page = pageFor(phase, "挂车状态无法确认");
        await publish(page, { filePath: "/offline/sample.mp4", data: {}, publishMode, publishOptions: { link } }, {}, {});
        assert.ok(!page.events.some((x) => x[0] === "submit"), `${publishMode}: ${phase} 失败不能点发布/取消`);
        assert.equal(globalThis.__ksProductTest.length, 1);
        assert.equal(globalThis.__ksProductTest[0].kind, "failure");
        assert.equal(globalThis.__ksProductTest[0].extraPayload.outcome, "product_link_failed");
      }
      for (const configuredLink of [undefined, link]) {
        globalThis.__ksProductTest = [];
        const page = pageFor();
        await publish(page, { filePath: "/offline/sample.mp4", data: {}, publishMode, publishOptions: { link: configuredLink } }, {}, {});
        assert.deepEqual(page.events.filter((x) => x[0] === "submit"), [["submit", publishMode === "draft" ? "取消" : "发布"]]);
        assert.equal(globalThis.__ksProductTest.length, 1);
        assert.equal(globalThis.__ksProductTest[0].kind, "outcome");
        const selection = page.events.findIndex((x) => x[0] === "probe" && x[1] === "selected");
        if (configuredLink) assert.ok(selection < page.events.findIndex((x) => x[0] === "submit"));
        else assert.equal(selection, -1, "无挂车配置不执行选品逻辑");
      }
    }
  } finally {
    delete globalThis.__ksProductTest;
    console.log = oldLog;
    console.error = oldError;
  }
  console.log("test-ks-product-link passed（离线失败门禁/顺序/无挂车回归；未验证真实 DOM）");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
