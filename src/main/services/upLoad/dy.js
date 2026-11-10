import path from "path";
import fs from "fs";
import { normalizeCoverForUpload } from "../coverCompat.js";
import { resolveVideoLinkOption } from "../../../shared/videoLink.js";
import { attachDyProductLink } from "./dyProductLink.js";
import { resolveDyCreativeStatementLabel } from "../../../shared/creativeStatement.js";
import {
  readPageUrl,
  replyPublishFailure,
  replyPublishOutcome,
} from "./publishOutcome.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";
import {
  buildPlatformVideoText,
  normalizeVideoTags,
} from "../../../shared/videoMetadata.js";
import {
  head,
  matchesHead,
  normalizeForCompare,
  replaceAllText,
} from "./textReadback.js";

async function dismissDyGuideModals(page) {
  const closed = await page.evaluate(() => {
    const norm = (t) => String(t).replace(/\s+/g, "").trim();
    let n = 0;
    for (const b of document.querySelectorAll("button, [role='button']")) {
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || b.disabled) continue;
      const t = norm(b.textContent);
      if (t === "我知道了" || t === "知道了") {
        b.click();
        n++;
      }
    }
    return n;
  });
  if (closed > 0) {
    console.log(`[dy] 已关闭 ${closed} 个引导弹窗`);
    await page.waitForTimeout(600);
  }
  return closed;
}

/**
 * 上传自定义竖封面（3:4）。流程经 DOM 探针实证（2026-10）：
 * 点「选择封面」槽位 → 封面弹窗(.dy-creator-content-modal-wrap) → 点「上传封面」→
 * 文件注入「点击上传文件或拖拽文件到这里」拖拽区的 input（页面同时存在多个 image
 * input：商品封面/AI参考图等，必须按容器文案定位，选错会把图喂给 AI 参考图功能）→
 * 「完成」→ 可能弹「设置横封面获更多流量」引导，点「暂不设置」（横封面会基于竖封面
 * 自动生成）→ 校验槽位文案变为「编辑封面」。
 */
