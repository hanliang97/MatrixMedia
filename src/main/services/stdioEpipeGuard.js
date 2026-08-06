"use strict";

/**
 * 为主进程的 process.stdout / process.stderr 安装 EPIPE 守卫。
 *
 * 背景：
 *  - console.log/warn/error 最终会写到 process.stdout / process.stderr。
 *  - 当外部调用方（例如智能体 / CI 管道）提前关闭输出管道时，
 *    Node 会在流上异步 emit 'error'（code === 'EPIPE'）。
 *  - 若该 'error' 没有监听器，就会冒泡成主进程 Uncaught Exception，
 *    触发 Electron 的 "A JavaScript error occurred in the main process" 弹窗。
 *
 * 本模块仅在流的 'error' 上注册监听器吞掉 EPIPE，避免崩溃；
 * 其它错误仍保留 Node 默认行为，便于发现真实问题。
 *
 * 幂等：重复调用不会叠加监听器。
 */
function isPipeError(err) {
  if (!err) return false;
  if (err.code === "EPIPE") return true;
  if (err.code === "ERR_STREAM_DESTROYED") return true;
  return /write EPIPE/.test(String(err && (err.message || err)));
}

function attach(stream) {
  if (!stream || typeof stream.on !== "function") return;
  if (stream.__mmEpipeGuardInstalled) return;
  stream.__mmEpipeGuardInstalled = true;
  // 只吞 EPIPE；非管道错误不处理，交还给默认机制
  stream.on("error", (err) => {
    if (isPipeError(err)) return;
    // 非 EPIPE：保留后续 'error' 监听 / 默认行为，不做吞掉
  });
}

export function installStdioEpipeGuard() {
  attach(process.stdout);
  attach(process.stderr);
}

export default installStdioEpipeGuard;
