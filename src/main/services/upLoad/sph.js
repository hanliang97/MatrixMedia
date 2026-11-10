import path from "path";
import fs from "fs";
import { normalizeCoverForUpload } from "../coverCompat.js";
import maybeClosePublishWindow from "./closeWindow.js";
import { head, matchesHead, replaceAllText } from "./textReadback.js";
import { resolveVideoLinkOption } from "../../../shared/videoLink.js";
import {
  isCreativeStatementNone,
  resolveSphCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { attachSphVideoLink } from "./sphLink.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";
import { buildPlatformVideoText } from "../../../shared/videoMetadata.js";
import {
  readPageUrl,
  readPageText,
  replyPublishFailure,
  replyPublishOutcome,
} from "./publishOutcome.js";

/**
 * 在 wujie 影子树里实时查询并点击。
 *
 * 不要对 wujie 内元素用 waitForSelector + ElementHandle.click()：
 * 视频处理完成等时机平台会整段重渲染影子树，句柄随即指向已分离节点，
 * CDP 取不到布局盒子，报「Node is either not clickable or not an HTMLElement」
 * （e2e 实测存草稿按钮点击因此炸掉整个流程）。这里改为点击瞬间重新查询节点
 * 并走 DOM click（与库内其余 sph evaluate 点击同一模式），带重试容忍短暂消失。
 *
 * @param {import("puppeteer-core").Page} page
 * @param {string} selector 影子树内的选择器（不含 wujie-app 前缀与 >>>）
 * @param {object} [options]
 * @param {number} [options.timeout] 轮询窗口总时长，默认 10s
 * @param {number} [options.interval] 轮询间隔，默认 400ms
 * @param {string} [options.label] 抛错时的业务名（如「视频号保存草稿按钮」）
 * @param {boolean} [options.focus] 点击后聚焦该元素（输入框用）
 * @returns {Promise<boolean>} 是否成功点击到节点
 */
async function clickSphShadow(
  page,
  selector,
  { timeout = 10000, interval = 400, label = "", focus = false } = {}
) {
  const deadline = Date.now() + Math.max(timeout, 0);
  do {
    let clicked = false;
    try {
      clicked = await page.evaluate(
        ({ sel, needFocus }) => {
          const app = document.querySelector("wujie-app.wujie_iframe");
          if (!app || !app.shadowRoot) return false;
          const el = app.shadowRoot.querySelector(sel);
          if (!el) return false;
          // 按钮 disabled（视频处理/封面裁剪未完成）或不可见时不硬点，等下一轮
          if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
          if (
            typeof el.checkVisibility === "function" &&
            !el.checkVisibility()
          ) {
            return false;
          }
          el.scrollIntoView({ block: "center", inline: "center" });
          el.click();
          if (needFocus && typeof el.focus === "function") el.focus();
          return true;
        },
        { sel: selector, needFocus: focus }
      );
    } catch (_) {
      // 页面跳转/执行上下文销毁时按未命中处理，下一轮再试
      clicked = false;
    }
    if (clicked) return true;
    if (Date.now() < deadline) {
      await page.waitForTimeout(interval).catch(() => {});
    }
  } while (Date.now() < deadline);
  if (label) throw new Error(`未找到${label}：${selector}`);
  return false;
}

/**
 * 声明原创：部分账号/版本无入口或已默认处理，失败不影响后续发布。
 */
async function tryDeclareOriginal(page) {
  let clicked = false;
  try {
    clicked = await clickSphShadow(page, ".declare-original-checkbox .ant-checkbox-wrapper", {
      timeout: 3000,
    });
  } catch (_) {
    clicked = false;
  }
  if (!clicked) {
    console.log("声明原创：未找到勾选入口，跳过");
    return;
  }

  try {
    await clickSphShadow(
      page,
      ".weui-desktop-dialog__bd .protocol-text",
      { timeout: 2500 }
    );
    await page.waitForTimeout(300);
    const confirmed = await page.evaluate(() => {
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
    if (confirmed) await page.waitForTimeout(800);
  } catch (_) {
    /* 非首次账号或协议弹窗未出现 */
  }

  try {
    const checked = await clickSphShadow(
      page,
      ".declare-original-dialog .weui-desktop-dialog label.ant-checkbox-wrapper",
      { timeout: 3000 }
    );
    if (!checked) throw new Error("未出现");
    const ok = await clickSphShadow(
      page,
      ".declare-original-dialog .weui-desktop-dialog button.weui-desktop-btn_primary",
      { timeout: 3000 }
    );
    if (!ok) throw new Error("未出现");
  } catch (_) {
    console.log("声明原创：未出现后续确认框或已完成，跳过");
  }
}

/**
 * 视频号自定义封面（探针实证配方）：
 * 点 .vertical-cover-wrap 槽位 → weui-desktop-dialog「编辑封面」→「上传封面」→
 * .single-cover-uploader-wrap 内隐藏 file input（accept=jpeg/jpg/png，勿传 webp）注入 →
 * 「确定」→ 校验 .cover-img-vertical 槽位 img src 变化 + 弹窗已关闭。
 * 封面为「个人主页和分享卡片(3:4)」——3:4 竖图（如 1080x1440）恰好匹配。
 */
async function uploadSphCustomCover(page, coverPath) {
  if (!fs.existsSync(coverPath)) {
    throw new Error(`封面文件不存在: ${coverPath}`);
  }
  // 封面归一：视频号 file input 只收 jpeg/jpg/png，非 3:4 源图居中裁切成
  // 1080×1440 jpg（失败回退原图，不阻断发布）
  coverPath = await normalizeCoverForUpload(coverPath);

  const srcBefore = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    const img = root && root.querySelector(".cover-img-vertical");
    return img ? img.src : "";
  });

  const opened = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const slot =
      root.querySelector(".vertical-cover-wrap") ||
      root.querySelector(".cover-preview-wrap");
    if (!slot) return false;
    slot.click();
    return true;
  });
  if (!opened) throw new Error("未找到视频号封面编辑入口（.vertical-cover-wrap）");

  // 等「编辑封面」弹窗可见
  await page.waitForFunction(
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return false;
      for (const d of root.querySelectorAll(".weui-desktop-dialog")) {
        const t = (d.textContent || "").replace(/\s+/g, "");
        const r = d.getBoundingClientRect();
        if (t.includes("编辑封面") && r.width > 0) return true;
      }
      return false;
    },
    { timeout: 15000 }
  );
  await page.waitForTimeout(1200);

  // 切到「上传封面」
  const tabbed = await page.evaluate(() => {
    const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const dlg = [...root.querySelectorAll(".weui-desktop-dialog")].find(
      (d) =>
        (d.textContent || "").includes("编辑封面") &&
        d.getBoundingClientRect().width > 0
    );
    if (!dlg) return false;
    for (const el of dlg.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.children.length > 2) continue;
      if (norm(el.textContent) === "上传封面") {
        el.click();
        return true;
      }
    }
    return false;
  });
  if (!tabbed) throw new Error("视频号封面弹窗内未找到「上传封面」入口");
  await page.waitForTimeout(1200);

  // 注入图片文件（探针实证：input 挂 .single-cover-uploader-wrap，隐藏可注入）
  const inputHandle = await page.evaluateHandle(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return null;
    return (
      root.querySelector('.single-cover-uploader-wrap input[type="file"]') ||
      [...root.querySelectorAll('input[type="file"]')].find((i) =>
        /image/.test(i.accept || "")
      ) ||
      null
    );
  });
  const inputEl = inputHandle.asElement();
  if (!inputEl) throw new Error("未找到视频号封面上传 file input");
  await inputEl.uploadFile(path.resolve(coverPath));
  console.log("[sph] 封面文件已注入上传区:", coverPath);

  // 等上传+裁剪视图落定（1080x1440 与 3:4 槽位同比，通常无强制裁剪步骤）
  await page.waitForTimeout(5000);

  // 点「确定」（兜底再试「确认」）
  const confirmed = await page.evaluate(() => {
    const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "no-shadow" };
    const dlg = [...root.querySelectorAll(".weui-desktop-dialog")].find(
      (d) =>
        (d.textContent || "").includes("编辑封面") &&
        d.getBoundingClientRect().width > 0
    );
    if (!dlg) return { ok: false, reason: "no-dialog" };
    for (const label of ["确定", "确认"]) {
      for (const b of dlg.querySelectorAll(
        "button,.weui-desktop-btn,[role='button']"
      )) {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && !b.disabled && norm(b.textContent) === label) {
          b.click();
          return { ok: true, label };
        }
      }
    }
    return { ok: false, reason: "no-确定/确认" };
  });
  if (!confirmed.ok) {
    throw new Error(`视频号封面弹窗确认失败: ${confirmed.reason}`);
  }
  console.log("[sph] 封面弹窗已点「" + confirmed.label + "」");
  await page.waitForTimeout(3500);

  // 校验：弹窗已关 + 槽位 img src 相对设置前变化；微信 CDN 域名为强信号
  const after = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { src: "", dialogOpen: false };
    const img = root.querySelector(".cover-img-vertical");
    const dlg = [...root.querySelectorAll(".weui-desktop-dialog")].find(
      (d) =>
        (d.textContent || "").includes("编辑封面") &&
        d.getBoundingClientRect().width > 0
    );
    return { src: img ? img.src : "", dialogOpen: !!dlg };
  });
  const changed = !!after.src && after.src !== srcBefore;
  if (!changed) {
    throw new Error(
      `视频号封面设置后槽位图片未变化（src=${(after.src || "").slice(0, 120)}, 弹窗仍开=${after.dialogOpen}）`
    );
  }
  const cdn = /qpic|weixin|wechat|wx\.qq|qq\.com/.test(after.src);
  console.log(
    `[sph] 自定义封面已设置并校验通过（src变化=true, CDN=${cdn}, 弹窗已关=${!after.dialogOpen}）: ${after.src.slice(0, 120)}`
  );
  if (after.dialogOpen) {
    console.warn("[sph] ⚠️ 封面弹窗未关闭，尝试 Esc 收敛");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1000);
  }
}

