/**
 * 快手货架商品：截图只确认了交互文案，尚未完成真实账号验收。
 * 不依赖未经取证的平台 class；运行时无法唯一识别控件、商品或回显时停止发布。
 * 当前可滚动/未完整展开货架会停止，尚不支持虚拟列表遍历；不是完整快手挂车验收结果。
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

  if (phase === "cleanup") {
    document.querySelectorAll(`[${mark}]`).forEach((node) => {
      if ((node.getAttribute(mark) || "").startsWith(`${token}-`)) node.removeAttribute(mark);
    });
    return { ok: true };
  }

  if (phase === "discover") {
    const labels = exactLeaves(document, "作者服务");
    if (labels.length !== 1) return fail("无法唯一定位可见的作者服务行");
    for (let row = labels[0].parentElement, depth = 0;
      row && row !== document.body && depth < 7; row = row.parentElement, depth++) {
      // 禁止把整张表单误认为这一行，从而误点其它下拉框。
      if (["关联热点", "作者声明", "发布设置"].some((value) => exactLeaves(row, value).length)) break;
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
    const entry = requireResult(await probe("discover"));
    await page.click(entry.selector);
    const option = await waitProbe("options");
    await page.click(option.selector);
    requireResult(await waitProbe("selected"));
    return { type: "product", value: target, label: target };
  } finally {
    await probe("cleanup").catch(() => {});
  }
}
