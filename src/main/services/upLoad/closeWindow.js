/**
 * 发布流程结束后是否关闭 BrowserWindow。
 * closeWindowAfterPublish === false 时不关闭（本地发布勾选「不关闭」且已显示窗口时传入）。
 * 未传或为 true 时保持原行为：关闭窗口。
 */
export default function maybeClosePublishWindow(data, window) {
  if (data.closeWindowAfterPublish === false) return;
  try {
    if (window && typeof window.isDestroyed === "function" && window.isDestroyed()) return;
    if (window) window.close();
  } catch (e) {
    console.error("关闭发布窗口失败", e);
  }
}