/**
 * 选择视频号「视频标注」（.post-with-mark-tag）。
 * 自行拍摄时间/地点、转载来源为平台选填，本轮只点主选项。
 */
async function applySphCreativeStatement(page, value) {
  if (isCreativeStatementNone(value)) return;
  const label = resolveSphCreativeStatementLabel(value);
  if (!label || label === "无标注" || label === "无需标注") return;

  const opened = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const trigger = root.querySelector(".post-with-mark-tag .select-display");
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  if (!opened) {
    console.log("视频标注：未找到入口，跳过");
    return;
  }

  await page.waitForTimeout(300);
  const clicked = await page.evaluate((expected) => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const options = Array.from(root.querySelectorAll(".mark-tag-option"));
    const target = options.find((item) => {
      const main = item.querySelector(".option-main");
      return String((main && main.textContent) || "").trim() === expected;
    });
    if (!target) return false;
    target.click();
    return true;
  }, label);
  if (!clicked) {
    console.warn(`视频标注：未找到选项「${label}」，跳过`);
    return;
  }
  console.log(`[sph][mark-tag] 已选择：${label}`);
  await page.waitForTimeout(400);
}

async function clickSphDraftButton(page) {
  // 用实时查询点击：此前的 ElementHandle.click 在影子树重渲染瞬间会拿到
  // 已分离节点，报 not clickable 直接中断发布（e2e 实测）
  await clickSphShadow(page, ".form-btns>div:first-child button", {
    timeout: WAIT_SELECTOR_APPEAR_MS,
    label: "视频号保存草稿按钮",
  });
  await page.waitForTimeout(1000);
}

