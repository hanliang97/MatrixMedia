import path from "path";
import {
  readPageUrl,
  replyPublishFailure,
  replyPublishOutcome,
} from "./publishOutcome.js";
import {
  isCreativeStatementNone,
  resolveKsCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { buildPlatformVideoText } from "../../../shared/videoMetadata.js";
import { resolveVideoLinkOption } from "../../../shared/videoLink.js";
import { attachKsProductLink } from "./ksProductLink.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";

export const KS_DESCRIPTION_SELECTOR = "#work-description-edit";

function collapseText(t) {
  return String(t || "").replace(/\s+/g, "");
}

/** 读取快手描述编辑器当前内容（页面已销毁时返回空串） */
function readKsDescription(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? String(el.innerText || el.textContent || "") : "";
  }, KS_DESCRIPTION_SELECTOR);
}

/**
 * 快手没有单独的标题输入框，作品标题取自描述文案；用户填了标题时把它拼在描述最前面
 * （描述已以标题开头时不重复拼接）。#34
 */
export function composeKsFillText({ title, description } = {}) {
  const t = String(title || "").trim();
  const d = String(description || "").trim();
  if (!t) return d;
  if (!d) return t;
  if (collapseText(d).startsWith(collapseText(t))) return d;
  return `${t}\n${d}`;
}

/**
 * 往快手描述编辑器（#work-description-edit，contenteditable 自定义组件）写文案。
 *
 * keyboard.type 对这类组件在隐藏窗口/遮罩残留时经常不落地（#34：静默发出空标题作品），
 * 所以每次写入后必须回读校验：
 *   1. 主路径 click 聚焦 + keyboard.type；
 *   2. 回读未落地 → 清空后用 document.execCommand('insertText') 兜底（同小红书适配器）；
 *   3. 重试 maxAttempts 次（默认 3），仍失败则抛错中止发布，
 *      宁可走失败上报/自动重试，也不能把空标题/空简介的作品发出去。
 */
