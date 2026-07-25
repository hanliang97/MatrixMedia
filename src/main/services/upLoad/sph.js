import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { resolveVideoLinkOption } from "../../../shared/videoLink.js";
import { attachSphVideoLink } from "./sphLink.js";
import { applySphLocationMode } from "./sphLocation.js";
import { findAccountPublishSettings } from "../accountPublishSettingsResolver.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";

const SEL_ORIGINAL_CHECKBOX =
  "wujie-app.wujie_iframe >>> .declare-original-checkbox .ant-checkbox-wrapper";
const SEL_ORIGINAL_DIALOG_CHECK =
  "wujie-app.wujie_iframe >>> .declare-original-dialog .weui-desktop-dialog label.ant-checkbox-wrapper";
const SEL_ORIGINAL_DIALOG_OK =
  "wujie-app.wujie_iframe >>> .declare-original-dialog .weui-desktop-dialog button.weui-desktop-btn_primary";

/**
 * 声明原创：部分账号/版本无入口或已默认处理，失败不影响后续发布。
 */
async function tryDeclareOriginal(page) {
  let yInput;
  try {
    yInput = await page.waitForSelector(SEL_ORIGINAL_CHECKBOX, {
      timeout: 3000,
    });
  } catch (_) {
    console.log("声明原创：未找到勾选入口，跳过");
    return;
  }

  try {
    await yInput.click();
  } catch (e) {
    console.warn(
      "声明原创：勾选入口点击失败，跳过",
      e && e.message ? e.message : e
    );
    return;
  }

  try {
    await page.waitForSelector(
      "wujie-app.wujie_iframe >>> .weui-desktop-dialog__bd .protocol-text",
      { timeout: 2500 }
    );
    const protocol = await page.$(
      "wujie-app.wujie_iframe >>> .weui-desktop-dialog__bd .protocol-text"
    );
    if (protocol) await protocol.click();
    await page.waitForTimeout(300);
    const clicked = await page.evaluate(() => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      if (!app || !app.shadowRoot) return false;
      const bodies = app.shadowRoot.querySelectorAll(
        ".weui-desktop-dialog__bd"
      );
      for (const body of bodies) {
        const dlg = body.closest(".weui-desktop-dialog") || body.parentElement;
        const btns = (dlg || body).querySelectorAll(
          "button.weui-desktop-btn_primary"
        );
        for (const btn of btns) {
          if (
            String(btn.textContent || "")
              .trim()
              .includes("声明原创")
          ) {
            btn.click();
            return true;
          }
        }
      }
      return false;
    });
    if (clicked) await page.waitForTimeout(800);
  } catch (_) {
    /* 非首次账号或协议弹窗未出现 */
  }

  try {
    const cBox = await page.waitForSelector(SEL_ORIGINAL_DIALOG_CHECK, {
      timeout: 3000,
    });
    await cBox.click();
    const aBtn = await page.waitForSelector(SEL_ORIGINAL_DIALOG_OK, {
      timeout: 3000,
    });
    await aBtn.click();
  } catch (_) {
    console.log("声明原创：未出现后续确认框或已完成，跳过");
  }
}

async function clickSphDraftButton(page) {
  const draftBtn = await page.waitForSelector(
    "wujie-app.wujie_iframe >>> .form-btns>div:first-child button",
    { timeout: WAIT_SELECTOR_APPEAR_MS }
  );
  if (!draftBtn) throw new Error("未找到视频号保存草稿按钮");
  await draftBtn.click({ delay: 200 });
  await page.waitForTimeout(1000);
}

async function clickSphPublishButton(page) {
  const publishBtn = await page.waitForSelector(
    "wujie-app.wujie_iframe >>> .form-btns>div:last-child button",
    { timeout: WAIT_SELECTOR_APPEAR_MS }
  );
  if (!publishBtn) throw new Error("未找到视频号发布按钮");
  await publishBtn.click({ delay: 200 });
  await page.waitForTimeout(1000);
}

async function waitSphUploadProcessing(page) {
  await pollPageUntil(
    page,
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      if (!app || !app.shadowRoot) return false;
      const tag = app.shadowRoot.querySelector(".tag-inner");
      return !!(tag && tag.textContent.trim() === "删除");
    },
    WAIT_UPLOAD_PROCESSING_MS,
    2000,
    "等待视频处理超时（未出现「删除」标签）"
  );
  await page.waitForTimeout(2000);
}

