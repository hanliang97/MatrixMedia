import path from "path";
import { clipboard } from "electron";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_UPLOAD_PROCESSING_MS, pollPageUntil } from "./uploadTimeouts.js";

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
    await page.waitForSelector(uploadSelector, { timeout: 10000 });
    const uploadInput = await page.$(uploadSelector);
    if (!uploadInput) throw new Error("未找到上传 input");
    await uploadInput.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("❌ 小红书文件上传失败:", err);
  }

  try {
    const titleSelector = ".publish-page-content-base .edit-container .d-input input.d-text";
    await page.waitForSelector(titleSelector, { timeout: WAIT_UPLOAD_PROCESSING_MS });
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
  }

  await page.waitForTimeout(300);

  try {
    const editorSelector = ".tiptap.ProseMirror";
    await page.waitForSelector(editorSelector, { timeout: 10000 });
    const editor = await page.$(editorSelector);
    if (!editor) throw new Error("未找到正文编辑器");

    const descText = String(data.data?.bt2 || "").trim();
    const tags = normalizeTagList(data.data?.bq || "");

    await editor.click({ clickCount: 2 });
    const modifierKey = process.platform === "darwin" ? "Meta" : "Control";
    await page.evaluate(selector => {
      const editor = document.querySelector(selector);
      if (!editor) return;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, editorSelector);
    await page.keyboard.press("Backspace");
    if (descText || tags.length) {
      const originalClipboardText = clipboard.readText();
      try {
        if (descText) {
          clipboard.writeText(descText);
          await page.keyboard.down(modifierKey);
          await page.keyboard.press("KeyV");
          await page.keyboard.up(modifierKey);
          await page.waitForTimeout(300);

          const hasContent = await page.evaluate(selector => {
            const editor = document.querySelector(selector);
            return Boolean(editor && editor.textContent.trim());
          }, editorSelector);
          if (!hasContent) {
            await page.evaluate((selector, text) => {
              const editor = document.querySelector(selector);
              if (!editor) return;
              editor.focus();
              document.execCommand("insertText", false, text);
              editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
            }, editorSelector, descText);
          }
        }

        if (tags.length) {
          if (descText) {
            await page.keyboard.press("Enter");
            await page.waitForTimeout(800);
          }
          for (const tag of tags) {
            await page.evaluate(selector => {
              const editor = document.querySelector(selector);
              if (!editor) return;
              editor.focus();
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
            }, editorSelector);
            clipboard.writeText(`#${tag}`);
            await page.keyboard.down(modifierKey);
            await page.keyboard.press("KeyV");
            await page.keyboard.up(modifierKey);
            await page.waitForTimeout(800);
            const hasTag = await page.evaluate((selector, tagName) => {
              const editor = document.querySelector(selector);
              return Boolean(editor && editor.textContent.includes(tagName));
            }, editorSelector, tag);
            if (!hasTag) {
              await page.evaluate((selector, tagName) => {
                const editor = document.querySelector(selector);
                if (!editor) return;
                editor.focus();
                document.execCommand("insertText", false, `#${tagName}`);
                editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: `#${tagName}` }));
              }, editorSelector, tag);
            }
            await page.keyboard.press("Enter");
            await page.waitForTimeout(800);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(800);
          }
        }
      } finally {
        clipboard.writeText(originalClipboardText);
      }
    }
  } catch (err) {
    console.error("❌ 小红书正文/标签填写失败:", err);
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
