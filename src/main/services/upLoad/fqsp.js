import maybeClosePublishWindow from "./closeWindow.js";

/**
 * 番茄视频自动发布（占位）
 * 配置见 configUrl / ptConfig；发布页 DOM 自动化待后续补齐。
 */
export default async function (page, data, window, event) {
  console.log("[fqsp] 番茄视频自动发布尚未实现，data:", data?.bt || data?.title);
  maybeClosePublishWindow(data, window);
  throw new Error("番茄视频自动发布流程待完善，请稍后在发布页手动操作或等待后续版本");
}
