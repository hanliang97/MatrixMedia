import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_SELECTOR_APPEAR_MS, WAIT_UPLOAD_PROCESSING_MS, pollPageUntil } from "./uploadTimeouts.js";
import ttPublishMode from "./ttPublishMode.js";

const {
  getToutiaoCoverItemSelector,
  getToutiaoCoverMode,
  getToutiaoCoverTriggerSelector,
  getToutiaoPosterDialogSelector,
  isToutiaoProgressComplete,
  shouldClickToutiaoCoverClip,
  shouldRetryToutiaoProgressMissing,
  shouldSaveToutiaoDraft,
} = ttPublishMode;
const TAG_SELECTOR = ".byte-checkbox-group span:nth-child(5) > label";

function getErrorMessage(error) {
  if (!error) return "未知错误";
  return error.message || (typeof error === "string" ? error : String(error));
}

async function trySelectHorizontalTag(page) {
  try {
    const tag = await page.waitForSelector(TAG_SELECTOR, { visible: true, timeout: 2000 });
    await tag.click({ delay: 200 });
    return true;
  } catch (e) {
    console.warn("头条标签不可用，按竖屏流程跳过标签和草稿", e && e.message ? e.message : e);
    return false;
  }
}

async function tryClickOptional(page, selector, timeout = 1200) {
  try {
    const element = await page.waitForSelector(selector, { visible: true, timeout });
    await element.click({ delay: 200 });
    return true;
  } catch (e) {
    console.log(`头条可选按钮未出现，跳过 ${selector}`, getErrorMessage(e));
    return false;
  }
}

async function clickReadyElement(page, selector, label, timeout = WAIT_SELECTOR_APPEAR_MS) {
  await page.waitForFunction(
    sel => {
      const element = document.querySelector(sel);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.classList.contains("cannot-click") &&
        element.getAttribute("aria-disabled") !== "true" &&
        element.getAttribute("disabled") === null
      );
    },
    { timeout },
    selector
  );
  const clicked = await page.evaluate(sel => {
    const element = document.querySelector(sel);
    if (!element) return false;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`未找到${label}`);
}

async function setToutiaoCover(page, hasTagSelector, setPublishStage) {
  const coverMode = getToutiaoCoverMode({ hasTagSelector });
  const coverItemSelector = getToutiaoCoverItemSelector();
  await page.waitForSelector(coverItemSelector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  const coverItems = await page.$$(coverItemSelector);
  if (!coverItems.length) throw new Error("未找到头条封面候选图");
  await coverItems[0].evaluate(element => {
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
  });
  await page.waitForTimeout(10000);
  console.log(`选择${coverMode === "horizontal" ? "横屏" : "竖屏"}系统封面`);
  await clickReadyElement(
    page,
    "body .Dialog-container .m-poster-upgrade .footer .m-button",
    "头条封面下一步按钮",
    WAIT_SELECTOR_APPEAR_MS
  );
  setPublishStage("确认系统封面");
  console.log("确认系统封面");
  await page.waitForTimeout(3000); 
  setPublishStage("点击裁剪");
  console.log("点击裁剪");
  if (shouldClickToutiaoCoverClip({ hasTagSelector })) {
    await clickReadyElement(page, ".base-content-wrap .clip-btn", "头条封面裁剪按钮");
    await page.waitForTimeout(500);
    setPublishStage("裁剪完成");
    console.log("裁剪完成");
  }
  setPublishStage("点击确认");
  await clickReadyElement(page, ".base-content-wrap .btn-sure", "头条封面确认按钮");
  await page.waitForTimeout(1000);
  setPublishStage("确认封面弹窗");
  await clickReadyElement(page, ".Dialog-container .footer .m-button.red", "头条封面弹窗确认按钮");
  setPublishStage("封面设置完成");
}

async function waitForToutiaoUploadProgressComplete(page) {
  const deadline = Date.now() + WAIT_UPLOAD_PROCESSING_MS;
  let lastLogValue = "";
  let lastLogAt = 0;
  let missingProgressCount = 0;
  while (Date.now() < deadline) {
    const progresses = await page.evaluate(() =>
      [...document.querySelectorAll(".progress-bar-inner")].map(bar => ({
        style: bar.getAttribute("style") || "",
        width: (bar.style && bar.style.width) || "",
        ariaValueNow: bar.getAttribute("aria-valuenow") || "",
        textContent: bar.textContent || "",
      }))
    ).catch(() => []);

    const logValue = progresses
      .map((progress, index) =>
        `#${index + 1} width=${progress.width || "-"} style=${progress.style || "-"} aria=${progress.ariaValueNow || "-"} text=${String(progress.textContent || "").trim() || "-"}`
      )
      .join(" | ") || "未找到 .progress-bar-inner";

    if (progresses.length === 0) {
      missingProgressCount++;
    } else {
      missingProgressCount = 0;
    }

    if (logValue !== lastLogValue || Date.now() - lastLogAt >= 5000) {
      console.log(`头条上传进度：${logValue}${progresses.length === 0 ? `（连续 ${missingProgressCount}/10 次）` : ""}`);
      lastLogValue = logValue;
      lastLogAt = Date.now();
    }

    if (shouldRetryToutiaoProgressMissing({ missingCount: missingProgressCount })) {
      const err = new Error("连续 10 次未找到头条上传进度条，准备重试");
      err.name = "ProgressBarMissingError";
      throw err;
    }

    if (progresses.some(progress => isToutiaoProgressComplete(progress))) {
      return;
    }

    await page.waitForTimeout(1000);
  }

  const err = new Error("等待头条上传进度到 100% 超时");
  err.name = "TimeoutError";
  throw err;
}

async function openToutiaoCoverDialog(page) {
  const triggerSelector = getToutiaoCoverTriggerSelector();
  const dialogSelector = getToutiaoPosterDialogSelector();
  const trigger = await page.waitForSelector(triggerSelector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  await trigger.evaluate(element => {
    element.scrollIntoView({ block: "center", inline: "center" });
  });
  await page.waitForTimeout(300);
  const clicked = await page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) return false;
    element.click();
    return true;
  }, triggerSelector);
  if (!clicked) throw new Error("未找到头条封面入口");
  await page.waitForSelector(dialogSelector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
}

