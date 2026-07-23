"use strict";

export const DEFAULT_ELECTRON_STARTUP_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * puppeteer-in-electron 要求 initialize 在 app ready 前调用。
 * 初始化完成后再等待 app ready，确保后续 connect / BrowserWindow 稳定可用。
 */
export async function initializeElectronRuntime({
  app,
  pie,
  timeoutMs = DEFAULT_ELECTRON_STARTUP_TIMEOUT_MS,
  logger = console,
}) {
  if (!app || !pie || typeof pie.initialize !== "function") {
    throw new Error("Electron/Puppeteer 初始化参数不完整");
  }
  if (app.isReady()) {
    throw new Error("Puppeteer 初始化开始过晚：Electron app 已 ready");
  }

  logger.log("[startup] 开始初始化 puppeteer-in-electron");
  // 必须同步触发 initialize，不能先 await app.whenReady()。
  const initializePromise = pie.initialize(app);
  await withTimeout(
    initializePromise,
    timeoutMs,
    `puppeteer-in-electron 初始化超时（${timeoutMs}ms）`
  );
  logger.log(
    `[startup] puppeteer-in-electron 初始化完成，调试端口=${
      app.commandLine.getSwitchValue("remote-debugging-port") || "unknown"
    }`
  );

  await withTimeout(
    app.whenReady(),
    timeoutMs,
    `等待 Electron ready 超时（${timeoutMs}ms）`
  );
  logger.log("[startup] Electron app ready");
}
