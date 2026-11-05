import { BrowserWindow, Menu, shell, app } from "electron";
import fs from "fs";
import path from "path";
import { platform } from "os";
import getCookie from "./getCookie";
import { openDevTools, IsUseSysTitle, UseStartupChart } from "../config/const";
import setIpc from "./ipcMain";
import { winURL, loadingURL } from "../config/StaticPath";
import baseMenu from "../config/menu";
import { loadUrlWithGuard } from "./windowNavigationGuard";


let loadWindow = null;
let mainWindow = null;
// 版本以package.json为基准。
const version = require("../../../package.json").version;

/**
 * 导航守卫的策略入参（见 shared/navigationGuard.js）：
 *  - file: 只允许应用自己的页面 → appRoot 取应用根目录（打包后是 app.asar 路径）；
 *  - http(s) 只允许 dev 本地开发服务器 → 仅 development 模式放开 winURL 的 origin，
 *    打包后不保留「任意 localhost 端口都可信」的口子。
 */
function navigationPolicy() {
  return {
    appRoot: app.getAppPath(),
    devOrigins: process.env.NODE_ENV === "development" ? [winURL] : [],
  };
}

function resolveWindowsWindowIcon() {
  if (!platform().includes("win32")) return undefined;
  const nextToExe = path.join(
    path.dirname(process.execPath),
    "matrixmedia.ico"
  );
  if (fs.existsSync(nextToExe)) return nextToExe;
  const inResources = path.join(process.resourcesPath, "matrixmedia.ico");
  if (fs.existsSync(inResources)) return inResources;
  const dev = path.join(__dirname, "../../lib/icons/icon.ico");
  if (fs.existsSync(dev)) return dev;
  return undefined;
}

function createMainWindow(fn) {
  // IPC 注册延迟到窗口创建时：模块顶层调用会触发 electronApp.getPath("userData")，
  // 此时 app.name 尚未被改为 matrix-video，userData 被缓存到 Electron/ 目录，
  // 导致 session.fromPartition 读不到真实 cookie，CLI 登录态检测全部失效。
  setIpc.Mainfunc(IsUseSysTitle);

  const menuconfig = Array.isArray(baseMenu) ? [...baseMenu] : [];
  /**
   * Initial window options
   */
  mainWindow = new BrowserWindow({
    height: 900,
    useContentSize: true,
    width: 1500,
    minWidth: 1000,
    show: false,
    frame: IsUseSysTitle,
    icon: resolveWindowsWindowIcon(),
    titleBarStyle: platform().includes("win32") ? "default" : "hidden",
    webPreferences: {
      contextIsolation: false, //
      nodeIntegration: true,
      allowRunningInsecureContent: true,
      // 项目已全面用独立 BrowserWindow 替代 <webview>（避免反爬指纹）。
      // 主窗口不再需要启用 webview 标签，避免回头有人误用又踩坑。
      webviewTag: false,
      webSecurity: false, // false是允许跨域
      // 如果是开发模式可以使用devTools
      devTools: true,
    },
  });
  fn(mainWindow);
  // 获取登录状态
  getCookie();
  // 这里设置只有开发环境才注入显示开发者模式
  if (process.env.NODE_ENV === "development" || openDevTools) {
    menuconfig.push({
      label: "开发者设置",
      submenu: [
        {
          label: "切换到开发者模式",
          accelerator: "CmdOrCtrl+I",
          role: "toggledevtools",
        },
      ],
    });
  }
  // 注册 F12 快捷键
  menuconfig.push({
    label: "开发者设置",
    submenu: [
      {
        label: "切换到开发者模式",
        accelerator: "F12",
        role: "toggledevtools",
      },
    ],
  });
  // 注册f11 全屏
  menuconfig.push({
    label: "全屏",
    submenu: [
      {
        label: "切换到全屏模式",
        accelerator: "F11",
        role: "toggleFullScreen",
      },
    ],
  });

  // 载入菜单
  const menu = Menu.buildFromTemplate(menuconfig);
  Menu.setApplicationMenu(menu);
  // 先装导航守卫再载入页面：主窗口带 nodeIntegration，任何远端导航都会
  // 把 Node 能力交给远端脚本（详见 services/windowNavigationGuard.js）
  loadUrlWithGuard(mainWindow, winURL, {
    label: "主窗口",
    openExternal: (url) => shell.openExternal(url),
    ...navigationPolicy(),
  });

  mainWindow.webContents.once("dom-ready", () => {
    mainWindow.show();

    mainWindow.webContents.send("version", version);
    if (process.env.NODE_ENV === "development" || openDevTools)
      mainWindow.webContents.openDevTools(true);
    if (UseStartupChart) loadWindow.destroy();
  });
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("w-max", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("w-max", false);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function loadingWindow(fn) {
  loadWindow = new BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    transparent: true, // 使窗口透明
    skipTaskbar: true,
    resizable: false,
    webPreferences: { experimentalFeatures: true, webSecurity: false },
  });

  loadUrlWithGuard(loadWindow, loadingURL, {
    label: "加载窗",
    openExternal: (url) => shell.openExternal(url),
    ...navigationPolicy(),
  });

  loadWindow.show();

  setTimeout(() => {
    createMainWindow(fn);
  }, 2000);

  loadWindow.on("closed", () => {
    loadWindow = null;
  });
}

function initWindow(fn) {
  if (UseStartupChart) {
    return loadingWindow(fn);
  } else {
    return createMainWindow(fn);
  }
}
export default initWindow;
