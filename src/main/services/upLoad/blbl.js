import fs from "fs";
import path from "path";
import { normalizeCoverForUpload } from "../coverCompat.js";
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
export const BLBL_COVER_VERIFY_TIMEOUT_MS = 10000;
export const BLBL_COVER_TARGET_WIDTH = 1440;
export const BLBL_COVER_TARGET_HEIGHT = 1080;

const BLBL_PAGE_CLOSED_RE =
  /Target closed|Session closed|Connection closed|Browser has disconnected|Page crashed/i;

function isBlblPageClosedErr(err) {
  return Boolean(err && BLBL_PAGE_CLOSED_RE.test(String(err.message || err)));
}

/**
 * 为 B 站选择自定义封面：B 站首页推荐（4:3）+ 个人空间（16:9）均为横版封面，
 * 因此优先采用 horizontalCoverPath（4:3 横图），缺省回退 coverPath。
 */
export function pickBlblCoverPath(videoData = {}) {
  if (!videoData || typeof videoData !== "object") return "";
  const horizontal = String(videoData.horizontalCoverPath || "").trim();
  if (horizontal) return horizontal;
  return String(videoData.coverPath || "").trim();
}

/** 从 CSS background-image（如 url("https://archive.biliimg.com/...")）中提取 URL */
export function extractBlblCoverBgUrl(rawBg) {
  const s = String(rawBg || "").trim();
  if (!s || s === "none") return "";
  const match = s.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
  return match && match[2] ? match[2].trim() : "";
}

export function findBlblCoverEntry(root = document) {
  return root.querySelector(".cover-empty");
}

/** 查找可打开 B 站封面制作弹窗的入口（兼容空封面 .cover-empty 与已有自动封面 .cover-img） */
export function findBlblCoverEditorTrigger(root = document) {
  return (
    root.querySelector(".cover-empty") ||
    root.querySelector(".cover-main .cover-img .edit-text") ||
    root.querySelector(".cover-main .cover-img") ||
    root.querySelector(".cover-main")
  );
}

/**
 * 视频上传成功后默认设置封面：
 * 点击「封面设置」→ 弹窗中滑块往左滑 10px → 点击「完成」。
 * 任何步骤失败均跳过，不阻断发布。
 */
