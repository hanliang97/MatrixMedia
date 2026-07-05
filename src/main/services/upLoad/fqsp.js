import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
} from "./uploadTimeouts.js";

const FILE_INPUT_SELECTORS = [
  'input[type="file"][accept*=".mp4"][multiple]',
  'input[type="file"][accept*=".mp4"]',
  'input[type="file"][accept*="mp4"][multiple]',
  'input[type="file"][accept*="mp4"]',
  'input[type="file"][multiple]',
  'input[type="file"]',
];
const UPLOAD_ZONE_SELECTORS = [
  ".upload-vmok-file-input-area",
  '[class*="upload-input-container"]',
  '[class*="upload-input-icon-container"]',
  '[data-rbd-droppable-id="album-upload-list-a"]',
];
const UPLOAD_LIST_SELECTOR = '[data-rbd-droppable-id="album-upload-list-a"]';
const VIDEO_LIST_URL =
  "https://pugc.yueduwuxian.com/fqvideo/home/video-list";

function getErrorMessage(error) {
  if (!error) return "未知错误";
  return error.message || (typeof error === "string" ? error : String(error));
}

function isLoginPageUrl(url) {
  return String(url || "").includes("/fqvideo/login");
}

async function findVideoFileInput(page) {
  for (const selector of FILE_INPUT_SELECTORS) {
    const handle = await page.$(selector);
    if (handle) return handle;
  }
  return null;
}

async function waitForUploadZone(page) {
  const deadline = Date.now() + WAIT_SELECTOR_APPEAR_MS;
  while (Date.now() < deadline) {
    for (const selector of UPLOAD_ZONE_SELECTORS) {
      const handle = await page.$(selector);
      if (handle) return { handle, selector };
    }
    const textHit = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("div, span"));
      return nodes.some(el =>
        String(el.textContent || "").includes("点击或拖拽文件到此上传")
      );
    });
    if (textHit) return { handle: null, selector: "text:点击或拖拽" };
    await page.waitForTimeout(500);
  }
  throw new Error("未找到番茄视频上传区域（input 需点击后才动态创建）");
}

async function clickUploadZone(page) {
  for (const selector of UPLOAD_ZONE_SELECTORS) {
    const handle = await page.$(selector);
    if (handle) {
      await handle.evaluate(el => {
        el.scrollIntoView({ block: "center", inline: "center" });
      });
      await handle.click({ delay: 80 });
      return selector;
    }
  }

  const clicked = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("div, span, button"));
    const hit = nodes.find(el => {
      const text = String(el.textContent || "").trim();
      return text === "点击或拖拽文件到此上传" || text.includes("点击或拖拽文件到此上传");
    });
    if (!hit) return "";
    hit.scrollIntoView({ block: "center", inline: "center" });
    hit.click();
    return "text:点击或拖拽";
  });
  if (!clicked) {
    throw new Error("未找到可点击的番茄视频上传区域");
  }
  return clicked;
}

async function waitForDynamicFileInput(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const input = await findVideoFileInput(page);
    if (input) return input;
    await page.waitForTimeout(300);
  }
  return null;
}

