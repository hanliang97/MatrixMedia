import { BrowserWindow, Menu, app as electronApp } from "electron";
import { platform } from "os";
import getCookie from "./getCookie";
import { openDevTools, IsUseSysTitle, UseStartupChart } from "../config/const";
import setIpc from "./ipcMain";
import { winURL, loadingURL } from "../config/StaticPath";
import baseMenu from "../config/menu";

let loadWindow = null;
let mainWindow = null;
setIpc.Mainfunc(IsUseSysTitle);
// 版本以package.json为基准。
const version = require("../../../package.json").version;

function createMainWindow(fn) {
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
    titleBarStyle: platform().includes("win32") ? "default" : "hidden",
    webPreferences: {
      contextIsolation: false, //
      nodeIntegration: true,
      allowRunningInsecureContent: true,
      webviewTag: true, // 启用webview标签
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
  mainWindow.loadURL(winURL);

  mainWindow.webContents.once("dom-ready", () => {
    mainWindow.show();

    mainWindow.webContents.send("version", version);
    if (process.env.NODE_ENV === "development" || openDevTools) mainWindow.webContents.openDevTools(true);
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
    electronApp.quit();
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

  loadWindow.loadURL(loadingURL);

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
