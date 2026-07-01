"use strict";

import { ipcMain, app, BrowserWindow, dialog } from "electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import pie from "puppeteer-in-electron";
import path from "path";
import fs from "fs";
import Type from "./Type";
import { UPLOAD_WINDOW_AUTO_CLOSE_MS } from "./upLoad/uploadTimeouts.js";
import { skipCloseConfirmation } from "./upLoad/closeWindow.js";
import { applyAccountProxyForTask } from "./proxyConfig.js";
import {
  applyXhsConservativePublishOptions,
  getPublishAttemptLimit,
  isXhsPlatform,
} from "../../shared/xhsPublishPolicy.js";
import { resolveChromePath } from "./chromeConfig.js";
import xhsChromeHandler from "./upLoad/xhsChrome.js";

import StealthPlugin from "puppeteer-extra-plugin-stealth";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

/**
 * IPC 事件适配为与 CLI 共用的 transport（仅依赖 .reply）
 */
export function createIpcTransport(ipcEvent) {
  return {
    reply(channel, ...args) {
      ipcEvent.reply(channel, ...args);
    },
  };
}

export function createPuppeteerTaskRuntime({ runTask }) {
  const taskQueue = [];
  let taskBusy = false;
  let activeTask = null;

  const processNextTask = () => {
    if (taskBusy) return;
    const next = taskQueue.shift();
    if (!next) return;
    taskBusy = true;
    let cancelHandler = null;
    let doneCalled = false;
    const runtimeTask = {
      ...next,
      setCancelHandler(handler) {
        cancelHandler = handler;
      },
    };
    const queueDone = () => {
      if (doneCalled) return;
      doneCalled = true;
      try {
        if (typeof next.userOnFinish === "function") {
          next.userOnFinish();
        }
      } finally {
        if (activeTask === runtimeTask) activeTask = null;
        taskBusy = false;
        processNextTask();
      }
    };
    runtimeTask.cancel = (reason) => {
      if (typeof cancelHandler === "function") {
        cancelHandler(reason);
      } else {
        queueDone();
      }
    };
    activeTask = runtimeTask;
    runTask(runtimeTask, queueDone);
  };

  return {
    enqueueTask(data, transport, userOnFinish) {
      taskQueue.push({ data, transport, userOnFinish });
      processNextTask();
    },
    cancelPuppeteerTasks(reason = "上传任务已主动中断") {
      const queued = taskQueue.length;
      taskQueue.splice(0, taskQueue.length);
      const active = activeTask && taskBusy ? 1 : 0;
      if (activeTask && taskBusy) {
        activeTask.cancel(reason);
      }
      return {
        active,
        queued,
        total: active + queued,
      };
    },
    getQueueSize() {
      return taskQueue.length;
    },
    isBusy() {
      return taskBusy;
    },
  };
}

const puppeteerTaskRuntime = createPuppeteerTaskRuntime({
  runTask(task, queueDone) {
    doUpload(task.data, task.transport, queueDone, task);
  },
});

function enqueueTask(data, transport, userOnFinish) {
  puppeteerTaskRuntime.enqueueTask(data, transport, userOnFinish);
}

export function cancelPuppeteerTasks(reason) {
  return puppeteerTaskRuntime.cancelPuppeteerTasks(reason);
}

let openPublishWindows = new Set();

export function hasActivePublishTasks() {
  return (
    puppeteerTaskRuntime.isBusy() ||
    puppeteerTaskRuntime.getQueueSize() > 0 ||
    openPublishWindows.size > 0
  );
}

