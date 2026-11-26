import path from "path";
import {
  readPageUrl,
  replyPublishFailure,
  replyPublishOutcome,
} from "./publishOutcome.js";
import {
  getCreativeStatementOption,
  resolveBlblCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import {
  pollPageUntil,
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  isPageClosedError,
} from "./uploadTimeouts.js";
import {
  buildPlatformVideoText,
  normalizeVideoTags,
} from "../../../shared/videoMetadata.js";

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

export const BLBL_COVER_ENTRY_TIMEOUT_MS = 15000;
export const BLBL_COVER_DIALOG_OPEN_TIMEOUT_MS = 6000;
export const BLBL_COVER_DIALOG_OPEN_ATTEMPTS = 2;
export const BLBL_COVER_SLIDER_TIMEOUT_MS = 10000;

export function findBlblCoverEntry(root = document) {
  return root.querySelector(".cover-empty");
}

export function hasBlblAutoCover(root = document) {
  const main = root.querySelector(".cover-main");
  if (!main) return false;
  const empty = main.querySelector(".cover-empty");
  const img = main.querySelector(".cover-img");
  return !empty && !!img;
}

export function isBlblCoverDialogOpen(root = document) {
  const dlg = root.querySelector(".cover-editor.bcc-dialog__wrap");
  if (!dlg) return false;
  if (typeof dlg.getBoundingClientRect === "function") {
    const r = dlg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
  }
  if (typeof getComputedStyle === "function") {
    const s = getComputedStyle(dlg);
    if (s.display === "none" || s.visibility === "hidden") return false;
  }
  return true;
}

async function waitForBlblCoverDialogOrAutoCover(page, timeoutMs, stepMs = 400) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    const state = await page.evaluate(() => {
      const dlg = document.querySelector(".cover-editor.bcc-dialog__wrap");
      let dialogOpen = false;
      if (dlg) {
        const r = dlg.getBoundingClientRect();
        const s = getComputedStyle(dlg);
        dialogOpen =
          r.width > 0 &&
          r.height > 0 &&
          s.display !== "none" &&
          s.visibility !== "hidden";
      }
      const main = document.querySelector(".cover-main");
      const autoCover = Boolean(
        main && !main.querySelector(".cover-empty") && main.querySelector(".cover-img")
      );
      return { dialogOpen, autoCover };
    });
    if (state.dialogOpen) return "dialog";
    if (state.autoCover) return "auto_cover";
    if (Date.now() < deadline) {
      await page.waitForTimeout(stepMs);
    } else {
      break;
    }
  }
  return "timeout";
}

/**
 * 视频上传成功后默认设置封面：
 * 若 B 站已自动生成封面（.cover-img 且无 .cover-empty）直接放行；
 * 否则滚动居中点击 .cover-empty（最多尝试 2 次，每次短超时 6s 等弹窗）→
 * 滑块往左滑 10px → 点击「完成」。
 * 任何非窗口关闭的失败均快速跳过（绝不卡死 5 分钟），不阻断发布。
 */