export default async function (page, data, window, event) {
  const isDraftMode = data.publishMode === "draft" || data.publishToDraft === true;
  let hasTagSelector = false;
  let publishStage = "初始化";

  console.log(data);
  try {
    await page.waitForSelector('.byte-upload input[type="file"]', { timeout: WAIT_SELECTOR_APPEAR_MS });
    const uploadInputs = await page.$$('.byte-upload input[type="file"]');
    const uploadFileHandle = uploadInputs[0];
    await uploadFileHandle.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    const selector = 'input[placeholder="请输入 0～30 个字符"]';
    await page.waitForSelector(selector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    // 获取元素句柄
    const input = await page.$(selector);
    // 点击并清空内容
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    // 输入新内容
    await page.type(selector, data.data.bt1, { delay: 50 });
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }
  hasTagSelector = await trySelectHorizontalTag(page);
  // 设置封面
  try {
    publishStage = "等待上传进度完成";
    console.log("等待上传进度到 100%");
    await waitForToutiaoUploadProgressComplete(page);
    publishStage = "打开封面设置";
    // 开始设置封面
    console.log("开始设置封面");
    await page.waitForTimeout(2000);
    await openToutiaoCoverDialog(page);
    console.log("封面弹窗已打开");
    publishStage = "调整封面";
    await setToutiaoCover(page, hasTagSelector, stage => {
      publishStage = stage;
    });
    await page.waitForTimeout(1000);

    publishStage = "等待发布按钮";
    await page.waitForSelector(".video-batch-footer .action-footer-btn", { timeout: WAIT_SELECTOR_APPEAR_MS });
    await page.waitForTimeout(3000);

    publishStage = "等待视频处理完成";
    await pollPageUntil(
      page,
      () => {
        const els = document.querySelector(".basic-info  .m-right-btn .btn");
        return !!(els && els.textContent.trim() === "重新上传");
      },
      WAIT_UPLOAD_PROCESSING_MS
    );
    const shouldSaveDraft = shouldSaveToutiaoDraft({
      requestedDraft: isDraftMode,
      hasTagSelector,
    });
    // 草稿：竖屏无标签时不支持保存草稿，直接走发布。
    await page.waitForTimeout(6000);
    if (shouldSaveDraft) {
      publishStage = "点击保存草稿";
      await clickReadyElement(page, ".video-batch-footer .draft", "头条保存草稿按钮");
    } else {
      // 发布
      publishStage = "点击发布";
      await clickReadyElement(page, ".video-batch-footer .submit", "头条发布按钮");
    }
    console.log(shouldSaveDraft ? "✅ 头条号视频已保存草稿" : "✅ 头条号视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        publishMode: shouldSaveDraft ? "draft" : "publish",
        publishToDraft: shouldSaveDraft,
        message: shouldSaveDraft ? "保存草稿成功" : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (e) {
    const detail = getErrorMessage(e);
    console.error(`❌ 头条发布失败，阶段：${publishStage}`, e);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: `上传失败：${publishStage} - ${detail}`,
    });
  }
}
