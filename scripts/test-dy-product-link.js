"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const toModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

// 小型 DOM 测试桩执行真实 evaluate 函数。另载入客户原始 HTML 保留真实嵌套/属性；
// 布局、事件和编辑/成功阶段仍是桩，不等同于真实账号端到端验收。
class Element {
  constructor(tag = "div", label = "", attrs = {}) {
    this.tagName = tag.toUpperCase(); this.label = label; this.attrs = attrs;
    this.children = []; this.parentElement = null; this.hidden = false;
    this.disabled = false; this.readOnly = false; this.top = 100;
  }
  append(...children) {
    for (const child of children) { child.parentElement = this; this.children.push(child); }
    return this;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((el) => el !== this);
    this.parentElement = null;
  }
  get textContent() { return this.label + this.children.map((el) => el.textContent).join(""); }
  get innerText() { return this.textContent; }
  getAttribute(key) { return this.attrs[key] == null ? null : this.attrs[key]; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() { return { top: this.top, bottom: this.top + 30 }; }
  querySelectorAll(selector) {
    const nodes = this.children.flatMap((el) => [el, ...el.querySelectorAll("*")]);
    return selector === "*" ? nodes : nodes.filter((el) => ["INPUT", "TEXTAREA"].includes(el.tagName));
  }
  click() { if (this.onClick) this.onClick(); else if (this.parentElement) this.parentElement.click(); }
  focus() {}
  dispatchEvent(event) { if (this.onEvent) this.onEvent(event); }
}
class Input extends Element {
  constructor(placeholder) { super("input", "", { placeholder }); this._value = ""; }
  set value(value) { this._value = value; }
  get value() { return this._value; }
}
class Select extends Element {
  constructor() { super("select"); this._value = "none"; }
  set value(value) { this._value = value; }
  get value() { return this._value; }
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter((el) => el.value === this.value); }
}

const originalTitle = "测试商品原始标题";
const link = { enabled: true, type: "product", value: "https://haohuo.jinritemai.com/item?id=0009007199254740993", shortTitle: "视频同款商品" };

