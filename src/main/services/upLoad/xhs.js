import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import {
  isCreativeStatementNone,
  resolveXhsCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { WAIT_SELECTOR_APPEAR_MS, WAIT_UPLOAD_PROCESSING_MS, pollPageUntil } from "./uploadTimeouts.js";

// 小红书下拉里直接展示的支持选项；未匹配则跳过。
const XHS_SUPPORTED_STATEMENT_LABELS = new Set([
  "笔记含AI合成内容",
  "虚构演绎，仅供娱乐",
  "内容包含营销广告",
]);

async function selectXhsCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[xhs] creativeStatement 值 =", value);
  if (isCreativeStatementNone(value)) {
    console.log("[xhs] 无标注，小红书保持不选");
    return;
  }
  const label = resolveXhsCreativeStatementLabel(value);
  if (!XHS_SUPPORTED_STATEMENT_LABELS.has(label)) {
    console.warn(`[xhs] 当前声明值 "${value}" 在小红书没有对应选项，跳过`);
    return;
  }
  console.log("[xhs] 准备选择内容类型声明:", label);

  // 1. 点击「添加内容类型声明」触发下拉
  const opened = await page.evaluate(() => {
    const candidates = document.querySelectorAll(".d-select-placeholder");
    for (const el of candidates) {
      if ((el.textContent || "").trim() === "添加内容类型声明") {
        el.click();
        return true;
      }
    }
    return false;
  });
  if (!opened) {
    console.warn("未找到小红书「添加内容类型声明」入口，跳过");
    return;
  }

  // 2. 等下拉项渲染出来
  try {
    await page.waitForFunction(
      (text) => {
        // 注意：page.evaluate 回调会被序列化送进浏览器；某些打包链路会把 for...of
        // 转译成依赖 babel helper 的形式，导致 page 端报 "n is not defined"。
        // 这里用下标 for，避免转译。
        const names = document.querySelectorAll(".d-options-wrapper .d-option-name");
        for (var i = 0; i < names.length; i++) {
          var el = names[i];
          if ((el.textContent || "").trim() === text) return true;
        }
        return false;
      },
      { timeout: WAIT_SELECTOR_APPEAR_MS },
      label
    );
  } catch (e) {
    console.warn("小红书声明下拉项未出现:", e?.message || e);
    return;
  }

  // 3. 点选目标选项
  const picked = await page.evaluate((text) => {
    var items = document.querySelectorAll(".d-options-wrapper .d-option-name");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if ((el.textContent || "").trim() !== text) continue;
      // 顺着 grid 结构往上找可点击的 .d-grid-item / .d-option，整行触发点击
      var row = el.closest(".d-grid-item") || el.closest(".d-option") || el;
      var grid = row.parentElement;
      if (grid) {
        var handler = grid.querySelector(".d-option-handler");
        if (handler) {
          handler.click();
          return true;
        }
      }
      row.click();
      return true;
    }
    return false;
  }, label);

  if (!picked) {
    console.warn(`未找到小红书声明选项: ${label}`);
    return;
  }
  await page.waitForTimeout(400);
  console.log("[xhs] 已选择内容类型声明:", label);
}

