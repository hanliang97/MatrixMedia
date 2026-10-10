"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const toModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

// 小型 DOM 测试桩执行真实 evaluate 函数，验证语义定位/业务状态；不是实站 DOM 快照。
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
  return { page, trace, input };
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
  const broken = { evaluate: async () => { throw new Error("Execution context destroyed"); } };
  await assert.rejects(attachDyProductLink(broken, link), /Execution context destroyed/);
  console.log(`test-dy-product-link passed (real DOM function exercised; ${cases.length} failure scenarios)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