function fixture(mode = "success") {
  const document = new Element("document");
  document.body = new Element("body"); document.append(document.body);
  document.getElementById = (id) => document.querySelectorAll("*").find((el) => el.getAttribute("id") === id) || null;
  const main = new Element(); document.body.append(main);
  const row = new Element(); main.append(row);
  const input = new Input("粘贴商品链接");
  const cart = new Element("span", "购物车");
  const add = new Element("button", "添加链接");
  row.append(cart, input, add);
  const trace = [];
  const addCard = (title = originalTitle, shortTitle = link.shortTitle, count = 1) => {
    main.append(new Element("div", `已添加商品（${count}）`));
    const card = new Element();
    card.append(new Element("div", title), new Element("div", `短标题：${shortTitle}`),
      new Element("button", "编辑"), new Element("button", "移除"));
    main.append(card);
  };
  const addError = (reason) => document.body.append(new Element().append(
    new Element("h2", "未搜索到对应商品"), new Element("p", reason), new Element("button", "确定")));
  add.onClick = () => {
    trace.push("add");
    if (mode === "timeout") return;
    if (mode === "platformError") { addError("商品为平台测试商品，暂不支持添加推广"); return; }
    const modal = new Element();
    const short = new Input("请输入商品短标题");
    const complete = new Element("button", "完成编辑"); complete.disabled = true;
    // 内层 span 是按钮文案时，也必须尊重外层原生 button 的 disabled。
    if (mode === "disabledComplete") { complete.label = ""; complete.append(new Element("span", "完成编辑")); }
    const title = new Element().append(new Element("label", "商品原标题"), new Element("p", originalTitle));
    modal.append(new Element("h2", "编辑商品"), title, short, complete);
    document.body.append(modal);
    short.onEvent = () => { if (mode !== "disabledComplete") complete.disabled = !short.value; };
    complete.onClick = () => {
      trace.push("complete"); modal.remove();
      addCard(mode === "wrongProduct" ? "另一个商品" : originalTitle,
        mode === "wrongShortTitle" ? "另一个短标题" : link.shortTitle,
        mode === "multipleCards" ? 2 : 1);
      if (mode === "errorWithCard") addError("该商品的推广状态已关闭");
    };
    if (mode === "ambiguousModal") modal.append(new Input("请输入商品短标题"));
  };
  if (mode === "oldCard") addCard();
  if (mode === "duplicateLinkInput") row.append(new Input("粘贴商品链接"));
  if (mode === "hiddenDuplicate") { const hidden = new Input("粘贴商品链接"); hidden.hidden = true; row.append(hidden); }
  if (mode === "wrongRow") cart.top = 300;
  if (mode === "disabledAdd") add.disabled = true;
  if (mode === "titleAlreadyOpen") document.body.append(new Input("请输入商品短标题"));
  if (["initialCart", "ambiguousCart", "noSemanticDropdown", "wrongDropdownRow", "missingCartOption"].includes(mode)) {
    input.remove(); add.remove();
    const label = new Element("label", "添加标签"); row.append(label);
    cart.label = "无";
    if (mode !== "noSemanticDropdown") cart.attrs = { role: "combobox", "aria-controls": "tag-options" };
    if (mode === "wrongDropdownRow") cart.top = 300;
    cart.onClick = () => {
      trace.push("openCart");
      const popup = new Element("div", "", { role: "listbox", id: "tag-options" });
      const option = new Element("div", mode === "missingCartOption" ? "其他" : "购物车", { role: "option" });
      option.onClick = () => { trace.push("chooseCartOption"); popup.remove(); cart.label = "购物车"; row.append(input, add); };
      popup.append(option);
      if (mode === "ambiguousCart") popup.append(new Element("div", "购物车", { role: "option" }));
      document.body.append(popup);
    };
  }
  if (mode === "nativeCart") {
    cart.remove(); input.remove(); add.remove();
    const control = new Select();
    const none = new Element("option", "无"); none.value = "none"; none.hidden = true;
    const option = new Element("option", "购物车"); option.value = "cart"; option.hidden = true;
    control.append(none, option);
    control.onEvent = (event) => { if (event.type === "change") row.append(input, add); };
    row.append(new Element("label", "添加标签"), control);
  }
  const page = {
    async evaluate(fn, request) {
      trace.push(request.action);
      global.document = document;
      global.getComputedStyle = (el) => ({ display: el.hidden ? "none" : "block", visibility: "visible", opacity: "1" });
      global.HTMLInputElement = Input; global.HTMLTextAreaElement = Input; global.HTMLSelectElement = Select;
      return fn(request);
    },
    async waitForTimeout() {},
  };
  return { page, trace, input, document, main, row, add };
}

// 仅解析随测试保存的客户 HTML（不执行脚本、不联网），不作为应用的 HTML 解析器。
function parseCustomerHtml(html) {
  const root = new Element();
  const stack = [root];
  for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (token.startsWith("<")) {
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const attrs = {};
      for (const match of token.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[match[1]] = match[2];
      const el = tag === "input" ? new Input(attrs.placeholder) : new Element(tag);
      el.attrs = attrs;
      if (tag === "input") el.value = attrs.value || "";
      stack.at(-1).append(el);
      if (!["input", "img", "br", "hr", "meta", "link"].includes(tag) && !token.endsWith("/>")) stack.push(el);
    } else {
      stack.at(-1).label += token;
    }
  }
  assert.equal(stack.length, 1, "customer fixture tags must be balanced");
  return root.children[0];
}

