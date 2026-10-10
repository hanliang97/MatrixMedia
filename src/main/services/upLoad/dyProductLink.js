import { validateDouyinProductUrl } from "../../../shared/productLinkInput.js";

// 根据需求方提供的桌面创作页截图，只使用可见文案与运行时 placeholder。
// 尚需真实账号验收；不猜测样式类，不把弹窗关闭或商品数量当作添加成功。
export function dyProductLinkDom(request) {
  const norm = (value) => String(value || "").replace(/\s+/g, "");
  const visible = (el) => {
    if (!el || !el.getClientRects().length) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      if (node.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  };
  const all = (root) => Array.from(root.querySelectorAll("*")).filter(visible);
  const text = (el) => el.tagName === "SELECT" && el.selectedOptions && el.selectedOptions.length === 1
    ? norm(el.selectedOptions[0].textContent) : norm(el.innerText || el.textContent);
  const leaves = (root, predicate) => all(root).filter((el) =>
    predicate(text(el)) && !Array.from(el.children).some((child) => visible(child) && predicate(text(child)))
  );
  const exact = (root, label) => leaves(root, (value) => value === norm(label));
  const only = (items, label) => {
    if (items.length !== 1) throw new Error(`抖音挂车：${label}必须唯一，实际 ${items.length} 个`);
    return items[0];
  };
  const inputs = (placeholder) => Array.from(document.querySelectorAll("input, textarea"))
    .filter((el) => visible(el) && el.getAttribute("placeholder") === placeholder);
  const errorTitles = exact(document, "未搜索到对应商品");
  if (errorTitles.length) {
    const reason = text(errorTitles[0].parentElement).slice(0, 180);
    throw new Error(`抖音挂车失败：${reason || "未搜索到对应商品"}`);
  }
  const usable = (el, boundary) => {
    for (let node = el; node; node = node.parentElement) {
      if (node.disabled || node.getAttribute("aria-disabled") === "true") return false;
      if (node === boundary) break;
    }
    return true;
  };
  const containing = (start, predicate, label) => {
    for (let node = start.parentElement; node && node !== document.body; node = node.parentElement) {
      if (predicate(node)) return node;
    }
    throw new Error(`抖音挂车：无法确认${label}的范围`);
  };
  const write = (el, value) => {
    if (!usable(el, document.body) || el.readOnly) throw new Error("抖音挂车：输入框不可编辑");
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (el.value !== value) throw new Error("抖音挂车：输入值未保留");
  };
  const cleanStart = () => {
    if (inputs("请输入商品短标题").length) throw new Error("抖音挂车：存在未处理的商品编辑弹窗");
    if (leaves(document, (value) => /^已添加商品[（(][1-9]\d*[）)]$/.test(value)).length) {
      throw new Error("抖音挂车：页面已有商品，请先清理后重试，避免重复或误认旧商品");
    }
  };
  const edit = () => {
    const candidates = inputs("请输入商品短标题");
    if (!candidates.length) return null;
    const input = only(candidates, "商品短标题输入框");
    const root = containing(input, (node) => exact(node, "编辑商品").length === 1 &&
      exact(node, "完成编辑").length === 1, "编辑商品弹窗");
    if (text(root).length > 1500) throw new Error("抖音挂车：编辑商品范围过大");
    const titleLabel = only(exact(root, "商品原标题"), "商品原标题标签");
    let productTitle = "";
    for (let node = titleLabel.parentElement; node && node !== root; node = node.parentElement) {
      const value = text(node);
      if (/商品图片|商品短标题|完成编辑/.test(value)) break;
      const remainder = value.replace(/^商品原标题/, "");
      if (remainder && remainder !== value && remainder.length <= 500) {
        productTitle = remainder;
        break;
      }
    }
    if (!productTitle) throw new Error("抖音挂车：无法读取本次商品原标题");
    return { input, root, productTitle, button: only(exact(root, "完成编辑"), "完成编辑按钮") };
  };
  if (request.action === "prepareCart") {
    cleanStart();
    if (inputs("粘贴商品链接").length) return { ready: true, selected: true };
    const label = only(exact(document, "添加标签"), "添加标签字段");
    const controls = (root) => all(root).filter((el) => el.tagName === "SELECT" ||
      el.getAttribute("role") === "combobox" || ["listbox", "menu"].includes(el.getAttribute("aria-haspopup")));
    const row = containing(label, (node) => controls(node).length > 0, "添加标签下拉行");
    const control = only(controls(row), "添加标签语义下拉控件");
    const rects = [label, control].map((el) => el.getBoundingClientRect());
    if (text(row).length > 600 || Math.min(...rects.map((rect) => rect.bottom)) <= Math.max(...rects.map((rect) => rect.top))) {
      throw new Error("抖音挂车：无法确认添加标签与下拉控件在同一行");
    }
    if (!usable(control, row)) throw new Error("抖音挂车：添加标签下拉不可用");
    if (control.tagName === "SELECT") {
      const option = only(Array.from(control.options).filter((el) => text(el) === "购物车"), "购物车原生选项");
      if (option.disabled) throw new Error("抖音挂车：购物车选项不可用");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(control, option.value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return { ready: true, native: true };
    }
    const popupId = control.getAttribute("aria-controls") || control.getAttribute("aria-owns") || "";
    if (/\s/.test(popupId)) throw new Error("抖音挂车：添加标签关联多个弹出层");
    control.click();
    return { ready: true, popupId };
  }
  if (request.action === "chooseCart") {
    const popups = request.popupId
      ? [document.getElementById(request.popupId)].filter((el) => el && visible(el))
      : all(document).filter((el) => ["listbox", "menu"].includes(el.getAttribute("role")));
    if (!popups.length) return { ready: false };
    const popup = only(popups, "添加标签选项弹出层");
    const options = all(popup).filter((el) => ["option", "menuitem"].includes(el.getAttribute("role")) && text(el) === "购物车");
    if (!options.length) return { ready: false };
    const option = only(options, "可见购物车语义选项");
    if (!usable(option, popup)) throw new Error("抖音挂车：购物车选项不可用");
    option.click();
    return { ready: true };
  }
  if (["inspectCart", "fillLink", "addLink"].includes(request.action)) {
    if (inputs("请输入商品短标题").length) throw new Error("抖音挂车：存在未处理的商品编辑弹窗");
    if (request.action === "fillLink") cleanStart();
    const candidates = inputs("粘贴商品链接");
    if (request.action === "inspectCart" && !candidates.length) return { ready: false };
    const input = only(candidates, "购物车商品链接输入框");
    const row = containing(input, (node) => exact(node, "购物车").length === 1 &&
      exact(node, "添加链接").length === 1, "购物车链接行");
    if (text(row).length > 600) throw new Error("抖音挂车：购物车链接行范围过大");
    const button = only(exact(row, "添加链接"), "添加链接按钮");
    const cart = only(exact(row, "购物车"), "购物车选项");
    const rects = [input, cart, button].map((el) => el.getBoundingClientRect());
    if (Math.min(...rects.map((rect) => rect.bottom)) <= Math.max(...rects.map((rect) => rect.top))) {
      throw new Error("抖音挂车：购物车选项、链接输入与添加按钮不在同一行");
    }
    if (request.action === "inspectCart") return { ready: true };
    if (request.action === "fillLink") {
      write(input, request.value);
      return { ready: true };
    }
    if (input.value !== request.value) throw new Error("抖音挂车：提交前商品链接发生变化");
    if (!usable(button, row)) return { ready: false };
    button.click();
    return { ready: true };
  }
  if (["inspectEdit", "fillTitle", "completeEdit"].includes(request.action)) {
    const modal = edit();
    if (!modal) return { ready: false };
    if (request.action === "inspectEdit") return { ready: true, productTitle: modal.productTitle };
    if (modal.productTitle !== request.productTitle) throw new Error("抖音挂车：编辑中的商品发生变化");
    if (request.action === "fillTitle") {
      write(modal.input, request.shortTitle);
      return { ready: true };
    }
    if (modal.input.value !== request.shortTitle) throw new Error("抖音挂车：商品短标题未保留");
    if (!usable(modal.button, modal.root)) return { ready: false };
    modal.button.click();
    return { ready: true };
  }
  if (request.action === "verifyCard") {
    if (inputs("请输入商品短标题").length) return { ready: false };
    const headings = leaves(document, (value) => /^已添加商品[（(]\d+[）)]$/.test(value));
    if (!headings.length) return { ready: false };
    const heading = only(headings, "已添加商品计数");
    if (!/^已添加商品[（(]1[）)]$/.test(text(heading))) throw new Error("抖音挂车：添加后的商品数量不是 1");
    const titles = exact(document, request.productTitle);
    if (!titles.length) return { ready: false };
    const title = only(titles, "添加后的本次商品原标题");
    const shortText = norm(request.shortTitle);
    const card = containing(title, (node) => exact(node, "编辑").length === 1 &&
      exact(node, "移除").length === 1, "已添加商品卡片");
    const shortTitles = leaves(card, (value) => /^短标题[:：]/.test(value));
    const shortTitle = only(shortTitles, "已添加商品短标题");
    if (text(shortTitle).replace(/^短标题[:：]/, "") !== shortText) throw new Error("抖音挂车：添加后的商品短标题不匹配");
    return { ready: true, productTitle: request.productTitle };
  }
  throw new Error("抖音挂车：未知页面操作");
}

async function waitForStep(page, request, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    // evaluate 的任何错误（含平台业务错误）直接向上传播，禁止吞错后继续发布。
    const result = await page.evaluate(dyProductLinkDom, request);
    if (result && result.ready) return result;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  throw new Error(`抖音挂车：等待 ${request.action} 超时，已停止发布`);
}

export async function attachDyProductLink(page, link, options = {}) {
  if (!link || link.enabled === false || link.enabled == null) return { attached: false };
  if (link.enabled !== true || link.type !== "product") throw new Error("抖音挂车：链接配置类型不正确");
  const checked = validateDouyinProductUrl(link.value);
  if (!checked.ok) throw new Error(`抖音挂车：${checked.error}`);
  const shortTitle = typeof link.shortTitle === "string" ? link.shortTitle.trim() : "";
  if (!shortTitle || Array.from(shortTitle).length > 10 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(link.shortTitle)) {
    throw new Error("抖音挂车：商品短标题必填，长度须为 1–10 个字符且不能换行");
  }
  const timeoutMs = options.timeoutMs == null ? 30000 : options.timeoutMs;
  const cart = await page.evaluate(dyProductLinkDom, { action: "prepareCart" });
  if (!cart.selected) {
    if (!cart.native) await waitForStep(page, { action: "chooseCart", popupId: cart.popupId }, timeoutMs);
    await waitForStep(page, { action: "inspectCart" }, timeoutMs);
  }
  await page.evaluate(dyProductLinkDom, { action: "fillLink", value: checked.value });
  await waitForStep(page, { action: "addLink", value: checked.value }, timeoutMs);
  const { productTitle } = await waitForStep(page, { action: "inspectEdit" }, timeoutMs);
  await page.evaluate(dyProductLinkDom, { action: "fillTitle", productTitle, shortTitle });
  await waitForStep(page, { action: "completeEdit", productTitle, shortTitle }, timeoutMs);
  await waitForStep(page, { action: "verifyCard", productTitle, shortTitle }, timeoutMs);
  return { attached: true, productTitle, shortTitle };
}