function isExpectedPublishUrl(data, currentUrl) {
  if (currentUrl === data.url) return true;
  if (data && data.pt === "掘金") {
    try {
      const current = new URL(currentUrl);
      const expected = new URL(data.url);
      return (
        current.origin === expected.origin &&
        current.pathname.indexOf("/editor/drafts") === 0
      );
    } catch (_) {
      return (
        String(currentUrl || "").indexOf("https://juejin.cn/editor/drafts") ===
        0
      );
    }
  }
  // 百家号上传页 baidu 经常追加/重排 query（app_id、登录态参数等），strict === 会一直
  // 走 URL 不匹配的重试关窗分支，导致 bjh handler 一次都进不去、日志也不会出现。
  // 改成 origin + /builder/rc/edit 前缀匹配。
  if (data && data.pt === "百家号") {
    try {
      const current = new URL(currentUrl);
      const expected = new URL(data.url);
      return (
        current.origin === expected.origin &&
        current.pathname.indexOf("/builder/rc/edit") === 0
      );
    } catch (_) {
      return (
        String(currentUrl || "").indexOf(
          "https://baijiahao.baidu.com/builder/rc/edit"
        ) === 0
      );
    }
  }
  if (data && data.pt === "番茄视频") {
    try {
      const current = new URL(currentUrl);
      const expected = new URL(data.url);
      return (
        current.origin === expected.origin &&
        current.pathname.indexOf("/fqvideo/home/publish-video") === 0
      );
    } catch (_) {
      return (
        String(currentUrl || "").indexOf(
          "https://pugc.yueduwuxian.com/fqvideo/home/publish-video"
        ) === 0
      );
    }
  }
  return false;
}

/**
 * 注册渲染进程 `puppeteerFile` IPC，与历史行为一致
 */
export function registerPuppeteerIpc() {
  ipcMain.on("puppeteerFile", async (event, args) => {
    enqueueTask(args, createIpcTransport(event));
  });
  ipcMain.on("puppeteerFile:cancelAll", (event, args = {}) => {
    const result = cancelPuppeteerTasks(args.reason);
    event.reply("puppeteerFile:cancelAll-done", result);
  });
}

/**
 * CLI 或其它主进程代码直接调用，与 IPC 共用同一套上传逻辑
 * @param {object} data 与 `ipcRenderer.send("puppeteerFile", data)` 相同结构
 * @param {{ reply: (channel: string, ...args: any[]) => void }} transport
 * @param {() => void} [onFinish] 任务结束时回调（如视频队列）
 */
export function runPuppeteerTask(data, transport, onFinish) {
  enqueueTask(data, transport, onFinish);
}

