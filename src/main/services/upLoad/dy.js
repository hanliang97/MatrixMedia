import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { resolveDyCreativeStatementLabel } from "../../../shared/creativeStatement.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";

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
    console.error("❌ 输入文件失败", e);
  }
  try {
    await page.waitForSelector(".semi-input", {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    // 获取元素句柄
    const input = await page.$(".semi-input");
    // 点击并清空内容
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    await page.type(".semi-input", data.data.bt1, { delay: 50 });

    const input2 = await page.$(".zone-container.editor-kit-container");
    await input2.click(); // 三击全选
    await page.keyboard.type(data.data.bt2 + " " + data.data.bq, { delay: 50 });
    // 抖音话题只有遇到空格/回车才会把当前 #xxx 转成话题胶囊；
    // bq 末尾没有分隔符会导致最后一个标签没被识别，这里补一次空格触发。
    await page.keyboard.press("Space");
  } catch (e) {
    console.error("❌ 输入标题失败", e);
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

    // 自主声明入口在视频转码完成后才出现，必须在点击发布前完成
    await selectDyCreativeStatementWithRetry(page, data);

    await clickDyPublish(page, isDraftMode);
    console.log(isDraftMode ? "✅ 抖音视频已保存草稿" : "✅ 抖音视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: isDraftMode ? "保存草稿成功" : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (e) {
    const detail = (e && e.message) || String(e);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
    });
    console.error("❌ 上传失败", e);
  }
}
