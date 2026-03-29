import { ipcMain, app, BrowserWindow } from "electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import pie from "puppeteer-in-electron";
import Type from "./Type";

import StealthPlugin from "puppeteer-extra-plugin-stealth";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

// Puppeteer 任务串行队列（上传/状态/登录统一排队）
const taskQueue = [];
let taskBusy = false;

function enqueueTask(data, event) {
  taskQueue.push({ data, event });
  processNextTask();
}

function processNextTask() {
  if (taskBusy) return;
  const next = taskQueue.shift();
  if (!next) return;
  taskBusy = true;
  doUpload(next.data, next.event, () => {
    taskBusy = false;
    processNextTask();
  });
}

function upFile() {
  ipcMain.on("puppeteerFile", async (event, args) => {
    enqueueTask(args, event);
  });
}

async function doUpload(data, event, onFinish) {
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
      if (!event || !event.sender || event.sender.isDestroyed()) return false;
      event.reply(channel, payload);
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
    if (activeWin && !activeWin.isDestroyed() && data.closeWindowAfterPublish !== false) {
      try {
        activeWin.close();
      } catch (e) {
        console.error("兜底关闭窗口失败:", e);
      }
    }
    if (activeBrowser) {
      try {
        activeBrowser.disconnect();
      } catch (e) {
        console.error("兜底断开浏览器连接失败:", e);
      }
    }
    activeWin = null;
    activeBrowser = null;
  };

  const finishOnce = () => {
    if (finished) return;
    finished = true;
    cleanupTaskResources();
    if (onFinish) onFinish();
  };

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
        show:  data?.show ?? false,
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
      // 添加10分钟自动关闭窗口的定时器
      const AUTO_CLOSE_DELAY = 10 * 60 * 1000; // 10分钟
      autoCloseTimer = setTimeout(() => {
        console.log(`窗口 ${data.partition} 已自动关闭（10分钟超时）`);
        if (win && !win.isDestroyed()) {
          win.close();
        }
      }, AUTO_CLOSE_DELAY);
      // 设置UA和加载URL
      if (data.pt.indexOf("视频") !== -1) {
        await page.setUserAgent(data.useragent);
        if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.setUserAgent(data.useragent);
        }
        await page.goto(data.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      } else {
        await win.loadURL(data.url);
      }
      
      // 窗口关闭事件
      win.on("closed", () => {
        clearTimeout(autoCloseTimer); // 清除自动关闭定时器
        autoCloseTimer = null;
        if (browser) browser.disconnect();
        if (activeWin === win) activeWin = null;
        if (activeBrowser === browser) activeBrowser = null;
        if (finished) return;
        if (currentAttempt >= maxRetries) {
          safeReply("puppeteer-noLogin", data);
          safeReply("puppeteerFile-done", {
            ...data,
            status: false,
            message: "窗口已关闭，任务结束",
          });
          finishOnce();
          return;
        }
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
      });

      // 检查URL是否匹配并执行操作
      actionCheckTimer = setTimeout(async () => {
        actionCheckTimer = null;
        if (finished) return;
        try {
          if (!page || typeof page.url !== "function") {
            throw new Error("页面对象不可用");
          }
          const currentUrl = page.url();
          if (currentUrl === data.url) {
            const action = Type[data.pt];
            if (typeof action !== "function") {
              throw new Error(`未找到平台处理器: ${data.pt}`);
            }
            await action(page, data, win, event, finishOnce);
            finishOnce();
            return;
          }
          console.log(`尝试${currentAttempt} URL不匹配: ${currentUrl}，关闭窗口并重新尝试`);
          if (win && !win.isDestroyed()) win.close();
        } catch (err) {
          console.log(`尝试${currentAttempt}执行平台逻辑失败:`, err);
          if (currentAttempt >= maxRetries) {
            safeReply("puppeteerFile-done", {
              ...data,
              status: false,
              message: "执行失败",
            });
            if (win && !win.isDestroyed()) win.close();
            finishOnce();
            return;
          }
          if (win && !win.isDestroyed()) win.close();
        }
      }, 3000);
    } catch (error) {
      console.log(`尝试${currentAttempt}发生错误:`, error);
      if (win) win.close();
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
  console.log(`尝试${currentAttempt}${data.pt}开始`);
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

export default upFile;
