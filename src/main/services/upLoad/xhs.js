import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_UPLOAD_PROCESSING_MS } from "./uploadTimeouts.js";

function normalizeTagList(rawTagText = "") {
  return String(rawTagText)
    .trim()
    .split(/\s+/)
    .map(tag => tag.replace(/^#/, "").trim())
    .filter(Boolean);
}

export default async function (page, data, window, event) {
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
    const titleSelector = ".edit-container .d-input input.d-text";
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

  try {
    const editorSelector = ".edit-container .tiptap.ProseMirror[contenteditable='true']";
    await page.waitForSelector(editorSelector, { timeout: 10000 });
    const editor = await page.$(editorSelector);
    if (!editor) throw new Error("未找到正文编辑器");

    const descText = String(data.data?.bdText || data.data?.bt2 || "").trim();
    const tags = normalizeTagList(data.data?.bq || "");
    const tagText = tags.map(tag => `#${tag}`).join(" ");
    const finalText = [descText, tagText].filter(Boolean).join("\n");

    await editor.click();
    await page.keyboard.down("Meta");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Meta");
    await page.keyboard.press("Backspace");
    if (finalText) {
      await page.keyboard.type(finalText, { delay: 40 });
    }
  } catch (err) {
    console.error("❌ 小红书正文/标签填写失败:", err);
  }

  try {
    await page.waitForFunction(
      () => {
        const video = document.querySelector(".video-area video");
        if (!video) return false;
        const src = video.getAttribute("src") || video.currentSrc || "";
        return String(src).trim().length > 0;
      },
      { timeout: WAIT_UPLOAD_PROCESSING_MS }
    );

    const clicked = await page.evaluate(() => {
      const norm = text => String(text || "").replace(/\s+/g, "").trim();
      const bar = document.querySelector(".publish-page-publish-btn");
      if (!bar) return false;
      const buttons = Array.from(bar.querySelectorAll("button"));
      const publishBtn = buttons.find(btn => norm(btn.textContent) === "发布");
      if (!publishBtn) return false;
      publishBtn.click();
      return true;
    });

    if (!clicked) throw new Error("未找到发布按钮");

    console.log("✅ 小红书视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "上传成功",
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