function customerFixture(mode = "selected") {
  const f = fixture();
  f.row.remove();
  const html = fs.readFileSync(path.join(__dirname, "fixtures/dy-product-link-customer.html"), "utf8");
  const section = parseCustomerHtml(html); f.main.append(section);
  const all = () => section.querySelectorAll("*");
  const control = all().find((el) => (el.getAttribute("class") || "").split(/\s+/).includes("semi-select"));
  const selected = all().find((el) => el.getAttribute("data-code") === "-10");
  const label = all().find((el) => el.label.trim() === "添加标签");
  const anchor = all().find((el) => el.getAttribute("id") === "douyin_creator_pc_anchor_jump");
  const input = all().find((el) => el.tagName === "INPUT");
  const button = all().find((el) => el.label.trim() === "添加链接");
  label.top = 20; // 客户标题和内容可上下分区，不能依赖标题与控件横向重叠。
  button.onClick = f.add.onClick;
  input.onEvent = () => {
    if (mode !== "disabledAdd") button.attrs.class = "cart-mybtn-enabled-fixture";
  };
  if (["initial", "duplicateOption", "wrongCode", "existingOption"].includes(mode)) {
    // 明确派生的未选状态：客户原始快照是已选购物车，日志来自先前未选状态。
    const cartPart = anchor.children[0]; cartPart.remove();
    selected.label = "无"; selected.attrs["data-code"] = "-1";
    control.onClick = () => {
      f.trace.push("openCart");
      const popup = new Element();
      const option = new Element("div", "购物车", { "data-code": mode === "wrongCode" ? "other" : "-10", class: "select-dropdown-option-video" });
      option.onClick = () => {
        f.trace.push("chooseCartOption"); popup.remove(); selected.label = "购物车";
        selected.attrs["data-code"] = "-10"; anchor.append(cartPart);
      };
      popup.append(option);
      if (mode === "duplicateOption") popup.append(new Element("div", "购物车", { "data-code": "-10", class: "select-dropdown-option-video" }));
      f.document.body.append(popup);
    };
    if (mode === "existingOption") f.document.body.append(new Element("div", "购物车", { "data-code": "-10", class: "select-dropdown-option-video" }));
  }
  if (mode === "wrongAnchor") anchor.attrs.id = "unrelated-anchor";
  if (mode === "wrongSelectedCode") selected.attrs["data-code"] = "other";
  if (mode === "duplicateInput") anchor.append(new Input("粘贴商品链接"));
  if (mode === "duplicateControl") control.parentElement.append(new Element("div", "其他", { class: "semi-select" }));
  if (mode === "separatedControl") { control.remove(); label.parentElement.append(control); }
  if (mode === "orphanControl") {
    anchor.children[0].remove(); selected.label = "无"; selected.attrs["data-code"] = "-1";
    control.remove(); label.parentElement.append(control);
  }
  f.input = input;
  return f;
}

