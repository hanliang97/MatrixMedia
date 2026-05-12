import fs from "fs";
import path from "path";
import { clipboard } from "electron";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

const TITLE_SELECTOR = ".header .title-input";
const CODEMIRROR_SELECTOR = ".bytemd-editor .CodeMirror";
const CODEMIRROR_LINES_SELECTOR = ".bytemd-editor .CodeMirror-lines";
const EDITOR_SELECTOR = ".bytemd-editor .CodeMirror-code .CodeMirror-line";
const COVER_INPUT_SELECTOR = ".coverselector_container input[type='file']";
const PUBLISH_BUTTON_SELECTOR = ".right-box button.xitu-btn";
const CATEGORY_SELECTOR = ".category-list .item";
const TAG_INPUT_SELECTOR = ".tag-input .byte-select__input";
const SUMMARY_SELECTOR = ".summary-textarea textarea";
const CONFIRM_BUTTON_SELECTOR = ".footer .btn-container .ui-btn.primary";
const POST_CONFIRM_CHECK_MS = 5000;
const DEFAULT_CATEGORY = "前端";
const DEFAULT_TAGS = "前端 electron";

function getErrorMessage(error) {
  if (!error) return "未知错误";
  return error.message || (typeof error === "string" ? error : String(error));
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeTags(raw) {
  const text = String(raw || "").trim() || DEFAULT_TAGS;
  return text
    .split(/[\s,，;；、]+/)
    .map(tag => tag.trim())
    .filter(Boolean);
}

function readArticleContent(data) {
  const article = data.data || {};
  const directContent = String(article.content || "");
  if (directContent.trim()) return directContent;

  const articleFilePath = article.articleFilePath || data.articleFilePath;
  if (!articleFilePath) throw new Error("请填写正文或选择文章文件");

  const absolutePath = path.resolve(articleFilePath);
  const ext = path.extname(absolutePath).toLowerCase();
  if (![".md", ".txt"].includes(ext)) {
    throw new Error("文章文件仅支持 .md 或 .txt");
  }

  const fileContent = fs.readFileSync(absolutePath, "utf-8");
  if (!fileContent.trim()) throw new Error("文章正文为空");
  return fileContent;
}

async function pasteText(page, text) {
  const originalClipboardText = clipboard.readText();
  const modifierKey = process.platform === "darwin" ? "Meta" : "Control";

  try {
    clipboard.writeText(text);
    await page.keyboard.down(modifierKey);
    await page.keyboard.press("KeyV");
  } finally {
    await page.keyboard.up(modifierKey).catch(() => {});
    clipboard.writeText(originalClipboardText);
  }
}

async function setCodeMirrorContent(page, content) {
  await page.waitForSelector(CODEMIRROR_SELECTOR, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  const result = await page.evaluate((selector, text) => {
    const wrapper = document.querySelector(selector);
    const cm = wrapper && wrapper.CodeMirror;
    if (!cm || typeof cm.setValue !== "function") return false;
    cm.focus();
    cm.setValue(text);
    if (typeof cm.setCursor === "function") {
      const lastLine = Math.max(0, cm.lineCount() - 1);
      cm.setCursor(lastLine, cm.getLine(lastLine).length);
    }
    if (typeof cm.refresh === "function") cm.refresh();
    return true;
  }, CODEMIRROR_SELECTOR, content);

  if (!result) {
    await page.waitForSelector(CODEMIRROR_LINES_SELECTOR, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
    await page.click(CODEMIRROR_LINES_SELECTOR, { clickCount: 2 });
    await pasteText(page, content);
  }

  await page.waitForTimeout(500);
  const hasContent = await page.evaluate((selector, expectedText) => {
    const wrapper = document.querySelector(selector);
    const cm = wrapper && wrapper.CodeMirror;
    const value = cm && typeof cm.getValue === "function"
      ? cm.getValue()
      : String(document.querySelector(".bytemd-editor .CodeMirror-code")?.textContent || "");
    const probe = String(expectedText || "").trim().slice(0, 20);
    return value.trim().length > 0 && (!probe || value.indexOf(probe) !== -1);
  }, CODEMIRROR_SELECTOR, content);

  if (!hasContent) {
    throw new Error("正文写入后未检测到内容");
  }
}

async function clickByText(page, selector, text, label) {
  await page.waitForSelector(selector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  const clicked = await page.evaluate((sel, targetText) => {
    const normalize = value => String(value || "").replace(/\s+/g, "").trim();
    const items = Array.from(document.querySelectorAll(sel));
    const target = items.find(item => normalize(item.textContent) === normalize(targetText));
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  }, selector, text);

  if (!clicked) throw new Error(`未找到${label}: ${text}`);
}

async function fillInput(page, selector, value, label) {
  await page.waitForSelector(selector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (value) await page.type(selector, value, { delay: 30 });
}

async function selectTag(page, tag) {
  await page.waitForSelector(TAG_INPUT_SELECTOR, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  await page.click(TAG_INPUT_SELECTOR);

  const modifierKey = process.platform === "darwin" ? "Meta" : "Control";
  try {
    await page.keyboard.down(modifierKey);
    await page.keyboard.press("KeyA");
  } finally {
    await page.keyboard.up(modifierKey).catch(() => {});
  }
  await page.keyboard.press("Backspace");
  await page.type(TAG_INPUT_SELECTOR, tag, { delay: 50 });
  await page.waitForTimeout(800);

  const clicked = await page.evaluate(tagText => {
    const normalize = value => String(value || "").replace(/\s+/g, "").trim().toLowerCase();
    const dropdownSelectors = [
      ".byte-select-dropdown",
      ".byte-select__dropdown",
      ".byte-select-dropdown-wrapper",
      ".byte-select__dropdown-wrapper",
    ];
    const optionSelectors = [
      ".byte-select-option",
      ".byte-select__option",
      "[role='option']",
      ".byte-select-dropdown [role='option']",
      ".byte-select__dropdown [role='option']",
    ];
    const dropdowns = Array.from(document.querySelectorAll(dropdownSelectors.join(",")));
    const scopedOptions = dropdowns.flatMap(dropdown => Array.from(dropdown.querySelectorAll(optionSelectors.join(","))));
    const directOptions = Array.from(document.querySelectorAll(".byte-select-option, .byte-select__option"));
    const candidates = Array.from(new Set([...scopedOptions, ...directOptions]));
    const normalizedTag = normalize(tagText);
    const matched = candidates.find(candidate => normalize(candidate.textContent) === normalizedTag)
      || candidates.find(candidate => normalize(candidate.textContent).includes(normalizedTag));
    if (!matched) return false;
    matched.scrollIntoView({ block: "center", inline: "center" });
    matched.click();
    return true;
  }, tag);

  if (!clicked) {
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(500);
}

async function waitForPostConfirmResult(page) {
  await page.waitForTimeout(POST_CONFIRM_CHECK_MS);
  const result = await page.evaluate(confirmSelector => {
    const isVisible = el => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
    };
    const errorTextReg = /失败|错误|异常|不能为空|请选择|请填写|未找到|无效|过长|最多|至少/;
    const noticeSelectors = [
      "[class*='error']",
      "[class*='Error']",
      "[class*='toast']",
      "[class*='Toast']",
      "[class*='message']",
      "[class*='Message']",
      "[class*='notify']",
      "[class*='Notify']",
      "[class*='warning']",
      "[class*='Warning']",
    ];
    const notices = Array.from(document.querySelectorAll(noticeSelectors.join(",")));
    const errorText = notices
      .filter(isVisible)
      .map(el => String(el.textContent || "").trim())
      .find(text => text && errorTextReg.test(text));
    const confirmButton = document.querySelector(confirmSelector);
    return {
      errorText: errorText || "",
      confirmStillVisible: isVisible(confirmButton),
    };
  }, CONFIRM_BUTTON_SELECTOR);

  if (result && result.errorText) {
    throw new Error(result.errorText);
  }
  if (result && result.confirmStillVisible) {
    throw new Error("点击确认后发布弹窗仍未关闭，可能存在未满足的发布条件");
  }
}

export default async function (page, data, window, event) {
  let publishStage = "初始化";

  try {
    const article = data.data || {};
    const title = firstText(article.title, article.bt1, data.bt);
    if (!title) throw new Error("请填写文章标题");

    publishStage = "读取正文";
    const content = readArticleContent(data);

    publishStage = "填写标题";
    await fillInput(page, TITLE_SELECTOR, title, "掘金标题输入框");

    publishStage = "填写正文";
    await page.waitForSelector(EDITOR_SELECTOR, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
    await setCodeMirrorContent(page, content);

    const coverPath = article.coverPath || data.coverPath;
    if (coverPath) {
      publishStage = "上传封面";
      await page.waitForSelector(COVER_INPUT_SELECTOR, { timeout: WAIT_SELECTOR_APPEAR_MS });
      const coverInput = await page.$(COVER_INPUT_SELECTOR);
      if (!coverInput) throw new Error("未找到掘金封面上传 input");
      await coverInput.uploadFile(path.resolve(coverPath));
      await page.waitForTimeout(2000);
    }

    publishStage = "打开发布弹窗";
    await page.waitForSelector(PUBLISH_BUTTON_SELECTOR, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
    await page.click(PUBLISH_BUTTON_SELECTOR);
    await page.waitForTimeout(1000);

    publishStage = "选择分类";
    await clickByText(page, CATEGORY_SELECTOR, firstText(article.category, data.category) || DEFAULT_CATEGORY, "掘金分类");

    publishStage = "选择标签";
    const tags = normalizeTags(firstText(article.tags, article.bq, data.tags, data.bq));
    for (const tag of tags) {
      await selectTag(page, tag);
    }

    const summary = firstText(article.summary);
    if (summary) {
      publishStage = "填写摘要";
      try {
        await fillInput(page, SUMMARY_SELECTOR, summary, "掘金摘要输入框");
      } catch (summaryError) {
        console.warn("掘金摘要填写失败，继续发布", summaryError);
      }
    }

    publishStage = "确认发布";
    await page.waitForSelector(CONFIRM_BUTTON_SELECTOR, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
    await page.click(CONFIRM_BUTTON_SELECTOR);
    await waitForPostConfirmResult(page);

    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      message: "文章发布成功",
    });
    maybeClosePublishWindow(data, window);
  } catch (error) {
    const detail = getErrorMessage(error);
    console.error(`掘金文章发布失败，阶段：${publishStage}`, error);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: `文章发布失败：${publishStage} - ${detail}`,
    });
    maybeClosePublishWindow(data, window);
  }
}
