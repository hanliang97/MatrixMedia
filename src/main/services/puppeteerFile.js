"use strict";

import { ipcMain, app, BrowserWindow, dialog } from "electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import pie from "puppeteer-in-electron";
import Type from "./Type";
import { UPLOAD_WINDOW_AUTO_CLOSE_MS } from "./upLoad/uploadTimeouts.js";
import { skipCloseConfirmation } from "./upLoad/closeWindow.js";

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
    runtimeTask.cancel = reason => {
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

function isExpectedPublishUrl(data, currentUrl) {
  if (currentUrl === data.url) return true;
  if (data && data.pt === "掘金") {
    try {
      const current = new URL(currentUrl);
      const expected = new URL(data.url);
      return current.origin === expected.origin && current.pathname.indexOf("/editor/drafts") === 0;
    } catch (_) {
      return String(currentUrl || "").indexOf("https://juejin.cn/editor/drafts") === 0;
    }
  }
  // 百家号上传页 baidu 经常追加/重排 query（app_id、登录态参数等），strict === 会一直
  // 走 URL 不匹配的重试关窗分支，导致 bjh handler 一次都进不去、日志也不会出现。
  // 改成 origin + /builder/rc/edit 前缀匹配。
  if (data && data.pt === "百家号") {
    try {
      const current = new URL(currentUrl);
      const expected = new URL(data.url);
      return current.origin === expected.origin && current.pathname.indexOf("/builder/rc/edit") === 0;
    } catch (_) {
      return String(currentUrl || "").indexOf("https://baijiahao.baidu.com/builder/rc/edit") === 0;
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
  data.partition = data.partition.split("-")[0];
  const maxRetries = 5;
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

  const closePublishWinProgrammatically = win => {
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
      if (channel === "puppeteerFile-done" && payload && payload.status === false) {
        const err = new Error(payload.message || "平台上传失败");
        err._mmUploadFailurePayload = payload;
        throw err;
      }
      return transport.reply(channel, ...args);
    },
  });

  const createWindowAndAttempt = async () => {
    if (finished) return;
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
      browser = await pie.connect(app, puppeteer);
      activeBrowser = browser;
      win = new BrowserWindow({
        show: data.mmCliSuppressWindow ? false : data?.show ?? false,
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
      page = await pie.getPage(browser, win);

      // Block any window.open() calls from the publish page (e.g. Juejin OAuth popups)
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

      // 站点在上传中常注册 beforeunload；用户主动关窗时二次确认，程序自动关窗见 skipCloseConfirmation。
      win.webContents.on("will-prevent-unload", event => {
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
      autoCloseTimer = setTimeout(() => {
        console.log(`窗口 ${data.partition} 已自动关闭（${Math.round(AUTO_CLOSE_DELAY / 60000)} 分钟兜底超时）`);
        closePublishWinProgrammatically(win);
      }, AUTO_CLOSE_DELAY);

      // 统一 UA：所有平台都强制设置 data.useragent。
      // 这一步很关键：账号管理里 <webview> 是用 ptConfig[pt].useragent（Chrome/138 桌面 UA）扫码登的，
      // 而 BrowserWindow 默认 UA 带 "Electron/x.x.x" 字样。如果发布时不改 UA，
      // 小红书 / 抖音 / 快手等站点的风控会把"同账号、不同 UA"判定为换设备，
      // cookie 即使共享也会被要求重新登录，表现就是用户看到的"重复登录"。
      // 之前的代码只在 pt 含"视频"时才 setUserAgent，是历史遗留，现在统一对齐。
      if (data.useragent) {
        if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
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
        await page.goto(data.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      } else {
        await win.loadURL(data.url);
      }

      win.on("closed", () => {
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
        const retry = Boolean(win._mmRetryAfterClose) && currentAttempt < maxRetries;
        if (retry) {
          setTimeout(() => {
            createWindowAndAttempt().catch(err => {
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
              console.warn(`未找到平台处理器: ${data.pt}，跳过重试直接结束任务`);
              safeReply("puppeteerFile-done", {
                ...data,
                status: false,
                message: `未找到平台处理器: ${data.pt}`,
              });
              if (win && !win.isDestroyed()) closePublishWinProgrammatically(win);
              finishOnce();
              return;
            }
            await action(page, data, win, createAttemptTransport(), finishOnce);
          } else {
            console.log(`尝试${currentAttempt} URL不匹配: ${currentUrl}，关闭窗口并重新尝试`);
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
            if (win && !win.isDestroyed()) closePublishWinProgrammatically(win);
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
      console.log(`尝试${currentAttempt}发生错误:`, error);
      if (win && !win.isDestroyed()) {
        win._mmRetryAfterClose = true;
        closePublishWinProgrammatically(win);
      }
      if (browser) browser.disconnect();
      if (finished) return;
      setTimeout(() => {
        createWindowAndAttempt().catch(err => {
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
    runtimeTask.setCancelHandler(reason => {
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
    createWindowAndAttempt().catch(err => {
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
