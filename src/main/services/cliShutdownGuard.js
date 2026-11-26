"use strict";

/**
 * CLI 发布任务协作式信号清理守卫。
 *
 * 仅在 `cli publish` / `cli publish-article` 执行期间挂载 SIGINT/SIGTERM/SIGHUP 监听，
 * 避免覆盖 `cli login`（如 sphCliLogin.js 自行监听 SIGINT/SIGTERM 恢复登录备份）的信号逻辑。
 */

const activeHooks = new Set();
let listenersInstalled = false;
let shuttingDown = false;
let exitHandler = null;
const signalHandlers = new Map();

export function setCliShutdownExitHandler(fn) {
  exitHandler = typeof fn === "function" ? fn : null;
}

function exitCodeForSignal(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  if (signal === "SIGHUP") return 129;
  return 1;
}

function runHooksOnce(reason, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const hooks = [...activeHooks];
  for (const fn of hooks) {
    try {
      fn(reason, signal);
    } catch (err) {
      console.error(
        "[cli-shutdown] 退出清理钩子执行失败:",
        err && err.message ? err.message : err
      );
    }
  }
  if (signal) {
    const code = exitCodeForSignal(signal);
    if (exitHandler) {
      exitHandler(code);
      return;
    }
    process.exit(code);
  }
}

function ensureListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      runHooksOnce(`进程收到终止信号（${sig}），发布已中断`, sig);
    };
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }
}

function removeListenersIfIdle() {
  if (!listenersInstalled || activeHooks.size > 0) return;
  for (const [sig, handler] of signalHandlers.entries()) {
    process.removeListener(sig, handler);
  }
  signalHandlers.clear();
  listenersInstalled = false;
}

export function registerCliPublishShutdown(fn) {
  if (typeof fn !== "function") return () => {};
  shuttingDown = false;
  activeHooks.add(fn);
  ensureListeners();
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    activeHooks.delete(fn);
    removeListenersIfIdle();
  };
}

export function triggerCliPublishShutdown(reason = "应用退出，发布已中断") {
  if (activeHooks.size === 0) return false;
  runHooksOnce(reason, null);
  return true;
}

export async function withCliPublishShutdownHook(fn, onShutdown) {
  const unregister = registerCliPublishShutdown(onShutdown);
  try {
    return await fn();
  } finally {
    unregister();
  }
}