/**
 * 读取发表页当前「可见」弹窗/toast 的文本。
 * 视频号保存成功的 toast 文案是「已保存」（绿色对勾，存活约 2-3 秒）；
 * 页面里还常驻着 display 之外的隐藏模板（如「将此次编辑保留？」确认框），
 * 只看 computed display/visibility 会把模板当真——必须用 checkVisibility。
 * @returns {Promise<string[]>} 当前可见的弹窗/toast 文本列表（可能多个并存）
 */
async function readVisibleSphDialogTexts(page) {
  try {
    return await page.evaluate(() => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      if (!root) return [];
      const nodes = root.querySelectorAll(
        '[class*="toast"], [class*="Toast"], [class*="dialog"], [class*="Dialog"], [class*="tips"]'
      );
      const out = [];
      for (const d of nodes) {
        let visible = false;
        try {
          visible =
            typeof d.checkVisibility === "function"
              ? d.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
              : d.getClientRects().length > 0;
        } catch (_) {
          visible = false;
        }
        if (!visible) continue;
        // 模板节点可能通过 checkVisibility（如常驻包装层）但实际不占渲染面积：
        // 再要求有真实尺寸且落在视口内，排除离屏/零尺寸的隐藏模板
        const rect = d.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) continue;
        if (
          rect.right <= 0 ||
          rect.bottom <= 0 ||
          rect.left >= window.innerWidth ||
          rect.top >= window.innerHeight
        ) {
          continue;
        }
        const t = String(d.textContent || "").replace(/\s+/g, " ").trim();
        if (t) out.push(t.slice(0, 120));
        if (out.length >= 5) break;
      }
      return out;
    });
  } catch (_) {
    return [];
  }
}