async function main() {
  const sharedSource = fs.readFileSync(path.join(__dirname, "../src/shared/productLinkInput.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/main/services/upLoad/dyProductLink.js"), "utf8")
    .replace('"../../../shared/productLinkInput.js"', JSON.stringify(toModule(sharedSource)));
  const { attachDyProductLink } = await import(toModule(source));
  for (const disabled of [undefined, {}, { enabled: false, type: "product" }]) {
    const f = fixture();
    assert.deepEqual(await attachDyProductLink(f.page, disabled), { attached: false });
    assert.equal(f.trace.length, 0);
  }
  for (const invalid of [
    { ...link, type: "official_article" }, { ...link, enabled: "true" },
    { ...link, value: "http://127.0.0.1/item" }, { ...link, shortTitle: "" },
    { ...link, shortTitle: "一二三四五六七八九十多" }, { ...link, shortTitle: "商品\n标题" },
    { ...link, shortTitle: "\n商品" },
  ]) {
    const f = fixture();
    await assert.rejects(attachDyProductLink(f.page, invalid), /抖音挂车/);
    assert.equal(f.trace.length, 0, "bad arguments must not mutate the page");
  }
  for (const mode of ["success", "hiddenDuplicate", "initialCart", "nativeCart"]) {
    const f = fixture(mode);
    const result = await attachDyProductLink(f.page, link, { timeoutMs: 0 });
    assert.deepEqual(result, { attached: true, productTitle: originalTitle, shortTitle: link.shortTitle });
    assert.equal(f.input.value, link.value, "long product IDs must retain leading zeros");
    assert.deepEqual(f.trace.filter((step) => ["add", "complete"].includes(step)), ["add", "complete"]);
    assert.equal(f.trace.at(-1), "verifyCard");
    if (mode === "initialCart") assert.deepEqual(f.trace.filter((step) => ["openCart", "chooseCartOption"].includes(step)), ["openCart", "chooseCartOption"]);
  }
  const cases = [
    ["oldCard", /页面已有商品/, []],
    ["duplicateLinkInput", /必须唯一/, []],
    ["wrongRow", /不在同一行/, []],
    ["titleAlreadyOpen", /未处理/, []],
    ["disabledAdd", /超时/, []],
    ["timeout", /超时/, ["add"]],
    ["platformError", /平台测试商品/, ["add"]],
    ["ambiguousModal", /必须唯一/, ["add"]],
    ["disabledComplete", /超时/, ["add"]],
    ["wrongProduct", /超时/, ["add", "complete"]],
    ["wrongShortTitle", /短标题不匹配/, ["add", "complete"]],
    ["multipleCards", /商品数量不是/, ["add", "complete"]],
    ["errorWithCard", /推广状态已关闭/, ["add", "complete"]],
    ["ambiguousCart", /必须唯一/, []],
    ["noSemanticDropdown", /无法确认/, []],
    ["wrongDropdownRow", /无法确认/, []],
    ["missingCartOption", /超时/, []],
  ];
  for (const [mode, error, clicked] of cases) {
    const f = fixture(mode);
    await assert.rejects(attachDyProductLink(f.page, link, { timeoutMs: 0 }), error, mode);
    assert.deepEqual(f.trace.filter((step) => ["add", "complete"].includes(step)), clicked, mode);
  }
  for (const mode of ["selected", "initial"]) {
    const f = customerFixture(mode);
    assert.deepEqual(await attachDyProductLink(f.page, link, { timeoutMs: 0 }),
      { attached: true, productTitle: originalTitle, shortTitle: link.shortTitle }, mode);
    assert.equal(f.input.value, link.value);
    assert.deepEqual(f.trace.filter((step) => ["add", "complete"].includes(step)), ["add", "complete"]);
    if (mode === "initial") assert.deepEqual(f.trace.filter((step) => ["openCart", "chooseCartOption"].includes(step)), ["openCart", "chooseCartOption"]);
  }
  const customerFailures = [
    ["disabledAdd", /超时/], ["wrongAnchor", /购物车链接容器/],
    ["wrongSelectedCode", /代码或链接容器/], ["duplicateInput", /必须唯一/],
    ["duplicateControl", /必须唯一/], ["orphanControl", /内容分区/], ["separatedControl", /代码或链接容器/],
    ["duplicateOption", /必须唯一/], ["wrongCode", /超时/], ["existingOption", /缺少链接输入/],
  ];
  for (const [mode, error] of customerFailures) {
    const f = customerFixture(mode);
    await assert.rejects(attachDyProductLink(f.page, link, { timeoutMs: 0 }), error, mode);
    assert.deepEqual(f.trace.filter((step) => ["add", "complete"].includes(step)), [], mode);
  }
  const broken = { evaluate: async () => { throw new Error("Execution context destroyed"); } };
  await assert.rejects(attachDyProductLink(broken, link), /Execution context destroyed/);
  console.log(`test-dy-product-link passed (${cases.length} original + ${customerFailures.length} customer-HTML failure scenarios; original selected/derived initial Semi states)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