async function uploadDyCustomCover(page, coverPath) {
  if (!fs.existsSync(coverPath)) {
    throw new Error(`封面文件不存在: ${coverPath}`);
  }
  // 封面归一：非 3:4 源图居中裁切成 1080×1440 jpg（失败回退原图，不阻断发布）
  coverPath = await normalizeCoverForUpload(coverPath);

  // 记录设置前封面槽位的 img src：平台自动截帧的默认封面本来就在抖音 CDN 域名下，
  // 只判「槽位出现 douyin 图」会让上传失败也通过校验；必须对比前后 src 变化（同 ks/sph）
  const slotSrcsBefore = await page.evaluate(() => {
    const srcs = [];
    for (const e of document.querySelectorAll('[class*="cover"],[class*="Cover"]')) {
      const r = e.getBoundingClientRect();
      if (r.width < 50 || r.height < 50 || r.width > 400) continue;
      const img = e.querySelector("img");
      if (img && img.src) srcs.push(img.src);
    }
    return srcs;
  });

  const opened = await page.evaluate(() => {
    const norm = (t) => String(t).replace(/\s+/g, "").trim();
    const slots = [...document.querySelectorAll("div,span")].filter((e) => {
      const r = e.getBoundingClientRect();
      return (
        r.width > 30 &&
        r.height > 30 &&
        (norm(e.textContent) === "选择封面" || norm(e.textContent) === "编辑封面")
      );
    });
    if (!slots.length) return false;
    slots[0].click();
    return true;
  });
  if (!opened) throw new Error("未找到「选择封面」入口（视频可能未就绪）");
  await page.waitForSelector(".dy-creator-content-modal-wrap", {
    visible: true,
    timeout: 15000,
  });
  await page.waitForTimeout(1500);

  const panelClicked = await page.evaluate(() => {
    const norm = (t) => String(t).replace(/\s+/g, "").trim();
    const cands = [...document.querySelectorAll("button,[role='button'],div,span,[class*='tab'],[class*='upload']")].filter((e) => {
      const r = e.getBoundingClientRect();
      const t = norm(e.textContent);
      return r.width > 0 && (t === "上传封面" || t === "+上传封面");
    });
    const exact = cands.find((e) => norm(e.textContent) === "上传封面") || cands[0];
    if (!exact) return false;
    exact.click();
    return true;
  });
  if (!panelClicked) throw new Error("封面弹窗内未找到「上传封面」入口");
  await page.waitForTimeout(1500);

  const inputHandle = await page.evaluateHandle(() => {
    const inputs = [...document.querySelectorAll("input[type=file]")].filter((i) =>
      /image/.test(i.accept || "")
    );
    for (const inp of inputs) {
      let a = inp;
      let text = "";
      for (let k = 0; k < 6 && a; k++) {
        a = a.parentElement;
        if (a) text = (a.textContent || "").replace(/\s+/g, " ");
        if (text.includes("拖拽文件到这里")) return inp;
      }
    }
    return null;
  });
  const inputEl = inputHandle.asElement();
  if (!inputEl) throw new Error("未找到封面上传拖拽区的 file input");
  await inputEl.uploadFile(path.resolve(coverPath));
  console.log("[dy] 封面文件已注入上传区:", coverPath);

  await page.waitForTimeout(4000);
  const done = await page.evaluate(() => {
    const norm = (t) => String(t).replace(/\s+/g, "").trim();
    const modal = document.querySelector(".dy-creator-content-modal-wrap");
    if (!modal) return false;
    const b = [...modal.querySelectorAll("button,[role='button']")].find(
      (x) => x.getBoundingClientRect().width > 0 && !x.disabled && norm(x.textContent) === "完成"
    );
    if (!b) return false;
    b.click();
    return true;
  });
  if (!done) throw new Error("封面弹窗内未找到「完成」按钮");
  await page.waitForTimeout(2500);

  // 「设置横封面获更多流量」引导弹窗 →「暂不设置」；横封面会基于竖封面自动生成
  await page.evaluate(() => {
    const norm = (t) => String(t).replace(/\s+/g, "").trim();
    const b = [...document.querySelectorAll("button,[role='button']")].find(
      (x) => x.getBoundingClientRect().width > 0 && norm(x.textContent) === "暂不设置"
    );
    if (b) b.click();
  });
  await page.waitForTimeout(1500);

  // 校验封面已设置：槽位 img src 相对设置前变化，且新 src 在抖音 CDN 域名下
  //（「编辑封面」是 hover 蒙层文案，innerText 不可见，不能作为校验信号；
  // 探针 v3 实证上传落定后槽位 img src 来自 *-creator-media-private.douyin.com）
  await page.waitForFunction(
    (prevSrcs) => {
      for (const e of document.querySelectorAll('[class*="cover"],[class*="Cover"]')) {
        const r = e.getBoundingClientRect();
        if (r.width < 50 || r.height < 50 || r.width > 400) continue;
        const img = e.querySelector("img");
        if (!img || !img.src) continue;
        if (/douyin/.test(img.src) && !prevSrcs.includes(img.src)) return true;
      }
      return false;
    },
    { timeout: 20000 },
    slotSrcsBefore
  ).catch(() => {
    throw new Error(
      `抖音封面设置后槽位图片未变化（设置前 src: ${JSON.stringify(
        slotSrcsBefore.map((s) => s.slice(0, 80))
      )}）`
    );
  });
  console.log("[dy] 自定义封面已设置并校验通过（槽位 src 变化且为抖音 CDN 图）");

  // 抖音把封面写入编辑态（暂存/恢复用）是异步落定的，无可观测信号：
  // 实证 校验通过后 2s 内「暂存离开」→ 恢复后封面丢失；35s 后暂存 → 封面完好。
  // 固定等待落定，宁可慢不可丢（封面是缩略图点击的命脉）。
  await page.waitForTimeout(25000);
  console.log("[dy] 封面落定等待完成（25s）");
}