async function fallbackFormFailureToDraft(
  page,
  data,
  window,
  event,
  error,
  failureStage,
  failureLabel
) {
  const detail =
    (error && error.message) || (typeof error === "string" ? error : String(error));
  try {
    // 表单项在发布前半段处理；失败时仍需等待视频处理完成后才能可靠保存草稿。
    await waitSphUploadProcessing(page);
    await clickSphDraftButton(page);
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      outcome: "draft_saved",
      publishMode: "draft",
      publishToDraft: true,
      needsAttention: true,
      failureStage,
      message: `${failureLabel}失败，视频已保存为草稿：${detail}`,
    });
    maybeClosePublishWindow({ ...data, closeWindowAfterPublish: true }, window);
    return true;
  } catch (draftError) {
    const draftDetail =
      (draftError && draftError.message) || String(draftError || "未知错误");
    throw new Error(
      `${failureLabel}失败：${detail}；保存草稿也失败：${draftDetail}`
    );
  }
}

export default async function (page, data, window, event, onFinish) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;

  console.log(data);
  await page.waitForTimeout(1000 * 5);
  try {
    const sel = 'wujie-app.wujie_iframe >>> input[type="file"]';

    const uploadInput = await page.waitForSelector(sel, {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    if (!uploadInput) throw new Error("上传 input 不存在");
    await uploadInput.uploadFile(path.resolve(data.filePath));
    await uploadInput.evaluate((el) => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  } catch (err) {
    console.error("❌ 文件上传失败:", err);
  }

  try {
    const titleInput = await page.waitForSelector(
      "wujie-app.wujie_iframe >>> .post-desc-box .input-editor",
      { timeout: WAIT_SELECTOR_APPEAR_MS }
    );
    // 传统input/textarea的操作
    await titleInput.click();
    await page.keyboard.type(data.data.bt1 + " " + data.data.bq, { delay: 50 });
    const shortTitle = (data.data.bt2Filled || "").trim();
    if (shortTitle) {
      const sel2 =
        'wujie-app.wujie_iframe >>> input[placeholder="填写短标题有机会获得更多流量"]';
      const uploadInput2 = await page.waitForSelector(sel2, {
        timeout: WAIT_SELECTOR_APPEAR_MS,
      });
      await uploadInput2.click();
      let newBt = shortTitle.replace(/[，。、\/,;:!?'"()\[\]{}<>]/g, " ");
      await page.keyboard.type(newBt, { delay: 50 });
    } else {
      console.log("视频号短标题未填写，跳过");
    }
  } catch (err) {
    console.error("❌ 输入失败:", err);
  }

  try {
    const link = resolveVideoLinkOption("视频号", data.publishOptions);
    if (link && link.enabled === true) {
      try {
        const selectedLink = await attachSphVideoLink(page, link);
        console.log(
          `[sph][link] 已添加 ${selectedLink.type} ${selectedLink.value}: ${selectedLink.label || ""}`
        );
      } catch (linkError) {
        console.error("[sph][link] 添加链接失败:", linkError);
        const handled = await fallbackFormFailureToDraft(
          page,
          data,
          window,
          event,
          linkError,
          "video_link",
          "视频号链接添加"
        );
        if (handled) return;
      }
    }

    const accountSettings =
      findAccountPublishSettings({ phone: data.phone, pt: data.pt }) || {};
    try {
      const locationResult = await applySphLocationMode(
        page,
        accountSettings.sphLocationMode
      );
      if (locationResult.mode === "none") {
        console.log(
          locationResult.changed
            ? "[sph][location] 已选择不显示位置"
            : "[sph][location] 当前已是不显示位置"
        );
      }
    } catch (locationError) {
      console.error("[sph][location] 设置位置失败:", locationError);
      const handled = await fallbackFormFailureToDraft(
        page,
        data,
        window,
        event,
        locationError,
        "location",
        "视频号关闭位置显示"
      );
      if (handled) return;
    }

    await tryDeclareOriginal(page);
    await waitSphUploadProcessing(page);

    // 所有表单项（包括商品）完成后，草稿和发布只能二选一执行。
    if (isDraftMode) await clickSphDraftButton(page);
    else await clickSphPublishButton(page);
    console.log(
      isDraftMode ? "✅ 视频号视频已保存草稿" : "✅ 视频号视频上传成功"
    );
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: isDraftMode ? "保存草稿成功" : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (err) {
    const detail =
      (err && err.message) || (typeof err === "string" ? err : String(err));
    console.error("❌ 视频号发布失败:", err);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message:
        detail && detail.length > 400
          ? `${detail.slice(0, 400)}…`
          : detail || "上传失败",
    });
    maybeClosePublishWindow(data, window);
  }
}
