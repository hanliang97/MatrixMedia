import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import {
  getCreativeStatementOption,
  resolveBlblCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import {
  pollPageUntil,
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
} from "./uploadTimeouts.js";

async function waitForBlblAutoCover(page) {
  await pollPageUntil(
    page,
    () => {
      const main = document.querySelector(".cover-main");
      if (!main) return false;
      const empty = main.querySelector(".cover-empty");
      const img = main.querySelector(".cover-img");
      return !empty && !!img;
    },
    WAIT_UPLOAD_PROCESSING_MS,
    2000,
    "哔哩哔哩封面自动生成超时"
  );
}

async function selectBlblCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[blbl] creativeStatement 值 =", value);
  // 注意：「无标注」对应 B 站「内容无需标注」，也必须主动点选，不能跳过
  const opt = getCreativeStatementOption(value);
  const label = resolveBlblCreativeStatementLabel(value);
  console.log(
    "[blbl] 准备选择创作声明:",
    label,
    "optionalAuth=",
    !!opt.optionalAuth
  );

  const trigger = await page.$(
    ".statement-content .bcc-select-input-wrap input"
  );
  if (!trigger) {
    console.warn("未找到哔哩哔哩创作声明选择器，跳过");
    return;
  }
  await trigger.click({ delay: 200 });
  await page.waitForSelector(".statement-content .bcc-select-list-wrap", {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });

  const picked = await page.evaluate(
    (text, isAuthOption) => {
      if (isAuthOption) {
        const auth = document.querySelector(
          ".statement-content .auth-content .option-text"
        );
        if (auth && auth.textContent.trim() === text) {
          auth.closest(".auth-content")?.click();
          return true;
        }
        return false;
      }
      const spans = document.querySelectorAll(
        ".statement-content li.bcc-option span"
      );
      for (const span of spans) {
        if (span.textContent.trim() === text) {
          span.closest("li.bcc-option")?.click();
          return true;
        }
      }
      return false;
    },
    label,
    !!opt.optionalAuth
  );

  if (!picked) {
    console.warn(`未找到哔哩哔哩创作声明选项: ${label}`);
  }
  await page.waitForTimeout(300);
}

export default async function (page, data, window, event) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;

  console.log(data);
  try {
    let sel = '.bcc-upload input[type="file"]';
    await page.waitForSelector(sel, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const uploadInputs = await page.$(sel);
    await uploadInputs.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    const selector = '.input-instance input[placeholder="请输入稿件标题"]';
    await page.waitForSelector(selector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const input = await page.$(selector);
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    await page.keyboard.type(data.data.bt1, { delay: 50 });
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }

  // 标题输入完后立即选择创作声明（必须声明）
  try {
    await selectBlblCreativeStatement(page, data);
  } catch (e) {
    console.warn("哔哩哔哩创作声明选择未完成:", e?.message || e);
  }

  try {
    const selector = ".video-human-type .select-container";
    await page.waitForSelector(selector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const input = await page.$(selector);
    await input.click();
    await page.waitForSelector(".human-type-list", { timeout: WAIT_SELECTOR_APPEAR_MS });
    const input2 = await page.$('.human-type-list div[title="影视"]');
    await input2.click();
  } catch (e) {
    console.error("❌ 输入类型失败", e);
  }
  try {
    const selector = ".desc-container .ql-editor";
    await page.waitForSelector(selector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const input = await page.$(selector);
    await input.click();
    await page.keyboard.type(data.data.bdText);
  } catch (e) {
    console.error("❌ 输入简介失败", e);
  }
  try {
    let tag = data.data.bq
      .trim()
      .split(/\s+/)
      .map(tag => tag.replace(/^#/, ""));
    const selector = ".tag-container .input-instance input";
    await page.waitForSelector(selector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const input = await page.$(selector);
    await input.focus();
    // 标签规则是输入一个词后按回车
    console.log(tag);
    for (let i = 0; i < tag.length; i++) {
      await page.keyboard.type(tag[i], { delay: 100 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      await input.focus();
    }
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }

  try {
    // 用 pollPageUntil 替代 waitForSelector，避免 puppeteer 默认 protocolTimeout
    // (约 180s) 把单次 Runtime.callFunctionOn 砍掉，导致弱网/大文件场景下假性超时。
    await pollPageUntil(
      page,
      () => !!document.querySelector(".file-item-content-status .success"),
      WAIT_UPLOAD_PROCESSING_MS,
      2000,
      "等待哔哩哔哩视频上传完成超时"
    );
  } catch (e) {
    console.warn("哔哩哔哩视频上传未完成，跳过后续步骤:", e?.message || e);
  }

  try {
    await waitForBlblAutoCover(page);
  } catch (e) {
    console.warn("哔哩哔哩封面自动生成未完成（可忽略，发布失败时再在窗口内处理）:", e?.message || e);
  }

  try {
    await page.waitForTimeout(500);
    // 点击一下空白的区域
    await page.click("body", { delay: 200 });
    await page.waitForSelector(".submit-container .submit-add", { timeout: WAIT_SELECTOR_APPEAR_MS });
    // 存到草稿
    await page.waitForSelector(".submit-draft", { timeout: WAIT_SELECTOR_APPEAR_MS });
    if (isDraftMode) {
      await page.click(".submit-draft", { delay: 200 });
    } else {
      // 发布
      await page.click(".submit-add", { clickCount: 2, delay: 200 });
    }
    // 检测._phone-label_1eni7_34 消失
    console.log(isDraftMode ? "✅ 哔哩哔哩视频已保存草稿" : "✅ 哔哩哔哩视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: isDraftMode ? "保存草稿成功" : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (e) {
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
    maybeClosePublishWindow(data, window);
    console.error("❌ 发布失败", e);
  }
}