async function selectDyCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[dy] creativeStatement 值 =", value);
  // 注意：「无标注」对应抖音「无需添加自主声明」，也必须主动点选，不能跳过
  const label = resolveDyCreativeStatementLabel(value);
  console.log("[dy] 准备选择自主声明:", label);

  const opened = await page.evaluate(() => {
    const norm = (t) => String(t).replace(/\s+/g, "").trim();
    const keywords = ["请选择自主声明", "添加自主声明", "自主声明"];
    const isSelectText = (el) => {
      const cls = el.className;
      if (typeof cls !== "string") return false;
      return cls.split(/\s+/).some((c) => c.startsWith("selectText-"));
    };
    for (const el of document.querySelectorAll("[class]")) {
      if (!isSelectText(el)) continue;
      const text = norm(el.textContent);
      if (!keywords.some((k) => text.includes(norm(k)))) continue;
      el.click();
      return true;
    }
    for (const el of document.querySelectorAll(
      "span, div, label, [role='button'], .semi-select"
    )) {
      const text = norm(el.textContent);
      if (!keywords.some((k) => text.includes(norm(k)))) continue;
      if (text.length > 24) continue;
      el.click();
      return true;
    }
    return false;
  });
  if (!opened) {
    throw new Error("未找到抖音「请选择自主声明」入口");
  }

  await page.waitForSelector(".semi-modal-body .semi-radio-addon", {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });

  const picked = await page.evaluate((text) => {
    const modal = document.querySelector(".semi-modal-body");
    if (!modal) return false;
    for (const addon of modal.querySelectorAll(".semi-radio-addon")) {
      if (addon.textContent.trim() !== text) continue;
      const labelEl = addon.closest("label.semi-radio");
      if (labelEl) {
        labelEl.click();
        return true;
      }
    }
    return false;
  }, label);

  if (!picked) {
    throw new Error(`未找到抖音自主声明选项: ${label}`);
  }
  await page.waitForTimeout(400);

  // 点击弹窗里的「确认」按钮提交声明
  const confirmed = await page.evaluate(() => {
    const modal = document.querySelector(".semi-modal-body");
    const root = modal ? modal.closest(".semi-modal") || modal : document;
    const btn = root.querySelector(".semi-button.semi-button-primary");
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!confirmed) {
    throw new Error("未找到抖音自主声明确认按钮");
  }
  console.log("[dy] 已点击声明确认按钮");
  await page.waitForTimeout(400);
}

async function selectDyCreativeStatementWithRetry(page, data, maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      await selectDyCreativeStatement(page, data);
      return;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(2000);
    }
  }
  throw lastErr || new Error("抖音自主声明选择失败");
}

