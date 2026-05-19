import { ipcRenderer } from "electron";
import ptConfig from "@/utils/configUrl";

/**
 * 统一的「打开独立 BrowserWindow 进行账号登录」入口。
 *
 * 历史背景：原来项目里用 <webview> + el-dialog 弹登录，小红书等站点会通过
 * GuestView 指纹 (websectiga / sec_poison_id / window.parent / 等)
 * 把会话标红，导致登陆后点草稿箱、点发布反复跳登录。
 *
 * 现在所有登录入口都走主进程的 `open-account-login-window` IPC，
 * 弹一个普通 BrowserWindow（partition / UA 跟 puppeteer 发布窗一致），
 * 反爬识别不到 webview 特征，登录态可以直接复用到发布流程。
 *
 * @param {Object} item    至少包含 pt + (partition 或 phone)；可选 url
 * @returns {Promise<{ok:boolean,reused?:boolean,message?:string}>}
 */
export default async function openLoginWindow(item) {
  if (!item) return { ok: false, message: "缺少 item" };
  const rawPt = item.pt || "";
  // 状态轮询里 pt 形如 "小红书状态"，配置表里只有 "小红书"，统一去掉后缀
  const pt = String(rawPt).replace("状态", "").replace("登录", "");
  const cfg = ptConfig[pt];
  if (!cfg) return { ok: false, message: "未找到平台配置: " + pt };

  const partition =
    (item.partition && String(item.partition).split("-")[0]) ||
    "persist:" + String(item.phone || "").split("-")[0] + pt;

  const url = item.url || cfg.index;
  const useragent = cfg.useragent;

  return ipcRenderer.invoke("open-account-login-window", {
    partition,
    url,
    useragent,
    title: pt,
  });
}