async function handleBlblCover(page) {
  try {
    // 1. 等待并点击新版封面设置入口
    const deadline = Date.now() + WAIT_SELECTOR_APPEAR_MS;
    let coverEntry = null;
    while (!coverEntry && Date.now() < deadline) {
      const handle = await page
        .evaluateHandle(findBlblCoverEntry)
        .catch(() => null);
      coverEntry = handle?.asElement() || null;
      if (!coverEntry) {
        await handle?.dispose();
        await page.waitForTimeout(2000);
      }
    }
    if (!coverEntry) throw new Error("未找到哔哩哔哩封面设置入口");
    await coverEntry.click({ delay: 200 });
    await coverEntry.dispose();
    console.log("[blbl] 已点击封面设置入口");

    // 2. 等待封面编辑弹窗
    await page.waitForSelector(".cover-editor.bcc-dialog__wrap", {
      visible: true,
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    await page.waitForTimeout(1000); // 等待弹窗内组件渲染

    // 3. 滑块往左滑 10px
    const handle = await page.waitForSelector(".vue-slider-dot-handle", {
      visible: true,
      timeout: WAIT_SELECTOR_APPEAR_MS,
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
    console.warn("[blbl] 封面设置失败，跳过:", e?.message || e);
  }
}

/**
 * B 站自定义封面上传（探针实证配方）：
 * 1. 将源图按 1440×1080（4:3，≥1200×900，jpg/png）归一（已是 1440×1080 jpg/png 免重编码透传）
 * 2. 点击 .cover-empty 或已有封面的 .cover-img .edit-text 打开 .cover-editor.bcc-dialog__wrap
 * 3. 勾选「双比例同步改动」让 4:3（首页推荐）与 16:9（个人空间）同步更新
 * 4. 直接向弹窗内 image file input（accept="image/png, image/jpeg"）注入封面文件
 * 5. 点击「完成」；若仍弹出 .videoup-confirm-modal（「确认同步」），点「确认同步」后再点「完成」
 * 6. 校验弹窗关闭且 .cover-main .cover-img 的 background-image URL 相对上传前变化
 *
 * 与抖音 / 快手 / 视频号口径一致：用户显式传入封面时，上传/校验失败抛错中止本次发布，不静默发成截帧。
 */
export async function uploadBlblCustomCover(page, coverPath, options = {}) {
  if (!coverPath || !fs.existsSync(coverPath)) {
    throw new Error(`封面文件不存在: ${coverPath}`);
  }
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
  const verifyTimeoutMs =
    Number(options.verifyTimeoutMs) > 0
      ? Number(options.verifyTimeoutMs)
      : BLBL_COVER_VERIFY_TIMEOUT_MS;
  const pollIntervalMs =
    Number(options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 500;
  const settleWaitMs =
    Number(options.settleWaitMs) >= 0 ? Number(options.settleWaitMs) : 3000;
  const normalizeFn =
    typeof options.normalizeCover === "function"
      ? options.normalizeCover
      : normalizeCoverForUpload;

  const uploadPath = await normalizeFn(coverPath, {
    width: BLBL_COVER_TARGET_WIDTH,
    height: BLBL_COVER_TARGET_HEIGHT,
  });

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

  // 1. 等待封面槽位渲染（.cover-empty 或已有 .cover-img）
  const entryDeadline = Date.now() + entryTimeoutMs;
  let coverReady = false;
  while (Date.now() <= entryDeadline) {
    const ready = await page.evaluate(() => {
      const main = document.querySelector(".cover-main");
      if (!main) return false;
      return Boolean(
        main.querySelector(".cover-empty") || main.querySelector(".cover-img")
      );
    });
    if (ready) {
      coverReady = true;
      break;
    }
    if (Date.now() < entryDeadline) {
      await page.waitForTimeout(pollIntervalMs);
    } else {
      break;
    }
  }
  if (!coverReady) {
    throw new Error("未找到哔哩哔哩封面槽位（.cover-main）");
  }

  const bgBefore = extractBlblCoverBgUrl(
    await page.evaluate(() => {
      const img = document.querySelector(".cover-main .cover-img");
      if (!img) return "";
      return (
        img.style.backgroundImage || getComputedStyle(img).backgroundImage || ""
      );
    })
  );

  // 2. 打开「封面制作」弹窗（兼容空封面与已有自动封面）
  let dialogOpened = false;
  for (let attempt = 1; attempt <= openAttempts; attempt++) {
    const triggerHandle = await page.evaluateHandle(findBlblCoverEditorTrigger);
    const triggerEl = triggerHandle?.asElement() || null;
    if (!triggerEl) {
      await triggerHandle?.dispose().catch(() => {});
      break;
    }
    try {
      await triggerEl
        .evaluate((el) => {
          if (typeof el.scrollIntoView === "function") {
            el.scrollIntoView({ block: "center", inline: "center" });
          }
        })
        .catch(() => {});
      if (attempt === 1) {
        await triggerEl.click({ delay: 200 });
      } else {
        await triggerEl.evaluate((el) => el.click());
      }
    } finally {
      await triggerEl.dispose().catch(() => {});
    }
    console.log(
      attempt === 1
        ? "[blbl] 已点击封面编辑入口（准备上传自定义封面）"
        : `[blbl] 已重试点击封面编辑入口（第 ${attempt} 次）`
    );

    const openDeadline = Date.now() + dialogOpenTimeoutMs;
    while (Date.now() <= openDeadline) {
      const open = await page.evaluate(() => {
        const dlg = document.querySelector(".cover-editor.bcc-dialog__wrap");
        if (!dlg) return false;
        const r = dlg.getBoundingClientRect();
        const s = getComputedStyle(dlg);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.display !== "none" &&
          s.visibility !== "hidden"
        );
      });
      if (open) {
        dialogOpened = true;
        break;
      }
      if (Date.now() < openDeadline) {
        await page.waitForTimeout(Math.min(400, pollIntervalMs));
      } else {
        break;
      }
    }
    if (dialogOpened) break;
    if (attempt < openAttempts) {
      await page.waitForTimeout(Math.min(800, pollIntervalMs));
    }
  }
  if (!dialogOpened) {
    throw new Error(
      "未打开哔哩哔哩封面制作弹窗（.cover-editor.bcc-dialog__wrap）"
    );
  }
  await page.waitForTimeout(Math.min(1000, settleWaitMs));

  // 3. 优先勾选「双比例同步改动」，让 4:3（首页推荐）与 16:9（个人空间）同步套用自定义封面
  const syncToggled = await page
    .evaluate(() => {
      const dlg = document.querySelector(".cover-editor.bcc-dialog__wrap");
      if (!dlg) return false;
      const title =
        dlg.querySelector(".active .cover-editor-panel-canvas-title") ||
        dlg.querySelector(".cover-editor-panel-canvas-title");
      if (!title) return false;
      const cb = title.querySelector(
        ".bcc-checkbox, input[type='checkbox'], [class*='checkbox']"
      );
      if (!cb) return false;
      const innerInput =
        cb.tagName === "INPUT"
          ? cb
          : cb.querySelector && cb.querySelector("input[type='checkbox']");
      const cls = String(cb.className || "");
      const checked =
        Boolean(cb.checked) ||
        Boolean(innerInput && innerInput.checked) ||
        /checked/i.test(cls) ||
        cb.getAttribute("aria-checked") === "true" ||
        (/true/.test(title.textContent || "") &&
          !/false/.test(title.textContent || ""));
      if (!checked) {
        cb.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (syncToggled) {
    console.log("[blbl] 已勾选「双比例同步改动」（4:3 + 16:9）");
    await page.waitForTimeout(Math.min(400, settleWaitMs));
  }

  // 4. 直接向封面制作弹窗内的图片 file input 注入自定义封面（避免点击文本触发系统文件对话框）
  const inputHandle = await page.evaluateHandle(() => {
    const dlg =
      document.querySelector(".cover-editor.bcc-dialog__wrap") ||
      document.querySelector(".cover-editor");
    if (!dlg) return null;
    const inputs = Array.from(dlg.querySelectorAll('input[type="file"]'));
    return (
      inputs.find((i) => /image/.test(i.accept || "")) || inputs[0] || null
    );
  });
  const inputEl = inputHandle?.asElement() || null;
  if (!inputEl) {
    await inputHandle?.dispose().catch(() => {});
    throw new Error("哔哩哔哩封面制作弹窗内未找到图片上传 input");
  }
  try {
    await inputEl.uploadFile(path.resolve(uploadPath));
  } finally {
    await inputEl.dispose().catch(() => {});
  }
  console.log("[blbl] 自定义封面文件已注入上传区:", uploadPath);
  await page.waitForTimeout(settleWaitMs);

  // 5. 点击「完成」（若弹出「确认同步」二次确认框则点「确认同步」后再点一次「完成」）
  for (let step = 1; step <= 2; step++) {
    const clickedFinish = await page.evaluate(() => {
      const dlg =
        document.querySelector(".cover-editor.bcc-dialog__wrap") ||
        document.querySelector(".cover-editor");
      if (!dlg) return { closed: true, clicked: false };
      const r = dlg.getBoundingClientRect();
      const s = getComputedStyle(dlg);
      if (r.width <= 0 || r.height <= 0 || s.display === "none") {
        return { closed: true, clicked: false };
      }
      const btns = Array.from(dlg.querySelectorAll(".button.submit, button"));
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        if ((b.textContent || "").trim().includes("完成")) {
          b.click();
          return { closed: false, clicked: true };
        }
      }
      return { closed: false, clicked: false };
    });
    if (clickedFinish.closed) break;
    if (!clickedFinish.clicked) {
      throw new Error("哔哩哔哩封面制作弹窗内未找到「完成」按钮");
    }
    console.log(
      step === 1
        ? "[blbl] 封面制作弹窗已点「完成」"
        : "[blbl] 同步确认后已再次点击「完成」"
    );

    // 等待弹窗关闭或出现「确认同步」二次确认框
    const waitDeadline = Date.now() + Math.min(3500, verifyTimeoutMs);
    let syncModalConfirmed = false;
    let editorClosed = false;
    while (Date.now() <= waitDeadline) {
      const modalState = await page.evaluate(() => {
        const clean = (t) => String(t || "").replace(/\s+/g, "").trim();
        const dlg = document.querySelector(".cover-editor.bcc-dialog__wrap");
        const editorOpen = Boolean(
          dlg &&
            dlg.getBoundingClientRect().width > 0 &&
            getComputedStyle(dlg).display !== "none"
        );
        const modal = document.querySelector(".videoup-confirm-modal");
        const modalOpen = Boolean(
          modal &&
            modal.getBoundingClientRect().width > 0 &&
            getComputedStyle(modal).display !== "none"
        );
        let synced = false;
        if (modalOpen) {
          const btns = Array.from(
            modal.querySelectorAll("button, .bcc-button, [role='button']")
          );
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            if (clean(b.textContent) === "确认同步") {
              b.click();
              synced = true;
              break;
            }
          }
        }
        return { editorOpen, modalOpen, synced };
      });
      if (!modalState.editorOpen) {
        editorClosed = true;
        break;
      }
      if (modalState.synced) {
        syncModalConfirmed = true;
        console.log(
          "[blbl] 已点击「确认同步」（将 4:3 封面同步到 16:9 个人空间封面）"
        );
        await page.waitForTimeout(Math.min(1500, settleWaitMs));
        break;
      }
      if (Date.now() < waitDeadline) {
        await page.waitForTimeout(Math.min(400, pollIntervalMs));
      } else {
        break;
      }
    }
    if (editorClosed || !syncModalConfirmed) break;
  }

  // 6. 校验弹窗已关且 .cover-main .cover-img 背景图 URL 已变更为新封面
  const verifyDeadline = Date.now() + verifyTimeoutMs;
  let lastState = { editorOpen: true, bgUrl: "" };
  while (Date.now() <= verifyDeadline) {
    const rawState = await page.evaluate(() => {
      const dlg = document.querySelector(".cover-editor.bcc-dialog__wrap");
      const editorOpen = Boolean(
        dlg &&
          dlg.getBoundingClientRect().width > 0 &&
          getComputedStyle(dlg).display !== "none"
      );
      const img = document.querySelector(".cover-main .cover-img");
      const bg = img
        ? img.style.backgroundImage || getComputedStyle(img).backgroundImage || ""
        : "";
      return { editorOpen, bg };
    });
    const bgUrl = extractBlblCoverBgUrl(rawState.bg);
    lastState = { editorOpen: rawState.editorOpen, bgUrl };
    if (!rawState.editorOpen && bgUrl && bgUrl !== bgBefore) {
      const cdn = /biliimg\.com|hdslb\.com/.test(bgUrl);
      console.log(
        `[blbl] 自定义封面已设置并校验通过（bg变化=true, CDN=${cdn}, 弹窗已关=true）: ${bgUrl.slice(
          0,
          120
        )}`
      );
      return;
    }
    if (Date.now() < verifyDeadline) {
      await page.waitForTimeout(pollIntervalMs);
    } else {
      break;
    }
  }

  throw new Error(
    `哔哩哔哩自定义封面未生效（弹窗仍开=${lastState.editorOpen}, bg=${(
      lastState.bgUrl || ""
    ).slice(0, 120)}）`
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
    console.warn("哔哩哔哩视频上传未完成，跳过后续步骤:", e?.message || e);
  }

  try {
    const customCoverPath = pickBlblCoverPath(data && data.data);
    if (customCoverPath) {
      await uploadBlblCustomCover(page, customCoverPath);
    } else {
      await handleBlblCover(page);
    }

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
    if (isBlblPageClosedErr(e)) throw e;
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