async function clickDyPublish(page, isDraftMode) {
  const submitSelector = isDraftMode
    ? "#popover-tip-container+button"
    : "#popover-tip-container";
  const submitBtn = await page.waitForSelector(submitSelector, {
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  await submitBtn.click({ delay: 200 });
  console.log(
    isDraftMode
      ? "[dy] 已点击存草稿按钮 (#popover-tip-container+button)"
      : "[dy] 已点击发布入口 (#popover-tip-container)"
  );
}

export const DY_EDITOR_SELECTOR = ".zone-container.editor-kit-container";

/** 抖音简介编辑器文本归一：去空白/零宽字符与 #（话题转胶囊后 # 可能消失），用于回读比对 */
function normalizeDyEditorText(str) {
  return normalizeForCompare(str).replace(/#/g, "");
}

async function readDyEditorText(page) {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? String(el.textContent || "") : "";
    }, DY_EDITOR_SELECTOR)
    .catch(() => "");
}

/**
 * 尝试用抖音简介编辑器的 Slate onChange 直接重置状态。
 * mode: object → onChange({text:"",textExtra:[]})（现网生效）；
 *       emptyArray → onChange("",[])；empty → onChange("")（兼容旧实现）。
 * 只返回“调用是否成功”，是否真正清空由 clearDyEditor 回读判定。
 */
async function trySlateClear(page, mode) {
  return page
    .evaluate(({ sel, mode }) => {
      const root = document.querySelector(sel);
      if (!root) return { ok: false, reason: "no-root" };
      const editable = root.matches('[contenteditable="true"]')
        ? root
        : root.querySelector('[contenteditable="true"]');
      const node = editable || root;
      const key = Object.keys(node).find(
        (k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$")
      );
      if (!key) return { ok: false, reason: "no-fiber" };
      let slate = null;
      for (let fiber = node[key], i = 0; fiber && i < 60; i++, fiber = fiber.return) {
        const p = fiber.memoizedProps || {};
        if (p.text !== undefined && typeof p.onChange === "function") {
          slate = p;
          break;
        }
      }
      if (!slate) return { ok: false, reason: "no-editor-props" };
      const info = {
        textType: typeof slate.text,
        textPreview: String(slate.text || "").slice(0, 40),
        textExtraType: Array.isArray(slate.textExtra)
          ? `array(${slate.textExtra.length})`
          : typeof slate.textExtra,
      };
      try {
        if (mode === "empty") slate.onChange("");
        else if (mode === "emptyArray") slate.onChange("", []);
        else if (mode === "object") slate.onChange({ text: "", textExtra: [] });
        else return { ok: false, reason: "bad-mode" };
      } catch (e) {
        return { ok: false, reason: String(e && e.message), info };
      }
      return { ok: true, info, mode };
    }, { sel: DY_EDITOR_SELECTOR, mode })
    .catch((e) => ({ ok: false, reason: String(e && e.message) }));
}

/**
 * 清空抖音简介编辑器：Slate 状态重置优先（能清 #话题胶囊），
 * 键盘三击/全选、selection API、Control 三层兜底；返回回读是否为空。
 */
async function clearDyEditor(page) {
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  // 1) Slate 编辑器状态重置：fiber 上暴露 text/textExtra/onChange，
  //    直接 onChange 清空可连 #话题胶囊一起清掉。异步函数不能塞进
  //    page.evaluate（Babel regenerator 在页面上下文未定义），故每次只调一种签名。
  let slateInfo = null;
  for (const mode of ["object", "emptyArray", "empty"]) {
    const r = await trySlateClear(page, mode);
    if (!r.ok) continue;
    slateInfo = r.info;
    let cleared = false;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100);
      if (!normalizeDyEditorText(await readDyEditorText(page))) {
        cleared = true;
        break;
      }
    }
    if (cleared) {
      console.log(`[dy] 简介编辑器已清空（Slate onChange ${mode}）`);
      return true;
    }
  }
  console.log("[dy] Slate 状态重置未成功，走键盘兜底", JSON.stringify(slateInfo));

  // 2) 键盘兜底：三击内容区选中当前段落，再全选/退格。
  //    page.focus 对 contenteditable 不可靠，必须真实点击把光标放进去。
  try {
    const editable = await page.$(
      `${DY_EDITOR_SELECTOR} [contenteditable="true"]`
    );
    if (editable) {
      await editable.click({ clickCount: 3, delay: 20 });
    } else {
      await page.click(DY_EDITOR_SELECTOR, { clickCount: 3, delay: 20 });
    }
  } catch (_) {}
  try {
    await page.keyboard.down(mod);
    await page.keyboard.press("a");
    await page.keyboard.up(mod);
  } catch (_) {}
  try {
    await page.keyboard.press("Backspace");
  } catch (_) {}
  if (!normalizeDyEditorText(await readDyEditorText(page))) {
    console.log("[dy] 简介编辑器已通过键盘全选清空");
    return true;
  }

  // A) selection API + execCommand("delete")（官方兜底，Windows 后台窗口可能 no-op）
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      const s = window.getSelection && window.getSelection();
      if (s && s.selectAllChildren) {
        try {
          s.selectAllChildren(el);
        } catch (_) {}
      }
      if (document.execCommand) document.execCommand("delete");
    }, DY_EDITOR_SELECTOR);
  } catch (_) {}
  if (!normalizeDyEditorText(await readDyEditorText(page))) return true;

  // B) 换 Control 再试（部分 Chromium 构建把全选映射到 Ctrl）
  try {
    await page.click(DY_EDITOR_SELECTOR);
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
  } catch (_) {}
  return !normalizeDyEditorText(await readDyEditorText(page));
}