export async function handleBlblCover(page, options = {}) {
  const entryTimeoutMs =
    Number(options.entryTimeoutMs) > 0
      ? Number(options.entryTimeoutMs)
      : BLBL_COVER_ENTRY_TIMEOUT_MS;
  const dialogOpenTimeoutMs =
    Number(options.dialogOpenTimeoutMs) > 0
      ? Number(options.dialogOpenTimeoutMs)
      : BLBL_COVER_DIALOG_OPEN_TIMEOUT_MS;
  const openAttempts =
    Number(options.openAttempts) > 0
      ? Number(options.openAttempts)
      : BLBL_COVER_DIALOG_OPEN_ATTEMPTS;
  const sliderTimeoutMs =
    Number(options.sliderTimeoutMs) > 0
      ? Number(options.sliderTimeoutMs)
      : BLBL_COVER_SLIDER_TIMEOUT_MS;
  const pollIntervalMs =
    Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 1000;

  try {
    // 失焦标签输入框，避免联想下拉框或吸顶栏遮挡封面区域
    await page
      .evaluate(() => {
        if (
          document.activeElement &&
          typeof document.activeElement.blur === "function"
        ) {
          document.activeElement.blur();
        }
      })
      .catch(() => {});

    // 1. 等待封面入口（.cover-empty）或已自动生成的封面（.cover-img）
    const entryDeadline = Date.now() + entryTimeoutMs;
    let hasEntry = false;
    while (Date.now() <= entryDeadline) {
      const status = await page.evaluate(() => {
        const main = document.querySelector(".cover-main");
        const autoCover = Boolean(
          main && !main.querySelector(".cover-empty") && main.querySelector(".cover-img")
        );
        const entry = Boolean(document.querySelector(".cover-empty"));
        return { autoCover, entry };
      });
      if (status.autoCover) {
        console.log("[blbl] 封面已自动生成，跳过手动封面设置");
        return;
      }
      if (status.entry) {
        hasEntry = true;
        break;
      }
      if (Date.now() < entryDeadline) {
        await page.waitForTimeout(pollIntervalMs);
      } else {
        break;
      }
    }
    if (!hasEntry) {
      throw new Error("未找到哔哩哔哩封面设置入口（15s）");
    }

    // 2. 滚动居中点击封面入口并短超时等待编辑弹窗（支持重试一次，避免刚上传完单次点击落空）
    let dialogOpened = false;
    for (let attempt = 1; attempt <= openAttempts; attempt++) {
      const coverHandle = await page.evaluateHandle(findBlblCoverEntry);
      const coverEntry = coverHandle?.asElement() || null;
      if (!coverEntry) {
        await coverHandle?.dispose().catch(() => {});
        const autoReady = await page
          .evaluate(() => {
            const main = document.querySelector(".cover-main");
            return Boolean(
              main && !main.querySelector(".cover-empty") && main.querySelector(".cover-img")
            );
          })
          .catch(() => false);
        if (autoReady) {
          console.log("[blbl] 封面已自动生成，跳过手动封面设置");
          return;
        }
        break;
      }

      try {
        await coverEntry
          .evaluate((el) => {
            if (typeof el.scrollIntoView === "function") {
              el.scrollIntoView({ block: "center", inline: "center" });
            }
          })
          .catch(() => {});
        if (attempt === 1) {
          await coverEntry.click({ delay: 200 });
        } else {
          // 二次重试改走 DOM click，绕开吸顶栏/浮层遮挡导致的坐标点击落空
          await coverEntry.evaluate((el) => el.click());
        }
      } finally {
        await coverEntry.dispose().catch(() => {});
      }
      console.log(
        attempt === 1
          ? "[blbl] 已点击封面设置入口"
          : `[blbl] 已重试点击封面设置入口（第 ${attempt} 次）`
      );

      const waitResult = await waitForBlblCoverDialogOrAutoCover(
        page,
        dialogOpenTimeoutMs,
        Math.min(400, pollIntervalMs)
      );
      if (waitResult === "dialog") {
        dialogOpened = true;
        break;
      }
      if (waitResult === "auto_cover") {
        console.log("[blbl] 点击后封面已自动生成，跳过弹窗设置");
        return;
      }
      if (attempt < openAttempts) {
        await page.waitForTimeout(Math.min(800, pollIntervalMs));
      }
    }

    if (!dialogOpened) {
      throw new Error(
        `封面编辑弹窗未出现（重试 ${openAttempts} 次，每次 ${Math.round(
          dialogOpenTimeoutMs / 1000
        )}s）`
      );
    }

    await page.waitForTimeout(1000); // 等待弹窗内组件渲染

    // 3. 滑块往左滑 10px（短超时，避免弹窗结构变化导致长卡死）
    const handle = await page.waitForSelector(".vue-slider-dot-handle", {
      visible: true,
      timeout: sliderTimeoutMs,
    });
    const box = await handle.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 10, cy, { steps: 5 });
      await page.mouse.up();
      console.log("[blbl] 滑块已往左滑 10px");
    }

    await page.waitForTimeout(500);

    // 4. 点击「完成」按钮
    const submitClicked = await page.evaluate(() => {
      const container = document.querySelector(".cover-editor") || document;
      const btns = container.querySelectorAll(".button.submit");
      for (const btn of btns) {
        if ((btn.textContent || "").trim().includes("完成")) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (submitClicked) {
      console.log("[blbl] 封面设置完成");
    } else {
      console.warn("[blbl] 未找到封面完成按钮，跳过");
    }

    await page.waitForTimeout(1000); // 等待弹窗关闭
  } catch (e) {
    if (isPageClosedError(e)) throw e;
    console.warn("[blbl] 封面设置失败，跳过:", e?.message || e);
  }
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
  const text = buildPlatformVideoText("哔哩哔哩", data.data);

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
    await page.keyboard.type(text.title, { delay: 50 });
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
    await page.waitForSelector(".human-type-list", {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
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
    // 清掉旧内容再输入：B 站投稿页同分区可能恢复上次简介，不清空会追加成双份
    await input
      .evaluate((el) => {
        el.focus();
        const sel = window.getSelection();
        if (sel && sel.selectAllChildren) {
          sel.selectAllChildren(el);
          if (document.execCommand) document.execCommand("delete");
        }
      })
      .catch(() => {});
    if (text.description) {
      await page.keyboard.type(text.description);
    }
  } catch (e) {
    console.error("❌ 输入简介失败", e);
  }
  try {
    const tag = normalizeVideoTags(data.data.tags);
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
    if (isPageClosedError(e)) throw e;
    console.warn("哔哩哔哩视频上传未完成，跳过后续步骤:", e?.message || e);
  }

  await handleBlblCover(page);

  try {
    await page.waitForTimeout(500);
    // 点击一下空白的区域
    await page.click("body", { delay: 200 });
    await page.waitForSelector(".submit-container .submit-add", {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    // 存到草稿
    await page.waitForSelector(".submit-draft", {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    const urlBefore = readPageUrl(page);
    if (isDraftMode) {
      await page.click(".submit-draft", { delay: 200 });
    } else {
      // 发布
      await page.click(".submit-add", { clickCount: 2, delay: 200 });
    }
    // 检测._phone-label_1eni7_34 消失
    console.log(
      isDraftMode ? "✅ 哔哩哔哩视频已保存草稿" : "✅ 哔哩哔哩视频上传成功"
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
    const detail = (e && e.message) || String(e);
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
      closeWindow: true,
    });
    console.error("❌ 发布失败", e);
  }
}