export async function fillKsDescription(page, fillText, { maxAttempts = 3 } = {}) {
  await page.waitForSelector(KS_DESCRIPTION_SELECTOR, {
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  const expected = collapseText(fillText);
  let landed = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 聚焦 + 清空旧内容：puppeteer click 定位 caret，evaluate focus 双保险，再全选删除
    try {
      await page.click(KS_DESCRIPTION_SELECTOR, { clickCount: 3 });
    } catch (_) {
      // click 偶发失败不致命，下面 evaluate focus 兜底
    }
    await page.evaluate((sel) => {
      var el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      var s = window.getSelection && window.getSelection();
      if (s && s.selectAllChildren) {
        try {
          s.selectAllChildren(el);
        } catch (_) {}
      }
      if (document.execCommand) document.execCommand("delete");
    }, KS_DESCRIPTION_SELECTOR);
    if (fillText) {
      await page.keyboard.type(fillText, { delay: 50 });
    }

    landed = collapseText(await readKsDescription(page));
    if (!expected || (landed && landed.includes(expected))) {
      if (attempt > 1) console.log(`[ks] 描述已在第 ${attempt} 次尝试写入`);
      return true;
    }
    console.warn(
      `[ks] 第 ${attempt} 次填写描述未落地（回读到 ${landed.length} 字），尝试 execCommand 兜底`
    );

    // 兜底：全选删除后 insertText，对富文本组件比键盘事件可靠
    await page.evaluate(
      (payload) => {
        var el = document.querySelector(payload.sel);
        if (!el) return;
        el.focus();
        if (document.createRange && window.getSelection) {
          try {
            var r = document.createRange();
            r.selectNodeContents(el);
            var s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
          } catch (_) {}
        }
        if (document.execCommand) {
          document.execCommand("delete");
          document.execCommand("insertText", false, payload.text);
        }
      },
      { sel: KS_DESCRIPTION_SELECTOR, text: fillText }
    );

    landed = collapseText(await readKsDescription(page));
    if (!expected || (landed && landed.includes(expected))) {
      console.log(`[ks] 描述已通过 execCommand 兜底写入（第 ${attempt} 次尝试）`);
      return true;
    }
  }

  throw new Error(
    `快手描述填写失败：尝试 ${maxAttempts} 次后文案仍未写入编辑器（编辑器当前 ${landed.length} 字），为避免发出空标题/空简介的作品已中止本次发布`
  );
}

async function selectKsCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[ks] creativeStatement 值 =", value);
  // 快手目前只支持 AI 生成 / 演绎情节 两个选项；其它值（含「无标注」）无对应选项，跳过即可。
  if (isCreativeStatementNone(value)) {
    console.log("[ks] 无标注，快手保持默认不选");
    return;
  }
  const label = resolveKsCreativeStatementLabel(value);
  // 当前快手「作者声明」下拉支持的四个文案；未匹配则跳过。
  const SUPPORTED = new Set([
    "内容为AI生成",
    "演绎情节，仅供娱乐",
    "个人观点，仅供参考",
    "素材来源于网络",
  ]);
  if (!SUPPORTED.has(label)) {
    console.warn(`[ks] 当前声明值 "${value}" 在快手没有对应选项，跳过`);
    return;
  }
  console.log("[ks] 准备选择声明:", label);

  // 1. 通过 label 文本"作者声明 / 作品声明 / 声明"定位下拉触发器；返回它的 id 给后续用 page.click。
  //    ant-design Select 监听的是 mousedown，必须用真实鼠标事件（page.click 自带）才能打开下拉。
  const triggerInfo = await page.evaluate(() => {
    var norm = function (t) {
      return String(t || "")
        .replace(/\s+/g, "")
        .trim();
    };
    var LABEL_KEYWORDS = ["作者声明", "作品声明", "创作声明", "声明"];
    var formItems = document.querySelectorAll(
      '[class*="edit-form-item"], [class*="form-item"]'
    );
    for (var i = 0; i < formItems.length; i++) {
      var item = formItems[i];
      var label = item.querySelector("label");
      var labelText = norm(label && label.textContent);
      var matched = false;
      for (var k = 0; k < LABEL_KEYWORDS.length; k++) {
        if (labelText.indexOf(LABEL_KEYWORDS[k]) !== -1) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
      var sel = item.querySelector(".ant-select");
      var selector = sel && sel.querySelector(".ant-select-selector");
      if (!selector) continue;
      var id = "__ks_statement_trigger_" + Date.now() + "__";
      selector.setAttribute("id", id);
      return { ok: true, matchedLabel: labelText, id: id };
    }
    var labels = [];
    for (var j = 0; j < formItems.length; j++) {
      var l = formItems[j].querySelector("label");
      labels.push(norm(l && l.textContent));
    }
    return { ok: false, labels: labels };
  });

  if (!triggerInfo || !triggerInfo.ok) {
    console.warn(
      "未找到快手声明下拉触发器，跳过。当前页 form-item labels:",
      JSON.stringify(triggerInfo && triggerInfo.labels)
    );
    return;
  }
  console.log("[ks] 找到下拉触发器, label =", triggerInfo.matchedLabel);

  // 用 puppeteer 真鼠标事件打开 dropdown（ant-design 走 mousedown）
  try {
    await page.click(`#${triggerInfo.id}`, { delay: 80 });
    console.log("[ks] 已 page.click 打开下拉");
  } catch (e) {
    console.warn("[ks] page.click 失败，尝试 DOM 派发事件:", e?.message || e);
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }, triggerInfo.id);
    console.log("[ks] 已 DOM 派发 mousedown/mouseup/click");
  }

  // 2. 等下拉项可见（ant-design 用 rc-virtual-list，可见项是 .ant-select-item.ant-select-item-option，
  //    其 title 属性 = 文案；隐藏的 [role="option"] 不可点击，要忽略）
  try {
    await page.waitForFunction(
      (text) => {
        var opts = document.querySelectorAll(
          ".ant-select-dropdown .ant-select-item.ant-select-item-option"
        );
        for (var i = 0; i < opts.length; i++) {
          var o = opts[i];
          var t =
            o.getAttribute("title") ||
            (o.querySelector(".ant-select-item-option-content") || {})
              .textContent ||
            "";
          if (String(t).trim() === text) return true;
        }
        return false;
      },
      { timeout: 15000 },
      label
    );
  } catch (e) {
    console.warn("快手声明下拉项未出现:", e?.message || e);
    return;
  }

  // 3. 点选目标选项：点 .ant-select-item-option 本身（ant-design 在它上面绑定 mousedown）
  const pickResult = await page.evaluate((text) => {
    var opts = document.querySelectorAll(
      ".ant-select-dropdown .ant-select-item.ant-select-item-option"
    );
    var titles = [];
    for (var ti = 0; ti < opts.length; ti++) {
      titles.push(opts[ti].getAttribute("title") || "");
    }
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var t =
        o.getAttribute("title") ||
        (o.querySelector(".ant-select-item-option-content") || {})
          .textContent ||
        "";
      if (String(t).trim() !== text) continue;
      var rect = o.getBoundingClientRect();
      var opts2 = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      // ant-design Option 走 mousedown 选中：派发完整事件序列保证生效
      o.dispatchEvent(new MouseEvent("mousedown", opts2));
      o.dispatchEvent(new MouseEvent("mouseup", opts2));
      o.dispatchEvent(new MouseEvent("click", opts2));
      var inner = o.querySelector(".ant-select-item-option-content");
      if (inner) {
        inner.dispatchEvent(new MouseEvent("click", opts2));
      }
      return { ok: true, titles: titles };
    }
    return { ok: false, titles: titles };
  }, label);

  if (!pickResult || !pickResult.ok) {
    console.warn(
      `未找到快手声明选项: ${label}；下拉里实际 title 列表 = ${JSON.stringify(
        pickResult && pickResult.titles
      )}`
    );
    return;
  }
  await page.waitForTimeout(300);
  console.log("[ks] 已选择声明:", label);
}