/**
 * 抖音简介（含 #标签）填写：确认清空 → 键盘输入 → 回读校验，未落地则
 * execCommand insertText 整段兜底重写，重试 maxAttempts 次仍失败抛错中止发布
 * （对齐快手 fillKsDescription 策略）：宁可走失败上报/自动重试，
 * 也不能发出空简介或与旧草稿叠加成双的作品。
 */
export async function fillDyDescription(
  page,
  description,
  pressSpaceAfter,
  { maxAttempts = 3 } = {}
) {
  await page.waitForSelector(DY_EDITOR_SELECTOR, {
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  const expected = normalizeDyEditorText(description || "");
  // 前缀锚点：话题胶囊转换会改写中后段文本（正文里的 # 会触发抖音话题搜索组件，
  // e2e 实证「issue #42」会让回读比原文少 1 字），但开头按序落地。
  const prefix = expected.slice(0, 12);
  // 长度窗口：下限容忍话题胶囊对中后段文本的改写；
  // 上限拦截「旧内容没清掉被追加成双」（叠加时长度近似翻倍）。
  const landedOk = (landed) => {
    if (!expected) return true;
    if (prefix && !landed.includes(prefix)) return false;
    return (
      landed.length >= expected.length - 12 &&
      landed.length <= Math.ceil(expected.length * 1.4) + 8
    );
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.click(DY_EDITOR_SELECTOR); // 定位光标 + 聚焦
    } catch (_) {
      /* click 偶发失败不致命，clearDyEditor 内有 focus 兜底 */
    }
    if (!(await clearDyEditor(page))) {
      console.warn(
        `[dy] 第 ${attempt} 次清空简介编辑器失败（旧内容仍在），重试`
      );
      continue;
    }
    if (description) {
      await page.keyboard.type(description, { delay: 50 });
    }
    // 抖音话题只有遇到空格/回车才会把当前 #xxx 转成话题胶囊；
    // 末尾补一次空格触发，否则最后一个标签不被识别。
    if (pressSpaceAfter) {
      await page.keyboard.press("Space");
    }

    let landed = normalizeDyEditorText(await readDyEditorText(page));
    if (landedOk(landed)) {
      if (attempt > 1) console.log(`[dy] 简介已在第 ${attempt} 次尝试写入`);
      return;
    }
    console.warn(
      `[dy] 第 ${attempt} 次简介未落地（期望 ${expected.length} 字，回读 ${landed.length} 字：「${landed.slice(0, 60)}」），execCommand 兜底重写`
    );

    // 兜底：全选删除后 insertText 整段写入（对富文本组件比键盘事件可靠）
    await page.evaluate((payload) => {
      const el = document.querySelector(payload.sel);
      if (!el) return;
      el.focus();
      if (document.createRange && window.getSelection) {
        try {
          const r = document.createRange();
          r.selectNodeContents(el);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        } catch (_) {}
      }
      if (document.execCommand) {
        document.execCommand("delete");
        document.execCommand("insertText", false, payload.text);
      }
    }, { sel: DY_EDITOR_SELECTOR, text: description || "" });
    if (pressSpaceAfter) {
      await page.keyboard.press("Space");
    }

    landed = normalizeDyEditorText(await readDyEditorText(page));
    if (landedOk(landed)) {
      console.log(
        `[dy] 简介已通过 execCommand 兜底写入（第 ${attempt} 次尝试）`
      );
      return;
    }
  }

  const finalText = normalizeDyEditorText(await readDyEditorText(page));
  throw new Error(
    `抖音简介填写失败：尝试 ${maxAttempts} 次后文案仍未正确写入编辑器（编辑器当前 ${finalText.length} 字：「${finalText.slice(0, 60)}」，期望 ${expected.length} 字），为避免发出空简介/内容叠加的作品已中止本次发布`
  );
}

export default async function (page, data, window, event) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;

  try {
    // 等待 name=upload-btn 的 input 出现
    await page.waitForSelector('input[name="upload-btn"]', {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    const uploadInputs = await page.$$('input[name="upload-btn"]');
    // 取最后一个 input 元素
    const uploadFileHandle = uploadInputs[uploadInputs.length - 1];
    await uploadFileHandle.uploadFile(path.resolve(data.filePath));
  } catch (e) {
    // 上传失败必须阻断：文件没进上传区还继续填表点发布，会发出残缺作品
    console.error("❌ 输入文件失败", e);
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: `抖音视频上传失败: ${(e && e.message) || String(e)}`,
      closeWindow: true,
    });
    return;
  }
  try {
    const text = buildPlatformVideoText("抖音", data.data);
    await page.waitForSelector(".semi-input", {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    // 获取元素句柄
    const input = await page.$(".semi-input");
    // 点击并清空内容
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    await page.type(".semi-input", text.title, { delay: 50 });
    // 回读校验：标题空写不能放过（发布后才补不回来）。
    // 按码点取前 8 字比较（slice 会切出孤立代理对）；不一致先重输一次再判失败。
    const readTitle = () =>
      input
        .evaluate((el) => String(el.value || el.textContent || "").trim())
        .catch(() => "");
    let typedTitle = await readTitle();
    if (!matchesHead(typedTitle, text.title)) {
      console.warn(
        `[dy] 标题回读不一致，重输一次（期望含「${head(text.title)}」，实得 ${
          typedTitle.length
        } 字）`
      );
      await replaceAllText(page, input, text.title, 80);
      typedTitle = await readTitle();
      if (!matchesHead(typedTitle, text.title)) {
        throw new Error(
          `标题未写入（期望含「${head(text.title)}」，实得 ${typedTitle.length} 字）`
        );
      }
    }

    // 描述（含 #标签）填写：确认清空 + 键盘输入 + 回读校验 + execCommand 兜底。
    // 必须清掉旧内容：抖音创作页同分区会恢复上次编辑的简介，清空失效时
    // 新简介会追加在旧内容后面 → 内容和标签成双，多次发布无限累加
    //（Windows 后台窗口下 execCommand("delete") 静默失效，2026-11-01 用户反馈）。
    await fillDyDescription(
      page,
      text.description,
      normalizeVideoTags(data.data.tags).length > 0
    );

    // Slate 状态重置会触发描述区重渲染，复核标题没有被动掉（空标题发布后补不回来）
    const titleInput = await page.$(".semi-input");
    if (!titleInput) {
      throw new Error("简介填写后未找到标题输入框");
    }
    const afterTitle = await titleInput
      .evaluate((el) => String(el.value || el.textContent || "").trim())
      .catch(() => "");
    if (!matchesHead(afterTitle, text.title)) {
      console.warn(
        `[dy] 简介填写后标题被重置（实得 ${afterTitle.length} 字），重输一次`
      );
      await replaceAllText(page, titleInput, text.title, 80);
      const again = await titleInput
        .evaluate((el) => String(el.value || el.textContent || "").trim())
        .catch(() => "");
      if (!matchesHead(again, text.title)) {
        throw new Error(
          `简介填写后标题重输失败（期望含「${head(
            text.title
          )}」，实得 ${again.length} 字）`
        );
      }
    }
  } catch (e) {
    console.error("❌ 输入标题失败", e);
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: `抖音标题/简介填写失败: ${(e && e.message) || String(e)}`,
      closeWindow: true,
    });
    return;
  }

  try {
    // 不依赖会随打包变化的 container-xxx：等预览区 video（抖音 CDN）与同容器内的 rc 进度条同时出现
    await pollPageUntil(
      page,
      () => {
        for (const v of document.querySelectorAll("video")) {
          const src = v.currentSrc || v.getAttribute("src") || "";
          if (!src.includes("douyin.com")) continue;
          const parent = v.parentElement;
          if (
            parent &&
            parent.querySelector(".rc-slider.rc-slider-horizontal")
          ) {
            return true;
          }
        }
        return false;
      },
      WAIT_UPLOAD_PROCESSING_MS
    );

    // 「保存权限」区域往往在预览视频就绪后才挂载；放在预览等待之后，并放宽文案/控件匹配
    await page.waitForFunction(
      () => {
        const norm = (t) => String(t).replace(/\s+/g, "").trim();
        const hasSaveTitleIn = (root) =>
          [...root.querySelectorAll("span")].some((s) =>
            norm(s.textContent).includes("保存权限")
          );
        for (const label of document.querySelectorAll("label")) {
          if (!label.textContent.includes("不允许")) continue;
          const inp = label.querySelector('input[value="0"]');
          if (!inp || (inp.type !== "checkbox" && inp.type !== "radio"))
            continue;
          let a = label;
          for (let i = 0; i < 28 && a; i++) {
            if (hasSaveTitleIn(a)) return true;
            a = a.parentElement;
          }
        }
        return false;
      },
      { timeout: 30000 }
    );
    const saved = await page.evaluate(() => {
      const norm = (t) => String(t).replace(/\s+/g, "").trim();
      const hasSaveTitleIn = (root) =>
        [...root.querySelectorAll("span")].some((s) =>
          norm(s.textContent).includes("保存权限")
        );
      for (const label of document.querySelectorAll("label")) {
        if (!label.textContent.includes("不允许")) continue;
        const inp = label.querySelector('input[value="0"]');
        if (!inp || (inp.type !== "checkbox" && inp.type !== "radio")) continue;
        let a = label;
        for (let i = 0; i < 28 && a; i++) {
          if (hasSaveTitleIn(a)) {
            label.click();
            return true;
          }
          a = a.parentElement;
        }
      }
      return false;
    });
    if (!saved) throw new Error("未找到保存权限-不允许");

    // 引导浮层（如「视频预览功能」）会挡住后续点击，先关掉
    await dismissDyGuideModals(page);

    // 自定义封面（可选）：需视频就绪后设置；横封面由抖音基于竖封面自动生成
    const coverPath = data.data && data.data.coverPath;
    if (coverPath) {
      await uploadDyCustomCover(page, coverPath);
      await dismissDyGuideModals(page);
    }

    // 自主声明入口在视频转码完成后才出现，必须在点击发布前完成
    await selectDyCreativeStatementWithRetry(page, data);

    // 挂车未确认成功时必须进入同一失败分支，不能继续发布无商品的视频。
    const productLink = resolveVideoLinkOption("抖音", data.publishOptions);
    if (productLink.enabled) await attachDyProductLink(page, productLink);

    const urlBefore = readPageUrl(page);
    await clickDyPublish(page, isDraftMode);
    // 抖音网页端没有草稿箱：点击成功 ≠ 草稿已留底，回执必须如实标注（P1-4）
    console.log(
      isDraftMode
        ? "✅ 抖音已点击存草稿（网页端无草稿箱，未能核验）"
        : "✅ 抖音视频上传成功"
    );
    await replyPublishOutcome({
      page,
      data,
      window,
      event,
      urlBefore,
      isDraftMode,
      successMessage: isDraftMode
        ? "已点击存草稿（抖音网页端无草稿箱，无法核验）"
        : "上传成功",
      extraPayload: isDraftMode ? { draftUnverified: true } : {},
    });
  } catch (e) {
    const detail = (e && e.message) || String(e);
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
      // 抖音发布失败后窗口是否关闭沿用原行为（上游统一处理）
      closeWindow: false,
    });
    console.error("❌ 上传失败", e);
  }
}
