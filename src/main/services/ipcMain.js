import { ipcMain, dialog, BrowserWindow, app } from "electron";
import Server from "../server/index";

import { winURL } from "../config/StaticPath";
import downloadFile from "./downloadFile";
import { updater } from "./HotUpdater";
import puppeteerFile from "./puppeteerFile";

const https = require("https");
const version = require("../../../package.json").version;
console.log(version, "-------");
import fs from "fs";
// 获取托管在 gitee 的 pubtw 仓库 Releases。
// 公开仓库的 Release 列表可匿名调用 API，无需 access_token，避免把可写 token 打进开源客户端。
function getAllReleases() {
  return new Promise(resolve => {
    const options = {
      hostname: "gitee.com",
      path: `/api/v5/repos/gzlingyi_0/pubtw/releases?page=1&per_page=20&direction=desc`,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "matrix-video",
      },
    };

    const req = https.request(options, res => {
      let data = "";

      res.on("data", chunk => {
        data += chunk;
      });

      res.on("end", () => {
        if (data.indexOf("{") != -1) {
          resolve(JSON.parse(data));
        } else {
          resolve([]);
        }
      });
    });

    req.on("error", error => {
      console.error("Error fetching releases:", error);
    });

    req.end();
  });
}

export default {
  async Mainfunc(IsUseSysTitle) {
    // Always register the check-for-updates handler first
    ipcMain.handle("check-for-updates", async event => {
      let datas = await getAllReleases();
      if (datas.length > 0) {
        let lastData = datas[0];
        let lastVersion = parseInt(lastData.name.replace("v", "").split(".").join(""));
        let currentVersion = parseInt(version.split(".").join(""));
        const assets = lastData.assets || [];
        let installer = null;
        if (process.platform === "darwin") {
          installer =
            assets.find(a => /\.dmg$/i.test(a.name)) ||
            assets.find(a => /\.pkg$/i.test(a.name)) ||
            assets.find(a => /\.zip$/i.test(a.name));
        } else if (process.platform === "win32") {
          installer = assets.find(a => /\.exe$/i.test(a.name));
        }
        const downloadURL = installer && installer.browser_download_url;
        if (downloadURL) {
          console.log(lastVersion, currentVersion, downloadURL, "66666666666666666");
          if (lastVersion > currentVersion) {
            downloadFile.download(BrowserWindow.fromWebContents(event.sender), downloadURL);
          }
        }
      }
      return false;
    });
    // puppeteerFile 上传文件发布，获取登录状态
    puppeteerFile();

    // 获取文件下面的文件
    ipcMain.handle("getFiles", (event, args) => {
      if (!fs.existsSync(args)) {
        return [];
      }
      console.log(args, "getFiles");
      return fs.readdirSync(args);
    });
    ipcMain.handle("IsUseSysTitle", async () => {
      return IsUseSysTitle;
    });
    ipcMain.handle("windows-mini", (event, args) => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    });
    ipcMain.handle("window-max", async (event, args) => {
      if (BrowserWindow.fromWebContents(event.sender)?.isMaximized()) {
        BrowserWindow.fromWebContents(event.sender)?.unmaximize();
        return { status: false };
      } else {
        BrowserWindow.fromWebContents(event.sender)?.maximize();
        return { status: true };
      }
    });

    ipcMain.handle("window-close", (event, args) => {
      BrowserWindow.fromWebContents(event.sender)?.close();
    });
    ipcMain.handle("start-download", (event, msg) => {
      downloadFile.download(BrowserWindow.fromWebContents(event.sender), msg.downloadUrL);
    });

    // 热更新
    ipcMain.handle("hot-update", (event, arg) => {
      updater(BrowserWindow.fromWebContents(event.sender));
    });
    ipcMain.handle("reset-app", () => {
      app.relaunch();
      app.exit();
    });
    ipcMain.handle("open-messagebox", async (event, arg) => {
      const res = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
        type: arg.type || "info",
        title: arg.title || "",
        buttons: arg.buttons || [],
        message: arg.message || "",
        noLink: arg.noLink || true,
      });
      return res;
    });
    ipcMain.handle("open-errorbox", (event, arg) => {
      dialog.showErrorBox(arg.title, arg.message);
    });

    // 选择目录的函数
    ipcMain.handle("dialog:openDirectory", async event => {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        properties: ["openDirectory"], // 选择目录
      });
      return result.filePaths[0]; // 返回选中的目录路径
    });

    ipcMain.handle("dialog:openVideoFile", async event => {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        properties: ["openFile"],
        filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] }],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return undefined;
      }
      return result.filePaths[0];
    });

    ipcMain.handle("statr-server", async () => {
      try {
        const serveStatus = await Server.StatrServer();
        return serveStatus;
      } catch (error) {
        dialog.showErrorBox("错误", error);
      }
    });
    ipcMain.handle("stop-server", async (event, arg) => {
      try {
        const serveStatus = await Server.StopServer();
        return serveStatus;
      } catch (error) {
        // dialog.showErrorBox("错误", error);
      }
    });
    let childWin = null;
    let cidArray = [];
    ipcMain.handle("open-win", (event, arg) => {
      let cidJson = { id: null, url: "" };
      let data = cidArray.filter(currentValue => {
        if (currentValue.url === arg.url) {
          return currentValue;
        }
      });
      if (data.length > 0) {
        //获取当前窗口
        let currentWindow = BrowserWindow.fromId(data[0].id);
        //聚焦窗口
        currentWindow.focus();
      } else {
        //获取主窗口ID
        let parentID = event.sender.id;
        //创建窗口
        childWin = new BrowserWindow({
          width: arg?.width || 842,
          height: arg?.height || 595,
          //width 和 height 将设置为 web 页面的尺寸(译注: 不包含边框), 这意味着窗口的实际尺寸将包括窗口边框的大小，稍微会大一点。
          useContentSize: true,
          //自动隐藏菜单栏，除非按了Alt键。
          autoHideMenuBar: true,
          //窗口大小是否可调整
          resizable: arg?.resizable ?? false,
          //窗口的最小高度
          minWidth: arg?.minWidth || 842,
          show: arg?.show ?? false,
          //窗口透明度
          opacity: arg?.opacity || 1.0,
          //当前窗口的父窗口ID
          parent: parentID,
          frame: IsUseSysTitle,
          webPreferences: {
            nodeIntegration: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
            //使用webview标签 必须开启
            webviewTag: arg?.webview ?? false,
            // 如果是开发模式可以使用devTools
            devTools: process.env.NODE_ENV === "development",
            // 在macos中启用橡皮动画
            scrollBounce: process.platform === "darwin",
            // 临时修复打开新窗口报错
            contextIsolation: false,
          },
        });

        childWin.loadURL(winURL + `#${arg.url}`);
        cidJson.id = childWin?.id;
        cidJson.url = arg.url;
        cidArray.push(cidJson);
        childWin.webContents.once("dom-ready", () => {
          childWin.show();
          childWin.webContents.send("send-data", arg.sendData);
          if (arg.IsPay) {
            // 检查支付时候自动关闭小窗口
            const testUrl = setInterval(() => {
              const Url = childWin.webContents.getURL();
              if (Url.includes(arg.PayUrl)) {
                childWin.close();
              }
            }, 1200);
            childWin.on("close", () => {
              clearInterval(testUrl);
            });
          }
        });
        childWin.on("closed", () => {
          childWin = null;
          let index = cidArray.indexOf(cidJson);
          if (index > -1) {
            cidArray.splice(index, 1);
          }
        });
      }
      childWin.on("maximize", () => {
        if (cidJson.id != null) {
          BrowserWindow.fromId(cidJson.id).webContents.send("w-max", true);
        }
      });
      childWin.on("unmaximize", () => {
        if (cidJson.id != null) {
          BrowserWindow.fromId(cidJson.id).webContents.send("w-max", false);
        }
      });
    });
  },
};