export default async function (page, data, window, event) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;
  const submitText = isDraftMode ? "取消" : "发布";

  console.log(data);
  let descFillText = "";
  try {
    let sel = '#joyride-wrapper input[type="file"]';
    await page.waitForSelector(sel, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const uploadInputs = await page.$(sel);
    await uploadInputs.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  // 描述（含标题拼接）填写：回读校验 + execCommand 兜底，失败抛错中止发布（#34）。
  // 抛错交给上层失败上报/自动重试，避免静默发出空标题/空简介的作品。
  try {
    const text = buildPlatformVideoText("快手", data.data);
    descFillText = composeKsFillText(text);
    await fillKsDescription(page, descFillText);
  } catch (e) {
    console.error("❌ 快手描述填写失败:", e?.message || e);
    throw e;
  }
  try {
    await page.click(".ant-checkbox-group>label:nth-of-type(2)", {
      delay: 200,
    });
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }

  // 选择创作声明（快手只支持 AI 生成 / 演绎情节，其它值跳过）
  try {
    await selectKsCreativeStatement(page, data);
  } catch (e) {
    console.warn("快手创作声明选择未完成:", e?.message || e);
  }

  let productAttachmentPending = false;
  try {
    // 用 pollPageUntil 替代 waitForSelector，避免 puppeteer 默认 protocolTimeout
    // (约 180s) 在大文件/弱网下把单次 Runtime.callFunctionOn 砍掉。
    await pollPageUntil(
      page,
      () => !!document.querySelector("#preview-tours video"),
      WAIT_UPLOAD_PROCESSING_MS,
      2000,
      "等待快手视频上传完成超时"
    );
    // 必须先确认商品选中，再进入发布/草稿按钮分支；任何失败都由本 try 的失败回执结束。
    const link = resolveVideoLinkOption("快手", data.publishOptions);
    if (link && link.enabled === true) {
      productAttachmentPending = true;
      await attachKsProductLink(page, link);
      productAttachmentPending = false;
    }
    await page.waitForFunction(
      (text) => {
        const bar = document.querySelector("#setting-tours + div");
        if (!bar || bar.offsetParent === null) return false;
        for (const row of bar.querySelectorAll(":scope > div")) {
          const t = row.textContent.replace(/\s+/g, "").trim();
          if (t === text) return true;
        }
        return false;
      },
      { timeout: 10000 },
      submitText
    );

    // 快手发布按钮点击：原先用 page.evaluateHandle 返回行级 div 再 puppeteer click，
    // 在 hidden window 下几何中心常落不到真正的 <button> 上，结果是"看起来点过了但没发"。
    // 改为在 evaluate 内部遍历真实 button / 行 div，直接调 DOM .click()，避开鼠标几何问题。
    // 快手草稿功能和发布一个逻辑一个是 发布 一个是取消两个字
    // 提交前最后回读一次：编辑器被页面清空/重置时中止，避免发出空标题简介的作品（#34）
    if (descFillText) {
      const landed = await readKsDescription(page);
      if (!collapseText(landed)) {
        throw new Error("提交前校验失败：快手描述编辑器为空（可能被页面重置），已中止发布");
      }
    }
    const urlBefore = readPageUrl(page);
    const clicked = await page.evaluate((text) => {
      const norm = (t) =>
        String(t || "")
          .replace(/\s+/g, "")
          .trim();
      const bar = document.querySelector("#setting-tours + div");
      if (!bar) return { ok: false, reason: "no-bar" };
      for (const btn of bar.querySelectorAll("button")) {
        if (norm(btn.textContent) === text && !btn.disabled) {
          btn.click();
          return { ok: true, via: "button" };
        }
      }
      for (const row of bar.querySelectorAll(":scope > div")) {
        if (norm(row.textContent) === text) {
          const inner = row.querySelector("button,[role='button']");
          if (inner) {
            inner.click();
            return { ok: true, via: "row>inner" };
          }
          row.click();
          return { ok: true, via: "row" };
        }
      }
      return { ok: false, reason: "no-match" };
    }, submitText);
    if (!clicked || !clicked.ok) {
      throw new Error(`未找到${submitText}按钮(${clicked && clicked.reason})`);
    }
    console.log(
      isDraftMode
        ? `✅ 快手视频已保存草稿，click via=${clicked.via}`
        : `✅ 快手视频已触发发布，click via=${clicked.via}`
    );
    await replyPublishOutcome({
      page,
      data,
      window,
      event,
      urlBefore,
      isDraftMode,
      successMessage: isDraftMode ? "保存草稿成功" : "上传成功",
    });
  } catch (e) {
    // 失败瞬间截图留证（登录过期 / 风控弹窗 / 元素改版都能一眼看出）
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: productAttachmentPending
        ? `快手挂车失败，已停止发布：${e && e.message ? e.message : "无法确认商品状态"}`
        : "上传失败",
      ...(productAttachmentPending ? {
        extraPayload: { outcome: "product_link_failed", needsAttention: true },
      } : {}),
    });
    console.error("❌ 发布失败", e);
  }
}