async function clickSphPublishButton(page) {
  await clickSphShadow(page, ".form-btns>div:last-child button", {
    timeout: WAIT_SELECTOR_APPEAR_MS,
    label: "视频号发布按钮",
  });
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

async function fallbackLinkFailureToDraft(page, data, window, event, error) {
  const detail =
    (error && error.message) ||
    (typeof error === "string" ? error : String(error));
  try {
    // 链接在表单前半段填写；失败时仍需等待视频处理完成后才能可靠保存草稿。
    await waitSphUploadProcessing(page);
    await clickSphDraftButton(page);
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      outcome: "draft_saved",
      publishMode: "draft",
      publishToDraft: true,
      needsAttention: true,
      failureStage: "video_link",
      message: `视频号链接添加失败，视频已保存为草稿：${detail}`,
    });
    maybeClosePublishWindow({ ...data, closeWindowAfterPublish: true }, window);
    return true;
  } catch (draftError) {
    const draftDetail =
      (draftError && draftError.message) || String(draftError || "未知错误");
    throw new Error(
      `视频号链接添加失败：${detail}；保存草稿也失败：${draftDetail}`
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
    // 上传失败必须阻断：文件没进上传区还继续填表点发表，会发出残缺作品（PR #52）
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: `视频号视频上传失败: ${(err && err.message) || String(err)}`,
      closeWindow: true,
    });
    return;
  }

  try {
    const text = buildPlatformVideoText("视频号", data.data);
    const isMac = process.platform === "darwin";

    /** 实时查询影子树里的输入字段内容（editor 读 textContent，input 读 value） */
    const readSphField = (sel, isValue) =>
      page.evaluate(
        ({ sel, isValue }) => {
          const app = document.querySelector("wujie-app.wujie_iframe");
          if (!app || !app.shadowRoot) return "";
          const el = app.shadowRoot.querySelector(sel);
          if (!el) return "";
          return isValue
            ? String(el.value || "")
            : String(el.textContent || el.innerText || "");
        },
        { sel, isValue }
      );
    const clearAndType = async () => {
      // 清掉旧内容再输入：视频号简介为「简介+标签」拼接，助手页若恢复上次草稿，
      // 不清空会把新内容追加成双份。wujie 影子树里 selection API 不可靠，用键盘全选。
      await page.keyboard.down(isMac ? "Meta" : "Control");
      await page.keyboard.press("a");
      await page.keyboard.up(isMac ? "Meta" : "Control");
      await page.keyboard.press("Backspace");
    };

    // 简介编辑器：点击聚焦后键盘输入，回读校验未生效则重试
    // （wujie 重渲染会让 ElementHandle/焦点静默失效，键盘输入落空且无报错——e2e 实测）
    const DESC_SEL = ".post-desc-box .input-editor";
    let descOk = false;
    for (let attempt = 1; attempt <= 3 && !descOk; attempt++) {
      await clickSphShadow(page, DESC_SEL, { timeout: 5000, focus: true });
      await clearAndType();
      if (text.description) {
        await page.keyboard.type(text.description, { delay: 50 });
      }
      await page.waitForTimeout(300);
      descOk = matchesHead(await readSphField(DESC_SEL, false), text.description);
      if (!descOk && attempt < 3) {
        console.warn(`[sph] 简介第 ${attempt} 次输入未生效，重输`);
      }
    }
    if (!descOk) {
      throw new Error(
        `描述未写入（期望含「${head(text.description)}」，回读校验失败）`
      );
    }

    const shortTitle = text.shortTitle;
    if (shortTitle) {
      const sel2 =
        'input[placeholder="填写短标题有机会获得更多流量"]';
      let newBt = shortTitle.replace(/[，。、\/,;:!?'"()\[\]{}<>]/g, " ");
      let btOk = false;
      for (let attempt = 1; attempt <= 3 && !btOk; attempt++) {
        await clickSphShadow(page, sel2, { timeout: 5000, focus: true });
        await clearAndType();
        await page.keyboard.type(newBt, { delay: 50 });
        await page.waitForTimeout(300);
        btOk = matchesHead(await readSphField(sel2, true), newBt);
        if (!btOk && attempt < 3) {
          console.warn(`[sph] 短标题第 ${attempt} 次输入未生效，重输`);
        }
      }
      if (!btOk) {
        throw new Error(
          `短标题未写入（期望含「${head(newBt)}」，回读校验失败）`
        );
      }
    } else {
      console.log("视频号短标题未填写，跳过");
    }
  } catch (err) {
    console.error("❌ 输入失败:", err);
    // 输入失败必须阻断：带空描述存草稿/发布会产出残缺作品（PR #52）
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: `视频号描述/短标题填写失败: ${(err && err.message) || String(err)}`,
      closeWindow: true,
    });
    return;
  }

  try {
    const link = resolveVideoLinkOption("视频号", data.publishOptions);
    if (link && link.enabled === true) {
      try {
        const selectedLink = await attachSphVideoLink(page, link);
        console.log(
          `[sph][link] 已添加 ${selectedLink.type} ${selectedLink.value}: ${
            selectedLink.label || ""
          }`
        );
      } catch (linkError) {
        console.error("[sph][link] 添加链接失败:", linkError);
        const handled = await fallbackLinkFailureToDraft(
          page,
          data,
          window,
          event,
          linkError
        );
        if (handled) return;
      }
    }

    try {
      await applySphCreativeStatement(
        page,
        data.data && data.data.creativeStatement
      );
    } catch (markError) {
      console.warn(
        "视频标注选择未完成:",
        markError && markError.message ? markError.message : markError
      );
    }

    await tryDeclareOriginal(page);
    await waitSphUploadProcessing(page);

    // 自定义封面：仅当传入 coverPath；失败抛错中止本次发布
    // （封面是缩略图点击的命脉，不允许静默跳过——与抖音流程同策略）
    const coverPath = data.data && data.data.coverPath;
    if (coverPath) {
      await uploadSphCustomCover(page, coverPath);
    }

    // 所有表单项（包括商品）完成后，草稿和发布只能二选一执行。
    const urlBefore = readPageUrl(page);
    if (isDraftMode) await clickSphDraftButton(page);
    else await clickSphPublishButton(page);
    console.log(
      isDraftMode ? "✅ 视频号视频已保存草稿" : "✅ 视频号视频上传成功"
    );
    // 视频号存草稿不跳转，成功 toast 文案固定为「已保存」（e2e 截图实证），
    // 但渲染位置在 wujie 影子树/内部容器里且类名未知——点击后 6 秒内用
    // 全量文本轮询捕捉（模板噪音已核对不含「已保存」），同时盯可见弹窗：
    // 强拒绝（保存失败/网络异常）抛错走重试；校验提示（请先选择等）重试无用，
    // 归 needs_attention 人工处理
    const extraPayload = {};
    let draftVerdictOverride;
    if (isDraftMode) {
      let toastVerified = false;
      let rejectText = "";
      const deadline = Date.now() + 6000;
      do {
        try {
          const visible = await readVisibleSphDialogTexts(page);
          // 「将此次编辑保留?」为常驻隐藏模板（保存成功后仍会误捕），排除
          const bad = visible.find((t) => !/将此次编辑保留/.test(t));
          if (bad) {
            rejectText = bad;
            break;
          }
        } catch (_) {
          /* 页面跳转中，下一轮再试 */
        }
        try {
          const text = await readPageText(page);
          if (/已保存|保存成功|草稿已保存/.test(text)) {
            toastVerified = true;
            break;
          }
        } catch (_) {
          /* 下一轮再试 */
        }
        if (Date.now() < deadline) {
          await page.waitForTimeout(500).catch(() => {});
        }
      } while (Date.now() < deadline);
      if (rejectText) {
        if (/请(?:先)?(?:填写|输入|选择|上传|勾选|设置|完善)|不能为空|必填/.test(rejectText)) {
          draftVerdictOverride = {
            outcome: "unverified",
            evidence: `平台提示「${rejectText.slice(0, 40)}」，请检查表单后重试`,
          };
        } else {
          throw new Error(`保存草稿被平台拒绝：${rejectText}`);
        }
      } else {
        draftVerdictOverride = toastVerified
          ? { outcome: "verified", evidence: "发表页出现「已保存」提示" }
          : {
              outcome: "unverified",
              evidence: "未见保存成功提示（视频号存草稿无跳转，无法进一步核对）",
            };
      }
    }
    await replyPublishOutcome({
      page,
      data,
      window,
      event,
      urlBefore,
      isDraftMode,
      successMessage: isDraftMode ? "保存草稿成功" : "上传成功",
      extraPayload,
      draftVerdictOverride,
    });
  } catch (err) {
    const detail =
      (err && err.message) || (typeof err === "string" ? err : String(err));
    console.error("❌ 视频号发布失败:", err);
    // 失败瞬间截图留证（登录过期 / 风控弹窗 / 元素改版都能一眼看出）
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message:
        detail && detail.length > 400
          ? `${detail.slice(0, 400)}…`
          : detail || "上传失败",
      closeWindow: true,
    });
  }
}