async function triggerInputEvents(uploadInput) {
  await uploadInput.evaluate(el => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function hasUploadStarted(page) {
  return page
    .evaluate(listSel => {
      const root =
        document.querySelector(listSel) ||
        document.querySelector('[class*="upload-list"]') ||
        document.body;
      if (root.querySelector(".upload-status")) return true;
      if (root.querySelector('[class*="upload-item"]')) return true;
      if (root.querySelector(".upload-video-cover-img")) return true;
      return false;
    }, UPLOAD_LIST_SELECTOR)
    .catch(() => false);
}

async function waitForUploadStarted(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasUploadStarted(page)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/** 方式 1：点击上传区 → 拦截 FileChooser（input 可能尚未挂载到 DOM） */
async function uploadViaFileChooser(page, filePath) {
  const [fileChooser, zoneClicked] = await Promise.all([
    page.waitForFileChooser({ timeout: 15000 }),
    clickUploadZone(page),
  ]);

  if (!zoneClicked) {
    await fileChooser.cancel().catch(() => {});
    throw new Error("点击上传区域失败");
  }

  await fileChooser.accept([filePath]);
  console.log("[fqsp] 方式1 FileChooser:", filePath, "触发区:", zoneClicked);
}

/** 方式 2：点击上传区 → 等待动态创建的 input → uploadFile */
async function uploadViaDynamicInput(page, filePath) {
  const zoneClicked = await clickUploadZone(page);
  await page.waitForTimeout(500);
  const uploadInput = await waitForDynamicFileInput(page, 15000);
  if (!uploadInput) {
    throw new Error(
      `点击 ${zoneClicked} 后仍未出现 file input（番茄视频可能延迟挂载）`
    );
  }
  await uploadInput.uploadFile(filePath);
  await triggerInputEvents(uploadInput);
  console.log("[fqsp] 方式2 动态 input uploadFile:", filePath, "触发区:", zoneClicked);
}

/** 方式 3：在 .upload-vmok-file-input-area 内再次点击并查找 input */
async function uploadViaVmokAreaInput(page, filePath) {
  const area = await page.$(".upload-vmok-file-input-area");
  if (!area) throw new Error("未找到 .upload-vmok-file-input-area");

  await area.evaluate(el => {
    el.scrollIntoView({ block: "center", inline: "center" });
  });
  await area.click({ delay: 80 });
  await page.waitForTimeout(800);

  const uploadInput = await page.evaluateHandle(() => {
    const root = document.querySelector(".upload-vmok-file-input-area");
    if (!root) return null;
    return (
      root.querySelector('input[type="file"]') ||
      document.querySelector('input[type="file"]')
    );
  });
  const element = uploadInput.asElement();
  if (!element) {
    throw new Error("upload-vmok-file-input-area 内未出现 file input");
  }
  await element.uploadFile(filePath);
  await triggerInputEvents(element);
  console.log("[fqsp] 方式3 vmok-area input uploadFile:", filePath);
}

async function uploadVideoWithFallbacks(page, filePath) {
  const strategies = [
    { name: "file-chooser", run: () => uploadViaFileChooser(page, filePath) },
    { name: "dynamic-input", run: () => uploadViaDynamicInput(page, filePath) },
    { name: "vmok-area-input", run: () => uploadViaVmokAreaInput(page, filePath) },
  ];

  let lastError = null;
  for (const strategy of strategies) {
    try {
      await strategy.run();
      const started = await waitForUploadStarted(page, 12000);
      if (started) {
        console.log(`[fqsp] 上传已触发，使用方式: ${strategy.name}`);
        return strategy.name;
      }
      console.warn(`[fqsp] ${strategy.name} 执行后未检测到上传列表，尝试下一种方式`);
    } catch (error) {
      lastError = error;
      console.warn(
        `[fqsp] ${strategy.name} 失败:`,
        error && error.message ? error.message : error
      );
    }
  }

  throw lastError || new Error("所有上传方式均未触发页面响应");
}

async function waitForFqspUploadComplete(page) {
  const deadline = Date.now() + WAIT_UPLOAD_PROCESSING_MS;
  let lastLogValue = "";
  let lastLogAt = 0;

  while (Date.now() < deadline) {
    const snapshot = await page
      .evaluate((listSel) => {
        const root =
          document.querySelector(listSel) ||
          document.querySelector('[class*="upload-list"]') ||
          document.body;
        const statuses = [...root.querySelectorAll(".upload-status")].map(el =>
          String(el.textContent || "").replace(/\s+/g, " ").trim()
        );
        return {
          count: statuses.length,
          statuses,
        };
      }, UPLOAD_LIST_SELECTOR)
      .catch(() => ({ count: 0, statuses: [] }));

    const logValue =
      snapshot.statuses.length > 0
        ? snapshot.statuses
            .map((text, index) => `#${index + 1} ${text || "-"}`)
            .join(" | ")
        : "未找到 .upload-status";

    if (logValue !== lastLogValue || Date.now() - lastLogAt >= 5000) {
      console.log(`[fqsp] 上传进度：${logValue}`);
      lastLogValue = logValue;
      lastLogAt = Date.now();
    }

    const allDone =
      snapshot.count > 0 &&
      snapshot.statuses.every(
        text => text.includes("上传完成") || text.includes("100%")
      );
    if (allDone) return;

    await page.waitForTimeout(2000);
  }

  const err = new Error("等待番茄视频上传完成超时");
  err.name = "TimeoutError";
  throw err;
}

async function openPlatformPanel(page) {
  const snapshot = await page.evaluate(() => {
    const isVisible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };

    const panelItems = [...document.querySelectorAll(".platform-panel-item")];
    if (panelItems.some(isVisible)) {
      return { mode: "already-open", itemCount: panelItems.length };
    }

    const triggerCandidates = [
      ...document.querySelectorAll(".platform-panel-trigger"),
      ...document.querySelectorAll(".publish-video-footer-left .platform-panel-trigger-text"),
    ];
    for (const el of triggerCandidates) {
      const text = String(el.textContent || "").replace(/\s+/g, "");
      if (
        el.classList.contains("platform-panel-trigger") ||
        text.includes("发布至App")
      ) {
        const clickTarget =
          el.closest(".platform-panel-trigger") ||
          el.closest(".arco-dropdown-open") ||
          el;
        clickTarget.scrollIntoView({ block: "center", inline: "center" });
        clickTarget.click();
        return { mode: "clicked-trigger", label: text || "platform-panel-trigger" };
      }
    }

    const footer = document.querySelector(".publish-video-footer-left");
    if (footer) {
      const hit = [...footer.querySelectorAll("div, span")].find(el =>
        String(el.textContent || "").includes("发布至App")
      );
      if (hit) {
        hit.scrollIntoView({ block: "center", inline: "center" });
        hit.click();
        return { mode: "clicked-footer-text", label: "发布至App" };
      }
    }

    return { mode: "not-found", itemCount: 0 };
  });

  if (snapshot.mode === "not-found") {
    throw new Error("未找到「发布至App」平台面板入口");
  }

  console.log("[fqsp] 打开发布平台面板:", snapshot.mode, snapshot.label || "");

  await page.waitForFunction(
    () => {
      const isVisible = el => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return [...document.querySelectorAll(".platform-panel-item")].some(isVisible);
    },
    { timeout: 15000 }
  );
}

async function readPlatformSwitchState(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll(".platform-panel-item")].filter(item => {
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const rows = items.map(item => {
      const label =
        (item.querySelector(".platform-panel-item-left-text") &&
          item.querySelector(".platform-panel-item-left-text").textContent) ||
        "";
      const sw = item.querySelector('button[role="switch"]');
      const checked =
        !!sw &&
        (sw.getAttribute("aria-checked") === "true" ||
          sw.classList.contains("arco-switch-checked"));
      return {
        label: String(label).trim(),
        checked,
        hasSwitch: !!sw,
      };
    });
    return {
      total: rows.length,
      checked: rows.filter(row => row.checked).length,
      rows,
    };
  });
}

/** 上传完成后：展开「发布至App」并勾选全部平台 switch */
async function ensureAllPlatformSwitchesChecked(page) {
  await openPlatformPanel(page);

  const maxRounds = 8;
  for (let round = 0; round < maxRounds; round++) {
    const before = await readPlatformSwitchState(page);
    if (before.total === 0) {
      throw new Error("平台面板中未找到发布渠道项");
    }

    const clickResult = await page.evaluate(() => {
      let clicked = 0;
      const items = [...document.querySelectorAll(".platform-panel-item")];
      for (const item of items) {
        const sw = item.querySelector('button[role="switch"]');
        if (!sw) continue;
        const checked =
          sw.getAttribute("aria-checked") === "true" ||
          sw.classList.contains("arco-switch-checked");
        if (!checked) {
          sw.scrollIntoView({ block: "center", inline: "center" });
          sw.click();
          clicked++;
        }
      }
      return clicked;
    });

    await page.waitForTimeout(clickResult > 0 ? 600 : 300);
    const after = await readPlatformSwitchState(page);
    console.log(
      `[fqsp] 发布平台 switch 第 ${round + 1} 轮：` +
        `${after.checked}/${after.total} 已开启，本轮点击 ${clickResult} 个`
    );
    console.log("[fqsp] 平台明细:", JSON.stringify(after.rows));

    if (after.checked === after.total && after.total > 0) {
      return after;
    }
  }

  const finalState = await readPlatformSwitchState(page);
  const unchecked = finalState.rows
    .filter(row => !row.checked)
    .map(row => row.label || "未知平台")
    .join("、");
  throw new Error(
    `未能勾选全部发布平台（${finalState.checked}/${finalState.total}）` +
      (unchecked ? `，未开启：${unchecked}` : "")
  );
}

async function waitForPublishButtonReady(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const btn = buttons.find(b =>
        String(b.textContent || "")
          .replace(/\s+/g, "")
          .includes("一键发布")
      );
      return !!(btn && !btn.disabled);
    });
    if (ready) return;
    await page.waitForTimeout(500);
  }
}

