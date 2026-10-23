/**
 * 快手货架商品：Ant Select 结构来自 PR31 买方提供的真实 HTML（6095673896）。
 * 输入完整商品名收窄货架；仍有未展开虚拟项、同名项或不能确认回显时停止发布。
 * 离线 DOM 回归不代替真实账号验收，不遍历整货架或推断隐藏的商品。
 * 此函数会由 Puppeteer 序列化，所有 DOM 辅助函数必须保留在函数内部。
 */
export function inspectKsProductDom({ phase, token, target }) {
  const mark = "data-mm-ks-product";
  const text = (node) => String((node && node.innerText) || "").trim();
  const visible = (node) => {
    if (!node || !node.isConnected) return false;
    for (let p = node; p && p.nodeType === 1; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.display === "none" || style.visibility === "hidden" ||
          Number(style.opacity) === 0 || p.hidden || p.hasAttribute("inert") ||
          p.getAttribute("aria-hidden") === "true") return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const exactLeaves = (root, value) => Array.from(root.querySelectorAll("*"))
    .filter((node) => visible(node) && text(node) === value &&
      !Array.from(node.children).some((child) => visible(child) && text(child) === value));
  const marked = (part) => document.querySelector(`[${mark}="${token}-${part}"]`);
  const stamp = (node, part) => {
    node.setAttribute(mark, `${token}-${part}`);
    return `[${mark}="${token}-${part}"]`;
  };
  const semantic = 'input[role="combobox"],[role="combobox"],[aria-haspopup="listbox"]';
  const fail = (reason) => ({ ok: false, reason });
  const own = (root, selector) => Array.from(root.querySelectorAll(selector))
    .filter((node) => node.closest(".ant-select") === root);

  if (phase === "cleanup") {
    document.querySelectorAll(`[${mark}]`).forEach((node) => {
      if ((node.getAttribute(mark) || "").startsWith(`${token}-`)) node.removeAttribute(mark);
    });
    return { ok: true };
  }

  if (phase === "discover") {
    const labels = exactLeaves(document, "作者服务");
    if (!labels.length) return fail("作者服务行尚未出现");
    if (labels.length !== 1) return fail("无法唯一定位可见的作者服务行");
    for (let row = labels[0].parentElement, depth = 0;
      row && row !== document.body && depth < 7; row = row.parentElement, depth++) {
      // 禁止把整张表单误认为这一行，从而误点其它下拉框。
      if (["关联热点", "作者声明", "发布设置"].some((value) => exactLeaves(row, value).length)) break;
      // 真实页面把类型和商品放在两个 Ant Select；ARIA input 不是可点击入口。
      const antSelects = Array.from(row.querySelectorAll(".ant-select")).filter(visible);
      const modes = antSelects.filter((root) => own(root, ".ant-select-selection-item")
        .some((node) => visible(node) && text(node) === "关联商品"));
      if (modes.length > 1) return fail("作者服务中存在多个关联商品类型控件");
      if (modes.length === 1) {
        const goods = antSelects.filter((root) => root !== modes[0] &&
          Boolean(modes[0].compareDocumentPosition(root) & 4) &&
          root.classList.contains("ant-select-show-search") &&
          own(root, 'input[role="combobox"]').length === 1);
        if (goods.length > 1) return fail("关联商品后有多个候选控件");
        if (!goods.length) continue;
        const root = goods[0];
        const input = own(root, 'input[role="combobox"]')[0];
        const selectors = own(root, ".ant-select-selector").filter(visible);
        const placeholder = own(root, ".ant-select-selection-placeholder").filter(visible);
        const selection = own(root, ".ant-select-selection-item").filter(visible);
        if (selectors.length !== 1 || (placeholder.length !== 1 && selection.length !== 1) ||
            (placeholder.length === 1 && text(placeholder[0]) !== "关联商品获得更多收入")) {
          return fail("商品控件结构已变化，无法确认安全入口");
        }
        if (input.disabled || input.readOnly || root.classList.contains("ant-select-disabled") ||
            root.getAttribute("aria-disabled") === "true") return fail("商品搜索控件不可用");
        stamp(root, "ant-frame");
        const inputSelector = stamp(input, "ant-input");
        return { ok: true, selector: stamp(selectors[0], "trigger"), inputSelector };
      }
      const productLabels = exactLeaves(row, "关联商品");
      if (productLabels.length !== 1) continue;
      const productLabel = productLabels[0];
      const controls = Array.from(row.querySelectorAll(semantic)).filter((node) =>
        !node.contains(productLabel) && Boolean(productLabel.compareDocumentPosition(node) & 4));
      const roots = controls.filter((node) => !controls.some((other) => other !== node && other.contains(node)));
      if (roots.length > 1) return fail("关联商品后有多个候选控件");
      if (roots.length !== 1) continue;
      const control = roots[0];
      if (control.disabled || control.getAttribute("aria-disabled") === "true") {
        return fail("商品控件不可用，请先确认货架和带货权限");
      }
      let trigger = control;
      // 有些语义输入是透明的；仅向上找同一控件的可见包裹，不猜平台 class。
      for (let i = 0; !visible(trigger) && i < 3; i++) trigger = trigger.parentElement;
      if (!visible(trigger) || trigger === row || trigger.contains(productLabel)) {
        return fail("商品控件没有可安全点击的可见入口");
      }
      let frame = trigger;
      for (let i = 0; i < 3 && frame.parentElement && frame.parentElement !== row; i++) {
        const parent = frame.parentElement;
        if (parent.contains(productLabel) || parent.querySelectorAll(semantic).length > controls.length) break;
        frame = parent;
      }
      stamp(control, "control");
      const selector = stamp(trigger, "trigger");
      // control 与 trigger 可能是同一节点，后续通过 trigger 的语义子节点重新读取。
      if (frame !== trigger) stamp(frame, "frame");
      return { ok: true, selector };
    }
    return fail("未识别到作者服务中的唯一关联商品控件");
  }

  const antFrame = marked("ant-frame");
  if (antFrame) {
    const input = marked("ant-input");
    const trigger = marked("trigger");
    if (!visible(antFrame) || !visible(trigger) || !input || !antFrame.contains(input)) {
      return fail("商品入口已变化");
    }
    const popupIds = new Set(["aria-controls", "aria-owns"].flatMap((attr) =>
      String(input.getAttribute(attr) || "").split(/\s+/).filter(Boolean)));
    const popups = [];
    popupIds.forEach((id) => {
      const ariaList = document.getElementById(id);
      // ARIA listbox 是 0×0 的辅助列表；只取所属弹层，不能向上越过隐藏弹层。
      const popup = ariaList && ariaList.closest(".ant-select-dropdown");
      if (popup && visible(popup) && !popups.includes(popup)) popups.push(popup);
    });
    if (phase === "selected") {
      if (input.getAttribute("aria-expanded") === "true" || popups.length) {
        return fail("商品下拉仍展开，尚未确认选择完成");
      }
      const labels = own(antFrame, ".ant-select-selection-item").filter(visible);
      if (labels.length !== 1 || (text(labels[0]) !== target && exactLeaves(labels[0], target).length !== 1)) {
        return fail("商品入口未回显完整目标名称");
      }
      if (own(antFrame, ".ant-select-selection-placeholder").some(visible)) {
        return fail("商品占位仍显示，尚未确认选择完成");
      }
      return { ok: true, value: target };
    }
    if (phase !== "options") return fail("未知商品检查阶段");
    if (input.value !== target) return fail("尚未按完整商品名搜索");
    if (input.getAttribute("aria-expanded") !== "true" || popups.length !== 1) {
      return fail("商品下拉列表尚未唯一出现");
    }
    const popup = popups[0];
    if (popup.getAttribute("aria-busy") === "true" ||
        Array.from(popup.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')).some(visible)) {
      return fail("商品列表仍在加载");
    }
    const holders = Array.from(popup.querySelectorAll(".rc-virtual-list-holder")).filter(visible);
    if (holders.length !== 1) return fail("无法确认商品列表完整范围");
    const holder = holders[0];
    const inners = Array.from(holder.querySelectorAll(".rc-virtual-list-holder-inner")).filter(visible);
    if (inners.length !== 1 || holder.clientHeight <= 0) return fail("无法确认商品列表完整范围");
    const inner = inners[0];
    // overflow-y:hidden 也可能是真实虚拟货架，不能仅检查 auto/scroll。
    const matrix = getComputedStyle(inner).transform;
    const translated = matrix && matrix !== "none" &&
      !/^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/.test(matrix);
    if (holder.scrollHeight > holder.clientHeight + 1 || holder.scrollTop > 0 || translated ||
        inner.getBoundingClientRect().height > holder.clientHeight + 1) {
      return fail("搜索后商品列表未完整展开，无法排除未显示的同名商品");
    }
    const options = Array.from(inner.querySelectorAll(".ant-select-item-option")).filter(visible);
    if (!options.length) return fail("未找到完整名称精确匹配的可见商品");
    const matches = options.filter((node) => String(node.getAttribute("label") || "").trim() === target);
    if (matches.length > 1) return fail("存在同名商品，不能自动选择");
    if (!matches.length) return fail("未找到完整名称精确匹配的可见商品");
    const option = matches[0];
    if (/[….]{2,}|…/.test(target) || exactLeaves(option, target).length !== 1) {
      return fail("商品名称原文不能确认完整匹配");
    }
    if (option.getAttribute("aria-disabled") === "true" || option.classList.contains("ant-select-item-option-disabled")) {
      return fail("目标商品不可选");
    }
    return { ok: true, selector: stamp(option, "option") };
  }

  const trigger = marked("trigger");
  const frame = marked("frame") || trigger;
  if (!visible(trigger) || !frame) return fail("商品入口已变化");
  const controls = [trigger, ...trigger.querySelectorAll(semantic)];
  const ids = new Set();
  controls.forEach((node) => {
    for (const attr of ["aria-controls", "aria-owns"]) {
      String(node.getAttribute(attr) || "").split(/\s+/).filter(Boolean).forEach((id) => ids.add(id));
    }
  });
  const popups = [];
  ids.forEach((id) => {
    let popup = document.getElementById(id);
    // 可访问性列表有时隐藏在可见弹层内部，最多向上找到该弹层，绝不扩展到表单。
    for (let i = 0; popup && !visible(popup) && i < 3; i++) popup = popup.parentElement;
    if (visible(popup) && popup !== document.body && !popup.contains(trigger) &&
        !exactLeaves(popup, "作者服务").length) popups.push(popup);
  });
  let scopes = popups.filter((node, i, all) => all.indexOf(node) === i &&
    !all.some((other) => other !== node && other.contains(node)));

  if (phase === "options") {
    // 无关联属性时，只接受唯一可见的标准 listbox。其它结构留待实机取证。
    if (!scopes.length) scopes = Array.from(document.querySelectorAll('[role="listbox"]')).filter(visible);
    if (scopes.length > 1) return fail("无法唯一确认商品下拉列表");
    if (!scopes.length) return fail("商品下拉列表尚未出现");
    const scope = scopes[0];
    const nodes = [scope, ...scope.querySelectorAll("*")].filter(visible);
    const options = nodes.filter((node) => node.getAttribute("role") === "option");
    // 未挂载/未展示的货架项可能同名；不扫描整货架，也不把当前可见唯一当作全局唯一。
    const incomplete = nodes.some((node) => {
      const overflow = getComputedStyle(node).overflowY;
      const scrollable = /^(auto|scroll)$/.test(overflow || "") &&
        node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1;
      const size = Number(node.getAttribute("aria-setsize"));
      return scrollable || (size > 0 && size > options.length) || size === -1;
    });
    if (incomplete) return fail("商品列表未完整展开，无法排除未显示的同名商品");
    const matches = exactLeaves(scope, target);
    if (matches.length > 1) return fail("存在同名商品，不能自动选择");
    if (!matches.length) return fail("未找到完整名称精确匹配的可见商品");
    const label = matches[0];
    // CSS 省略不等于 DOM 文本缺失；完整原文精确相等可以继续，字面省略号不作推测。
    if (/[….]{2,}|…/.test(text(label))) return fail("商品名称原文含省略号，不能确认完整名称");
    let option = label;
    while (option && option !== scope && option.getAttribute("role") !== "option" &&
      option.tagName !== "OPTION" && !option.hasAttribute("tabindex") &&
      getComputedStyle(option).cursor !== "pointer") option = option.parentElement;
    if (!option || option === scope || !visible(option) || option.disabled ||
        option.getAttribute("aria-disabled") === "true") return fail("商品没有可确认的可点击选项");
    return { ok: true, selector: stamp(option, "option") };
  }

  if (phase === "selected") {
    if (controls.some((node) => node.getAttribute("aria-expanded") === "true") || scopes.length) {
      return fail("商品下拉仍展开，尚未确认选择完成");
    }
    // 只检查同一入口里的回显；不得把下拉候选、搜索输入或页面其它文字当作选中。
    const selectedLabels = exactLeaves(frame, target).filter((node) =>
      !node.matches("input,textarea") && !node.closest('[role="listbox"],[role="option"]'));
    const ownText = text(frame) === target && !frame.matches("input,textarea");
    return selectedLabels.length === 1 || ownText
      ? { ok: true, value: target }
      : fail("商品入口未回显完整目标名称");
  }
  return fail("未知商品检查阶段");
}

export async function attachKsProductLink(page, link) {
  if (!link || link.enabled !== true || link.type !== "product" ||
      link.inputKind !== "product_name" || typeof link.value !== "string" ||
      !link.value.trim() || link.value.trim().length > 200 ||
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(link.value)) {
    throw new Error("快手挂车必须提供货架商品完整原名");
  }
  const target = link.value.trim();
  const token = `ks-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const probe = (phase) => page.evaluate(inspectKsProductDom, { phase, token, target });
  const requireResult = (result) => {
    if (!result || !result.ok) throw new Error(`快手挂车失败：${(result && result.reason) || "无法确认页面状态"}`);
    return result;
  };
  const waitProbe = async (phase) => {
    let result;
    for (let i = 0; i < 15; i++) {
      result = await probe(phase);
      if (result && result.ok) return result;
      if (result && /同名|多个|截断|无法唯一/.test(result.reason)) break;
      await page.waitForTimeout(200);
    }
    return requireResult(result);
  };
  try {
    const entry = await waitProbe("discover");
    await page.click(entry.selector);
    if (entry.inputSelector) {
      // Ant 的占位和弹层容器覆盖输入框；聚焦已验证的搜索 input，再发真实键盘事件。
      const focused = await page.$eval(entry.inputSelector, (input) => {
        input.focus(); input.select();
        return document.activeElement === input && input.selectionStart === 0 &&
          input.selectionEnd === input.value.length;
      });
      if (!focused) throw new Error("快手挂车失败：无法聚焦商品搜索控件");
      await page.keyboard.press("Backspace");
      await page.type(entry.inputSelector, target);
      // 等候受控输入过滤货架；后续仍逐次核验完整性与唯一性，不使用辅助 ARIA 缓存。
      await page.waitForTimeout(400);
    }
    const option = await waitProbe("options");
    await page.click(option.selector);
    requireResult(await waitProbe("selected"));
    return { type: "product", value: target, label: target };
  } finally {
    await probe("cleanup").catch(() => {});
  }
}