function normalizeTagList(rawTagText = "") {
  const tagText = String(rawTagText).trim();
  if (!tagText) return [];

  return tagText
    .split(/[\s,，;；、]+/)
    .flatMap(tag => tag.split(/(?=#)/))
    .map(tag => tag.replace(/^#/, "").trim())
    .filter(Boolean);
}

export default async function (page, data, window, event) {
  const isDraftMode = data.publishMode === "draft" || data.publishToDraft === true;
  console.log("小红书上传开始:", data);

  try {
    const uploadSelector = "input.upload-input[type='file']";
    await page.waitForSelector(uploadSelector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const uploadInput = await page.$(uploadSelector);
    if (!uploadInput) throw new Error("未找到上传 input");
    await uploadInput.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("❌ 小红书文件上传失败:", err);
    // 文件上传是流程起点，失败必须重试，把异常抛给 puppeteerFile 的 actionCheckTimer
    throw new Error(`小红书文件上传失败：${err?.message || err}`);
  }

  try {
    const titleSelector = ".publish-page-content-base .edit-container .d-input input.d-text";
    await page.waitForSelector(titleSelector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const titleInput = await page.$(titleSelector);
    if (!titleInput) throw new Error("未找到标题输入框");
    const titleText = (data.data?.bt1 || data.data?.bt2 || "").trim();
    await titleInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    if (titleText) {
      await page.type(titleSelector, titleText, { delay: 50 });
    }
  } catch (err) {
    console.error("❌ 小红书标题填写失败:", err);
    // 标题也是必填，挂了直接抛触发重试
    throw new Error(`小红书标题填写失败：${err?.message || err}`);
  }

  await page.waitForTimeout(300);

  // 参考头条/快手/抖音的做法：完全用 page.keyboard.type 直接打字，
  // 不用 clipboard.writeText + Ctrl+V，也不用复杂的 page.evaluate range 操作
  // ——这套路在 Windows 打包后 webpack/babel 转译时不会触发 "n is not defined"。
  try {
    const editorSelector = ".tiptap.ProseMirror";
    await page.waitForSelector(editorSelector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const editor = await page.$(editorSelector);
    if (!editor) throw new Error("未找到正文编辑器");

    const descText = String(data.data?.bt2 || "").trim();
    const tags = normalizeTagList(data.data?.bq || "");

    // 聚焦编辑器（双击保证 caret 进去）
    await editor.click({ clickCount: 2 });
    await page.waitForTimeout(200);

    // 输入正文描述
    if (descText) {
      await page.keyboard.type(descText, { delay: 30 });
      await page.waitForTimeout(300);
    }

    // 输入标签：每个 #xxx 后 Enter 选中候选弹窗第一项（与抖音 / 视频号思路一致）
    if (tags.length) {
      if (descText) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(400);
      }
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        await page.keyboard.type("#" + tag, { delay: 30 });
        await page.waitForTimeout(600); // 等小红书话题候选弹窗
        await page.keyboard.press("Enter"); // 选中候选第一条 → 变成话题胶囊
        await page.waitForTimeout(300);
        // 标签之间补一个空格，避免下一个 # 被连到上一个胶囊里
        if (i < tags.length - 1) {
          await page.keyboard.type(" ", { delay: 30 });
        }
      }
    }
  } catch (err) {
    console.error("❌ 小红书正文/标签填写失败:", err);
    // 正文/标签是必填项，失败时抛出让 puppeteerFile.js 的 actionCheckTimer 接住并重试（最多 maxRetries 次）。
    throw new Error(`小红书正文/标签填写失败：${err?.message || err}`);
  }

  await page.waitForTimeout(300);

  try {
    const originalSwitchSelector = ".original-wrapper .custom-switch-switch";
    await page.waitForSelector(originalSwitchSelector, { timeout: 5000 });
    const originalSwitch = await page.$(originalSwitchSelector);
    if (!originalSwitch) throw new Error("未找到声明原创开关");
    await originalSwitch.click();

    try {
      await page.waitForSelector(".originalContainer input[type='checkbox']", { timeout: 3000 });
      const checked = await page.evaluate(() => {
        const originalContainer = document.querySelector(".originalContainer");
        if (!originalContainer) return false;

        const checkbox = originalContainer.querySelector("input[type='checkbox']");
        if (checkbox && !checkbox.checked) checkbox.click();

        return Boolean(checkbox);
      });
      if (checked) await page.waitForTimeout(300);
      const confirmed = await page.evaluate(() => {
        const originalContainer = document.querySelector(".originalContainer");
        if (!originalContainer) return false;

        const confirmBtn = originalContainer.querySelector(".footer .d-button");
        if (confirmBtn) confirmBtn.click();
        return Boolean(confirmBtn);
      });
      if (!checked || !confirmed) throw new Error("未找到声明原创确认项");
    } catch (_) {
      // 已声明过原创协议时不会出现确认弹窗，继续后续流程
    }
  } catch (err) {
    console.error("❌ 小红书声明原创失败:", err);
  }

  // 选择内容类型声明（无标注 / 不支持值会跳过）
  try {
    await selectXhsCreativeStatement(page, data);
  } catch (e) {
    console.warn("小红书内容类型声明选择未完成:", e?.message || e);
  }

  try {
    await pollPageUntil(
      page,
      () => {
        const video = document.querySelector(".video-area video");
        if (!video) return false;
        const src = video.getAttribute("src") || video.currentSrc || "";
        return String(src).trim().length > 0;
      },
      WAIT_UPLOAD_PROCESSING_MS
    );

    if (!isDraftMode) {
      await pollPageUntil(
        page,
        () => {
          const norm = text => String(text || "").replace(/\s+/g, "").trim();
          const bar = document.querySelector(".publish-page-publish-btn");
          if (!bar) return false;
          const buttons = Array.from(bar.querySelectorAll("button"));
          const publishBtn = buttons.find(btn => norm(btn.textContent) === "发布");
          if (!publishBtn) return false;
          return !publishBtn.disabled
            && !publishBtn.hasAttribute("disabled")
            && publishBtn.getAttribute("aria-disabled") !== "true"
            && !String(publishBtn.className || "").includes("disabled");
        },
        WAIT_UPLOAD_PROCESSING_MS
      );
    }
    
    const clicked = await page.evaluate(draftMode => {
      const norm = text => String(text || "").replace(/\s+/g, "").trim();
      const isDisabled = btn => Boolean(
        btn.disabled
          || btn.hasAttribute("disabled")
          || btn.getAttribute("aria-disabled") === "true"
          || String(btn.className || "").includes("disabled")
      );
      const bar = document.querySelector(".publish-page-publish-btn");
      if (!bar) return false;
      const buttons = Array.from(bar.querySelectorAll("button"));
      // 发布
      const publishBtn = buttons.find(btn => norm(btn.textContent) === "发布");
      // 存到草稿
      const publishDraftBtn = buttons.find(btn => norm(btn.textContent) === "暂存离开");
      const targetBtn = draftMode ? publishDraftBtn : publishBtn;
      if (!targetBtn) return false;
      if (!draftMode && isDisabled(targetBtn)) return false;
      targetBtn.click();
      return true;
    }, isDraftMode);

    if (!clicked) throw new Error(isDraftMode ? "未找到暂存离开按钮" : "未找到发布按钮");

    console.log(isDraftMode ? "✅ 小红书视频已保存草稿" : "✅ 小红书视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: isDraftMode ? "保存草稿成功" : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (err) {
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
    maybeClosePublishWindow(data, window);
    console.error("❌ 小红书发布失败:", err);
  }
}