async function clickOneClickPublish(page) {
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find(b =>
      String(b.textContent || "")
        .replace(/\s+/g, "")
        .includes("一键发布")
    );
    if (!btn || btn.disabled) return false;
    btn.scrollIntoView({ block: "center", inline: "center" });
    btn.click();
    return true;
  });
  if (!clicked) {
    throw new Error("未找到可点击的「一键发布」按钮");
  }
}

async function waitForFqspPublishResult(page) {
  await page.waitForTimeout(3000);

  if (isLoginPageUrl(page.url())) {
    throw new Error("未登录或 session 失效，请重新登录番茄视频");
  }

  const result = await page
    .evaluate(() => {
      const isVisible = el => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const errorReg = /失败|错误|异常|请重试|未通过|不能为空/;
      const successReg = /发布成功|提交成功|操作成功/;
      const noticeSelectors = [
        ".arco-message",
        ".arco-notification",
        "[class*='message']",
        "[class*='toast']",
        "[class*='Toast']",
      ];
      const notices = Array.from(
        document.querySelectorAll(noticeSelectors.join(","))
      );
      let successText = "";
      let errorText = "";
      for (const el of notices) {
        if (!isVisible(el)) continue;
        const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        if (successReg.test(text)) successText = text;
        if (errorReg.test(text)) errorText = text;
      }
      return { successText, errorText };
    })
    .catch(() => ({ successText: "", errorText: "" }));

  if (result.errorText) {
    throw new Error(result.errorText);
  }
  if (result.successText) {
    console.log("[fqsp] 发布反馈:", result.successText);
  }
}