async function doUpload(data, transport, queueDone, runtimeTask) {
  data = applyXhsConservativePublishOptions(data);
  data.partition = data.partition.split("-")[0];
  const isXhsTask = isXhsPlatform(data.pt);
  const maxRetries = getPublishAttemptLimit(data, 5);
  let currentAttempt = 0;
  let finished = false;
  let activeBrowser = null;
  let activeWin = null;
  let autoCloseTimer = null;
  let actionCheckTimer = null;
  const retryDelay = 1000;

  const safeReply = (channel, payload) => {
    try {
      transport.reply(channel, payload);
      return true;
    } catch (err) {
      console.error(`发送 ${channel} 事件失败:`, err);
      return false;
    }
  };

  const cleanupTaskResources = () => {
    if (actionCheckTimer) {
      clearTimeout(actionCheckTimer);
      actionCheckTimer = null;
    }
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
    if (activeBrowser) {
      try {
        activeBrowser.disconnect();
      } catch (e) {
        console.error("兜底断开浏览器连接失败:", e);
      }
    }
    activeBrowser = null;
  };

  const finishOnce = () => {
    if (finished) return;
    finished = true;
    cleanupTaskResources();
    if (queueDone) queueDone();
  };

  const closePublishWinProgrammatically = (win) => {
    if (win && !win.isDestroyed()) {
      win._mmClosedByProgram = true;
    }
    skipCloseConfirmation(win);
    if (win && !win.isDestroyed()) win.close();
  };

  const createAttemptTransport = () => ({
    reply(channel, ...args) {
      if (finished) return false;
      const payload = args[0];
      if (
        channel === "puppeteerFile-done" &&
        payload &&
        payload.status === false
      ) {
        const err = new Error(payload.message || "平台上传失败");
        err._mmUploadFailurePayload = payload;
        throw err;
      }
      const ok =
        channel === "puppeteerFile-done" &&
        payload &&
        payload.status === true &&
        !payload.skipped;
      const replied = transport.reply(channel, ...args);
      if (ok) finishOnce();
      return replied;
    },
  });

  // 小红书 + 真实 Chrome 浏览器发布（替代 Electron BrowserWindow）
  let _xhsRealChromeFallback = false;

  const runXhsRealChrome = async () => {
    if (finished) return;
    let realBrowser = null;

    // 使用独立的持久化 userDataDir：
    // - 不能用用户真实 Chrome 目录（Chrome 禁止默认目录开 remote-debugging）
    // - 不能用临时目录（每次丢失登录态）
    // - 用 app userData 下的固定目录，首次登录后 cookie 持久保存，后续发布自动复用
    const chromeDataDir = path.join(
      app.getPath("userData"),
      "chrome-xhs-profile"
    );

    try {
      // 1. 获取 Chrome 路径
      const chromePath = resolveChromePath();
      if (!chromePath) {
        console.error("[xhs-chrome] 未找到 Chrome 浏览器，回退到 Electron 窗口模式");
        _xhsRealChromeFallback = true;
        return createWindowAndAttempt();
      }
      console.log("[xhs-chrome] 使用 Chrome:", chromePath);

      // 2. 代理配置
      await applyAccountProxyForTask({
        partition: data.partition,
        phone: data.phone,
        pt: data.pt,
      });

      // 3. 启动真实 Chrome
      //    关键：ignoreDefaultArgs: ['--enable-automation'] 去掉自动化标志，
      //    否则页面顶部会出现「Chrome 正受到自动测试软件的控制」横幅，
      //    小红书检测到后直接 401 拒绝登录态。
      realBrowser = await puppeteerCore.launch({
        executablePath: chromePath,
        headless: false,
        userDataDir: chromeDataDir,
        ignoreDefaultArgs: ["--enable-automation"],
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
        ],
        defaultViewport: { width: 1300, height: 800 },
      });

      // 4. 创建 page 并注入反检测脚本
      const page = (await realBrowser.pages())[0] || (await realBrowser.newPage());

      // 注入反自动化检测（在页面 JS 执行前生效）
      await page.evaluateOnNewDocument(() => {
        // 抹掉 webdriver 标记
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        // 补全 window.chrome
        if (!window.chrome) window.chrome = {};
        window.chrome.runtime = window.chrome.runtime || {};
      });

      // 5. 导航到发布页
      console.log("[xhs-chrome] 导航到发布页:", data.url);
      await page.goto(data.url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // 6. 检测登录状态：如果被重定向到登录页，提示用户登录
      const LOGIN_WAIT_TIMEOUT = 5 * 60 * 1000;
      const LOGIN_CHECK_INTERVAL = 2000;
      const isOnPublishPage = (url) => url && url.includes("creator.xiaohongshu.com/publish");

      let currentUrl = page.url();
      if (!isOnPublishPage(currentUrl)) {
        console.log("[xhs-chrome] 未在发布页，可能未登录，当前 URL:", currentUrl);

        // 弹窗提醒用户去浏览器登录
        dialog.showMessageBox({
          type: "info",
          title: "小红书 - 真实浏览器登录",
          message: "请在 Chrome 浏览器中登录小红书",
          detail: "首次使用真实浏览器发布需要登录一次小红书创作者平台。\n登录成功后将自动继续发布，后续不再需要重复登录。\n\n最多等待 5 分钟。",
          buttons: ["知道了"],
          noLink: true,
        }).catch(() => {});

        // 轮询等待用户登录
        const loginStartTime = Date.now();
        let loggedIn = false;
        while (Date.now() - loginStartTime < LOGIN_WAIT_TIMEOUT) {
          await new Promise((r) => setTimeout(r, LOGIN_CHECK_INTERVAL));
          if (finished) return;
          try {
            currentUrl = page.url();
          } catch (_) {
            continue;
          }
          if (isOnPublishPage(currentUrl)) {
            loggedIn = true;
            console.log("[xhs-chrome] 用户已登录，到达发布页");
            break;
          }
          // 登录后到了创作者中心但不在发布页，帮用户跳转
          if (currentUrl.includes("creator.xiaohongshu.com") && !currentUrl.includes("/login")) {
            console.log("[xhs-chrome] 已登录，自动跳转到发布页");
            try {
              await page.goto(data.url, { waitUntil: "domcontentloaded", timeout: 30000 });
              if (isOnPublishPage(page.url())) { loggedIn = true; break; }
            } catch (_) {}
          }
        }
        if (!loggedIn) {
          throw new Error("等待登录超时（5 分钟），请登录后重试");
        }
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        console.log("[xhs-chrome] 浏览器已登录，直接发布");
      }

      // 7. 执行发布
      await xhsChromeHandler(page, data, realBrowser, createAttemptTransport());
    } catch (err) {
      console.error("[xhs-chrome] 真实浏览器发布失败:", err?.message || err);
      safeReply("puppeteerFile-done", {
        ...data,
        status: false,
        message: `真实浏览器发布失败: ${err?.message || err}`,
      });
      finishOnce();
    } finally {
      // 只断开 puppeteer 连接，不关闭 Chrome 窗口
      // 让用户可以在浏览器中手动完成操作或查看结果
      if (realBrowser) {
        try { realBrowser.disconnect(); } catch (_) {}
      }
    }
  };

  const createWindowAndAttempt = async () => {
    if (finished) return;

    // 小红书 + 真实浏览器模式开关（fallback 时跳过，避免循环）
    if (isXhsTask && data.useRealBrowser && !_xhsRealChromeFallback) {
      return runXhsRealChrome();
    }

    currentAttempt++;
    if (currentAttempt > maxRetries) {
      console.log("已达到最大重试次数，操作失败", data);
      safeReply("puppeteer-noLogin", data);
      safeReply("puppeteerFile-done", { ...data, status: false });
      finishOnce();
      return;
    }

    let browser;
    let win;
    let page;

    try {
      const proxyResult = await applyAccountProxyForTask({
        partition: data.partition,
        phone: data.phone,
        pt: data.pt,
      });
      if (proxyResult.applied) {
        console.log(
          `[proxy] 发布任务 ${data.partition} 使用代理 ${proxyResult.display}`
        );
      }

      browser = await pie.connect(app, puppeteer);
      activeBrowser = browser;
      win = new BrowserWindow({
        show: isXhsTask
          ? true
          : data.mmCliSuppressWindow
          ? false
          : data?.show ?? false,
        width: data?.width ?? 1300,
        height: data?.height ?? 800,
        title: `${data.partition} (尝试${currentAttempt}/${maxRetries})`,
        webPreferences: {
          partition: data.partition,
          nodeIntegration: false,
          contextIsolation: true,
          devTools: true,
        },
      });
      activeWin = win;
      openPublishWindows.add(win);
      page = await pie.getPage(browser, win);

      // 注入反自动化检测脚本（在页面 JS 执行前生效）
      // 解决小红书等平台判定 Electron 为 "AI 自动化" 的问题
      await page.evaluateOnNewDocument(() => {
        // 1. 补全 window.chrome 对象（Electron 中缺失，正常 Chrome 有）
        if (!window.chrome) {
          window.chrome = {};
        }
        window.chrome.runtime = window.chrome.runtime || {};
        window.chrome.runtime.id =
          window.chrome.runtime.id ||
          "e" +
            Math.random().toString(36).slice(2, 11) +
            Math.random().toString(36).slice(2, 11);
        window.chrome.loadTimes =
          window.chrome.loadTimes ||
          function () {
            return {};
          };
        window.chrome.csi =
          window.chrome.csi ||
          function () {
            return {};
          };
        window.chrome.app =
          window.chrome.app ||
          function () {
            return {};
          };

        // 2. 补全 navigator.plugins（Electron 通常为空数组，正常 Chrome 有 PDF Viewer 等）
        if (
          !navigator.plugins ||
          navigator.plugins.length === 0
        ) {
          const createFakePlugin = (name, filename, desc) => {
            const plugin = {
              name,
              filename,
              description: desc,
              length: 1,
              0: { type: "application/x-google-chrome-pdf", suffixes: "pdf" },
              item() {
                return null;
              },
              namedItem() {
                return null;
              },
            };
            return plugin;
          };
          const fakePlugins = [
            createFakePlugin(
              "Chrome PDF Plugin",
              "internal-pdf-viewer",
              "Portable Document Format"
            ),
            createFakePlugin(
              "Chrome PDF Viewer",
              "mhjfbmdgcfjbbpaeojofohoefgiehjai",
              ""
            ),
            createFakePlugin(
              "Native Client",
              "internal-nacl-plugin",
              ""
            ),
          ];
          Object.defineProperty(navigator, "plugins", {
            get() {
              const arr = Object.create(
                fakePlugins.length === 0 ? Array.prototype : {
                  ...Object.getPrototypeOf(fakePlugins[0]),
                  length: fakePlugins.length,
                  item(i) {
                    return fakePlugins[i] || null;
                  },
                  namedItem(name) {
                    return fakePlugins.find((p) => p.name === name) || null;
                  },
                  refresh() {},
                }
              );
              fakePlugins.forEach((p, i) => (arr[i] = p));
              return arr;
            },
          });
          Object.defineProperty(navigator, "mimeTypes", {
            get() {
              const types = [
                {
                  type: "application/pdf",
                  suffixes: "pdf",
                  description: "Portable Document Format",
                  enabledPlugin: fakePlugins[0],
                },
                {
                  type: "text/pdf",
                  suffixes: "pdf",
                  description: "Portable Document Format",
                  enabledPlugin: fakePlugins[0],
                },
              ];
              const arr = Object.create({
                ...Object.getPrototypeOf(types[0]),
                length: types.length,
                item(i) {
                  return types[i] || null;
                },
                namedItem(name) {
                  return types.find((t) => t.type === name) || null;
                },
              });
              types.forEach((t, i) => (arr[i] = t));
              return arr;
            },
          });
        }

        // 3. 覆盖 navigator.hardwareConcurrency（Electron 可能暴露真实核心数，正常 Chrome 会模糊）
        const cp = Object.getOwnPropertyDescriptor(
          Navigator.prototype,
          "hardwareConcurrency"
        );
        if (cp && cp.configurable) {
          Object.defineProperty(navigator, "hardwareConcurrency", {
            get() {
              return 8;
            },
          });
        }

        // 4. 补全 navigator.languages 为正常中文用户设置
        const origLanguages = navigator.languages;
        if (!origLanguages || origLanguages.length === 0) {
          Object.defineProperty(navigator, "languages", {
            get() {
              return ["zh-CN", "zh", "en"];
            },
          });
        }

        // 5. 覆盖 permissions.query（Electron 返回状态与 Chrome 不一致）
        const origQuery =
          window.navigator.permissions &&
          window.navigator.permissions.query;
        if (origQuery) {
          const origQueryFn = origQuery.bind(window.navigator.permissions);
          window.navigator.permissions.query = function (parameters) {
            if (parameters && parameters.name === "notifications") {
              return Promise.resolve({
                state: Notification.permission,
                onchange: null,
              });
            }
            return origQueryFn(parameters);
          };
        }

        // 6. 抹掉 webdriver 属性（双保险，stealth 插件也应处理了）
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });
      });

      // Block any window.open() calls from the publish page (e.g. Juejin OAuth popups)
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

      // 站点在上传中常注册 beforeunload；用户主动关窗时二次确认，程序自动关窗见 skipCloseConfirmation。
      win.webContents.on("will-prevent-unload", (event) => {
        if (win._mmAllowCloseWithoutConfirm) {
          win._mmAllowCloseWithoutConfirm = false;
          event.preventDefault();
          return;
        }
        if (win.isDestroyed()) return;
        const choice = dialog.showMessageBoxSync(win, {
          type: "warning",
          title: "关闭发布窗口",
          message:
            "当前页面可能正在上传或已暂停，关闭将放弃未完成的操作。\n\n确定要关闭吗？",
          buttons: ["仍要关闭", "取消"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (choice === 0) {
          event.preventDefault();
        }
      });

      const AUTO_CLOSE_DELAY = UPLOAD_WINDOW_AUTO_CLOSE_MS;
      if (!isXhsTask) {
        autoCloseTimer = setTimeout(() => {
          console.log(
            `窗口 ${data.partition} 已自动关闭（${Math.round(
              AUTO_CLOSE_DELAY / 60000
            )} 分钟兜底超时）`
          );
          closePublishWinProgrammatically(win);
        }, AUTO_CLOSE_DELAY);
      }

      // 统一 UA：所有平台都强制设置 data.useragent。
      // 这一步很关键：账号管理里 <webview> 是用 ptConfig[pt].useragent（Chrome/138 桌面 UA）扫码登的，
      // 而 BrowserWindow 默认 UA 带 "Electron/x.x.x" 字样。如果发布时不改 UA，
      // 小红书 / 抖音 / 快手等站点的风控会把"同账号、不同 UA"判定为换设备，
      // cookie 即使共享也会被要求重新登录，表现就是用户看到的"重复登录"。
      // 之前的代码只在 pt 含"视频"时才 setUserAgent，是历史遗留，现在统一对齐。
      if (data.useragent) {
        if (
          win &&
          !win.isDestroyed() &&
          win.webContents &&
          !win.webContents.isDestroyed()
        ) {
          try {
            win.webContents.setUserAgent(data.useragent);
          } catch (e) {
            console.warn("win.webContents.setUserAgent 失败:", e?.message || e);
          }
        }
        try {
          await page.setUserAgent(data.useragent);
        } catch (e) {
          console.warn("page.setUserAgent 失败:", e?.message || e);
        }
      }

      if (data.pt.indexOf("视频") !== -1) {
        // 视频号原来用 page.goto + domcontentloaded，保持不变避免回归。
        await page.goto(data.url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
      } else {
        await win.loadURL(data.url);
      }

      win.on("closed", () => {
        openPublishWindows.delete(win);
        if (autoCloseTimer) {
          clearTimeout(autoCloseTimer);
          autoCloseTimer = null;
        }
        try {
          if (browser) browser.disconnect();
        } catch (_) {
          // 忽略
        }
        if (activeWin === win) activeWin = null;
        if (activeBrowser === browser) activeBrowser = null;
        if (finished) return;
        const retry =
          Boolean(win._mmRetryAfterClose) && currentAttempt < maxRetries;
        if (retry) {
          setTimeout(() => {
            createWindowAndAttempt().catch((err) => {
              console.error("重试创建窗口失败:", err);
              safeReply("puppeteerFile-done", {
                ...data,
                status: false,
                message: "重试失败",
              });
              finishOnce();
            });
          }, retryDelay);
          return;
        }
        // 用户主动关窗（非程序自动关窗 / 非重试关窗）：跳过该平台，继续队列中的下一项
        const userClosed = !win._mmClosedByProgram;
        if (userClosed) {
          console.log(`用户关闭 ${data.partition} 发布窗口，跳过 ${data.pt}`);
          safeReply("puppeteerFile-done", {
            ...data,
            status: false,
            skipped: true,
            message: "用户关闭窗口，已跳过该平台的发布",
          });
          finishOnce();
          return;
        }
        if (currentAttempt >= maxRetries) {
          safeReply("puppeteer-noLogin", data);
          safeReply("puppeteerFile-done", {
            ...data,
            status: false,
            message: "窗口已关闭，任务结束",
          });
        }
        finishOnce();
      });

      actionCheckTimer = setTimeout(async () => {
        actionCheckTimer = null;
        if (finished) return;
        try {
          if (!page || typeof page.url !== "function") {
            throw new Error("页面对象不可用");
          }
          const currentUrl = page.url();
          if (isExpectedPublishUrl(data, currentUrl)) {
            const action = Type[data.pt];
            if (typeof action !== "function") {
              // pt 没注册处理器属于配置/调用方错误，重试 5 次也变不出来 handler，
              // 反而会反复打开同一个 URL，触发站点重复登录（典型例子：账号管理
              // 之前发的 pt="小红书登录" 在 Type.js 里没对应项）。直接终结任务。
              console.warn(
                `未找到平台处理器: ${data.pt}，跳过重试直接结束任务`
              );
              safeReply("puppeteerFile-done", {
                ...data,
                status: false,
                message: `未找到平台处理器: ${data.pt}`,
              });
              if (win && !win.isDestroyed())
                closePublishWinProgrammatically(win);
              finishOnce();
              return;
            }
            await action(page, data, win, createAttemptTransport(), finishOnce);
          } else {
            console.log(
              `尝试${currentAttempt} URL不匹配: ${currentUrl}，关闭窗口并重新尝试`
            );
            if (isXhsTask) {
              safeReply("puppeteerFile-done", {
                ...data,
                status: false,
                message: `小红书页面地址异常，已保留窗口: ${currentUrl}`,
              });
              finishOnce();
              return;
            }
            if (win && !win.isDestroyed()) {
              win._mmRetryAfterClose = true;
              closePublishWinProgrammatically(win);
            }
          }
        } catch (err) {
          if (finished) return;
          console.log(`尝试${currentAttempt}执行平台逻辑失败:`, err);
          const failurePayload = err && err._mmUploadFailurePayload;
          if (currentAttempt >= maxRetries) {
            safeReply("puppeteerFile-done", {
              ...data,
              ...failurePayload,
              status: false,
              message: (failurePayload && failurePayload.message) || "执行失败",
            });
            if (!isXhsTask && win && !win.isDestroyed())
              closePublishWinProgrammatically(win);
            finishOnce();
            return;
          }
          if (win && !win.isDestroyed()) {
            win._mmRetryAfterClose = true;
            closePublishWinProgrammatically(win);
          }
        }
      }, 3000);
    } catch (error) {
      const proxyConfigError =
        error && /代理/.test(String(error.message || error));
      if (proxyConfigError) {
        console.log(`尝试${currentAttempt}代理配置错误:`, error);
        safeReply("puppeteerFile-done", {
          ...data,
          status: false,
          message: error.message || "代理配置错误",
        });
        finishOnce();
        return;
      }
      console.log(`尝试${currentAttempt}发生错误:`, error);
      if (isXhsTask) {
        safeReply("puppeteerFile-done", {
          ...data,
          status: false,
          message: error.message || "小红书任务异常，已保留窗口",
        });
        finishOnce();
        return;
      }
      if (win && !win.isDestroyed()) {
        win._mmRetryAfterClose = true;
        closePublishWinProgrammatically(win);
      }
      if (browser) browser.disconnect();
      if (finished) return;
      setTimeout(() => {
        createWindowAndAttempt().catch((err) => {
          console.error("重试创建窗口失败:", err);
          safeReply("puppeteerFile-done", {
            ...data,
            status: false,
            message: "重试失败",
          });
          finishOnce();
        });
      }, retryDelay);
    }
  };

  if (runtimeTask && typeof runtimeTask.setCancelHandler === "function") {
    runtimeTask.setCancelHandler((reason) => {
      if (finished) return;
      const message = reason || "上传任务已主动中断";
      safeReply("puppeteerFile-done", {
        ...data,
        status: false,
        interrupted: true,
        message,
      });
      if (activeWin && !activeWin.isDestroyed()) {
        closePublishWinProgrammatically(activeWin);
      }
      finishOnce();
    });
  }

  setTimeout(() => {
    createWindowAndAttempt().catch((err) => {
      console.error("首次创建窗口失败:", err);
      safeReply("puppeteerFile-done", {
        ...data,
        status: false,
        message: "创建窗口失败",
      });
      finishOnce();
    });
  }, retryDelay);
}

/** @deprecated 使用 registerPuppeteerIpc */
export default function upFile() {
  registerPuppeteerIpc();
}
