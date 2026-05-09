/**
 * 程序自动关窗（发布结束、超时、重试等）前调用，跳过用户点的「关闭」二次确认。
 * @param {import("electron").BrowserWindow | null | undefined} window
 */
export function skipCloseConfirmation(window) {
  if (window && typeof window.isDestroyed === "function" && !window.isDestroyed()) {
    window._mmAllowCloseWithoutConfirm = true;
  }
}

/**
 * 发布流程结束后是否关闭 BrowserWindow。
 * closeWindowAfterPublish === false 时不关闭（本地发布勾选「不关闭」且已显示窗口时传入）。
 * 未传或为 true 时保持原行为：关闭窗口。
 */
export default function maybeClosePublishWindow(data, window) {
  if (data.closeWindowAfterPublish === false) return;
  try {
    if (window && typeof window.isDestroyed === "function" && window.isDestroyed()) return;
    skipCloseConfirmation(window);
    if (window) window.close();
  } catch (e) {
    console.error("关闭发布窗口失败", e);
  }
}