export default async function (page, data, window, event) {
  let publishStage = "初始化";

  try {
    if (isLoginPageUrl(page.url())) {
      throw new Error("未登录或 session 失效，请先在 GUI 登录番茄视频");
    }

    publishStage = "等待上传区域";
    console.log("[fqsp] 开始发布:", data?.bt || data?.title || data?.filePath);
    const uploadZone = await waitForUploadZone(page);
    console.log("[fqsp] 上传区域已就绪:", uploadZone.selector);

    publishStage = "上传视频";
    const filePath = path.resolve(data.filePath);
    const uploadMode = await uploadVideoWithFallbacks(page, filePath);
    console.log("[fqsp] 上传方式:", uploadMode, filePath);

    publishStage = "等待上传完成";
    await waitForFqspUploadComplete(page);

    publishStage = "勾选发布平台";
    await ensureAllPlatformSwitchesChecked(page);

    publishStage = "等待一键发布可点击";
    await waitForPublishButtonReady(page);

    publishStage = "点击一键发布";
    await clickOneClickPublish(page);

    publishStage = "等待发布结果";
    await waitForFqspPublishResult(page);

    console.log("[fqsp] 番茄视频发布成功");
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      message: "上传成功",
      url: VIDEO_LIST_URL,
    });
    maybeClosePublishWindow(data, window);
  } catch (error) {
    const detail = getErrorMessage(error);
    console.error(`[fqsp] 番茄视频发布失败，阶段：${publishStage}`, error);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: `上传失败：${publishStage} - ${detail}`,
    });
    maybeClosePublishWindow(data, window);
  }
}
