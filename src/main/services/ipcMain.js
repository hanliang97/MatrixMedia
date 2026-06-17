import {
  ipcMain,
  dialog,
  BrowserWindow,
  app as electronApp,
  shell,
} from "electron";
import { spawn } from "child_process";
import Server from "../server/index";

import { winURL } from "../config/StaticPath";
import downloadFile from "./downloadFile";
import { registerPuppeteerIpc } from "./puppeteerFile";
import { registerScheduledPublishIpc } from "./scheduledPublish";
import { createLaunchInstallerHandler } from "./launchInstaller";
import { applyAccountProxyForTask } from "./proxyConfig";

const https = require("https");
const version = require("../../../package.json").version;
console.log(version, "-------");
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
// 获取托管在 Gitee 的 pubtw 仓库 Release 信息。
// 公开仓库可匿名调用 API，无需 access_token，避免把可写 token 打进开源客户端。
function requestGiteeJson(path, fallback) {
  return new Promise((resolve) => {
    const options = {
      hostname: "gitee.com",
      path,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "matrix-video",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          console.error("Error parsing Gitee release:", error);
          resolve(fallback);
        }
      });
    });

    req.on("error", (error) => {
      console.error("Error fetching releases:", error);
      resolve(fallback);
    });

    req.end();
  });
}

// Cache Gitee release result for 1 hour to avoid rate-limit (403) on repeated calls
let _releaseCache = null;
let _releaseCacheAt = 0;
const RELEASE_CACHE_TTL_MS = 60 * 60 * 1000;

async function getLatestRelease() {
  if (
    _releaseCache !== null &&
    Date.now() - _releaseCacheAt < RELEASE_CACHE_TTL_MS
  ) {
    return _releaseCache;
  }
  const latest = await requestGiteeJson(
    "/api/v5/repos/gzlingyi_0/pubtw/releases/latest",
    null
  );
  if (latest && latest.id) {
    _releaseCache = latest;
    _releaseCacheAt = Date.now();
    return latest;
  }

  const list = await requestGiteeJson(
    "/api/v5/repos/gzlingyi_0/pubtw/releases?page=1&per_page=20&direction=desc",
    []
  );
  const result = Array.isArray(list) && list.length > 0 ? list[0] : null;
  if (result) {
    _releaseCache = result;
    _releaseCacheAt = Date.now();
  }
  return result;
}

/** 解析 v0.9.7 / 0.9.7 为可比较的数字（按段比较，避免 0.9.10 与 parseInt 拼接错误） */
function compareSemver(remoteRaw, localRaw) {
  const norm = (s) =>
    String(s || "")
      .replace(/^v/i, "")
      .trim()
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
  const a = norm(remoteRaw);
  const b = norm(localRaw);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const da = a[i] || 0;
    const db = b[i] || 0;
    if (da !== db) {
      return da > db ? 1 : -1;
    }
  }
  return 0;
}

/**
 * 与 CI 产物命名规则一致（v0.6.1 起 artifactName 统一为 MatrixMedia-${version}-${os}-${arch}.${ext}）：
 *   Win x64:      MatrixMedia-0.6.1-win-x64.exe
 *   Mac Intel:    MatrixMedia-0.6.1-mac-x64.dmg
 *   Mac Silicon:  MatrixMedia-0.6.1-mac-arm64.dmg
 *   Linux x64:    MatrixMedia-0.6.1-linux-x64.AppImage（不发 Gitee）
 *
 * 兼容历史命名（旧 Release 包仍可正常升级）：
 *   旧 Win: Setup-0.6.0-win-x64.exe
 *   旧 Mac: 矩媒-0.6.0-arm64.dmg / 矩媒-0.6.0.dmg
 */
function pickReleaseInstaller(assets) {
  const list = assets || [];
  const platform = process.platform;
  if (platform === "win32") {
    return (
      list.find((a) => /-win-x64\.exe$/i.test(a.name)) || // 新命名 + 旧 Setup-*-win-x64.exe 都能命中
      list.find((a) => /\.exe$/i.test(a.name))
    );
  }
  if (platform === "darwin") {
    const dmgs = list.filter((a) => /\.dmg$/i.test(a.name));
    const isAppleSilicon = process.arch === "arm64";
    const armDmg = dmgs.find((a) => /-arm64\.dmg$/i.test(a.name));
    const x64Dmg = dmgs.find((a) => /-(mac-)?x64\.dmg$/i.test(a.name));
    const universalDmg = dmgs.find((a) => /-universal\.dmg$/i.test(a.name));
    // 旧版裸命名(如 矩媒-0.6.0.dmg)做最后兜底
    const plainDmg = dmgs.find(
      (a) =>
        !/-arm64\.dmg$/i.test(a.name) &&
        !/-(mac-)?x64\.dmg$/i.test(a.name) &&
        !/-universal\.dmg$/i.test(a.name)
    );

    if (isAppleSilicon) {
      return armDmg || universalDmg || plainDmg || null;
    }
    return x64Dmg || universalDmg || plainDmg || null;
  }
  return null;
}

export default {
  async Mainfunc(IsUseSysTitle) {
    // Always register the check-for-updates handler first
    ipcMain.handle("check-for-updates", async (event) => {
      const lastData = await getLatestRelease();
      if (!lastData) {
        return { hasUpdate: false };
      }
      const remoteVer =
        (lastData.tag_name && String(lastData.tag_name).replace(/^v/i, "")) ||
        (lastData.name && String(lastData.name).replace(/^v/i, ""));
      console.log(lastData, remoteVer, "remoteVer", version);
      const cmp = compareSemver(remoteVer, version);
      const assets = lastData.assets || [];

      const installer = pickReleaseInstaller(assets);
      const downloadURL = installer && installer.browser_download_url;
      console.log(downloadURL, "downloadURL", assets);
      console.log(cmp, "cmp");
      if (downloadURL && cmp > 0) {
        downloadFile.download(
          BrowserWindow.fromWebContents(event.sender),
          downloadURL
        );
      }
      return {
        hasUpdate: Boolean(downloadURL && cmp > 0),
      };
    });

    // 先启动安装包再退出应用，避免安装器处理正在运行的主程序时失败。
    ipcMain.handle(
      "launch-installer",
      createLaunchInstallerHandler({
        platform: process.platform,
        spawn,
        shell,
        electronApp,
      })
    );

    // puppeteerFile 上传文件发布，获取登录状态
    registerPuppeteerIpc();
    registerScheduledPublishIpc();

    // 通用的渲染进程 → 主进程日志透传通道，方便把 webview / Vue 里
    // 不开 DevTools 就看不到的输出，直接打到「主程序日志」那个终端面板。
    // 用法：ipcRenderer.send('mm-debug-log', { tag: 'xxx', payload: any })
    ipcMain.on("mm-debug-log", (_event, args) => {
      try {
        const tag = (args && args.tag) || "debug";
        const payload =
          args && Object.prototype.hasOwnProperty.call(args, "payload")
            ? args.payload
            : args;
        console.log(`[mm-debug-log][${tag}]`, payload);
      } catch (e) {
        console.log("[mm-debug-log] 打印失败:", e && e.message);
      }
    });

    // 账号登录用的独立 BrowserWindow：替代 <webview>，避免小红书等站点
    // 通过 GuestView 指纹 (websectiga / sec_poison_id / window.parent 等) 把会话标红。
    // partition 与视频管理的发布窗口完全一致 (persist:xxx<平台>)，cookie/localStorage
    // 在同一份 Electron session 里共享 —— 在这里扫码登录后，发布流程能直接复用。
    //
    // 互斥策略：同一时间只允许有一个'账号登录窗'。每次调用都会关掉其它
    // partition 的旧登录窗，避免用户切账号时桌面上堆一排登录窗口。
    ipcMain.handle("open-account-login-window", async (_event, args) => {
      const partition = args && args.partition;
      const url = args && args.url;
      const useragent = args && args.useragent;
      const title = args && args.title;
      if (!partition || !url) {
        return { ok: false, message: "partition/url 必填" };
      }

      try {
        await applyAccountProxyForTask({
          partition,
          phone: args && args.phone,
          pt: args && args.pt,
        });
      } catch (proxyErr) {
        console.warn(
          "[open-account-login-window] 应用代理失败:",
          proxyErr && proxyErr.message
        );
        return {
          ok: false,
          message: (proxyErr && proxyErr.message) || "代理配置错误",
        };
      }

      // 先扫一遍现有窗口：
      //   - 同 partition：标记为'已存在'，等会儿 focus 复用
      //   - 不同 partition 但属于'账号登录窗'：直接关掉
      let existingWin = null;
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w || w.isDestroyed()) continue;
        if (!w._mmAccountLoginPartition) continue; // 不是账号登录窗，不动
        if (w._mmAccountLoginPartition === partition) {
          existingWin = w;
        } else {
          try {
            w.close();
          } catch (_) {
            /* ignore */
          }
        }
      }

      if (existingWin) {
        try {
          if (existingWin.isMinimized()) existingWin.restore();
          existingWin.focus();
        } catch (_) {
          /* ignore */
        }
        return { ok: true, reused: true };
      }

      const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: `${title || "账号登录"} ${partition}`,
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          webviewTag: false,
          devTools: true,
        },
      });
      win._mmAccountLoginPartition = partition;

      // 跟视频管理的发布窗口保持一致：强制设置 UA 为 ptConfig[平台].useragent，
      // 不要让站点看到 Electron/x.x.x 字样；扫码登录时种下的 cookie 自然就是
      // 跟发布时同一份 UA 指纹下的。
      if (useragent) {
        try {
          win.webContents.setUserAgent(useragent);
        } catch (_) {
          /* ignore */
        }
      }

      // 弹窗页打不开（站点的二维码扫码经常会弹新页），统一拒绝 window.open，
      // 让站点退回到内嵌扫码 / 当前页跳转，避免漏跑事件监听。
      try {
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      } catch (_) {
        /* ignore */
      }

      try {
        await win.loadURL(url);
      } catch (e) {
        console.warn(
          "[open-account-login-window] loadURL 失败:",
          e && e.message
        );
      }
      return { ok: true };
    });

    // 通用的弹独立 BrowserWindow 加载任意 URL（不绑定 partition），用于
    // 反馈问卷这种"不需要登录态共享"的场景，统一替代 <webview>。
    ipcMain.handle("open-external-window", async (_event, args) => {
      const url = args && args.url;
      if (!url) return { ok: false, message: "url 必填" };
      const win = new BrowserWindow({
        width: (args && args.width) || 1000,
        height: (args && args.height) || 720,
        title: (args && args.title) || "",
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webviewTag: false,
          devTools: true,
        },
      });
      try {
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      } catch (_) {
        /* ignore */
      }
      try {
        await win.loadURL(url);
      } catch (e) {
        console.warn("[open-external-window] loadURL 失败:", e && e.message);
      }
      return { ok: true };
    });

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
      downloadFile.download(
        BrowserWindow.fromWebContents(event.sender),
        msg.downloadUrL
      );
    });

    ipcMain.handle("reset-app", () => {
      electronApp.relaunch();
      electronApp.exit();
    });
    ipcMain.handle("open-messagebox", async (event, arg) => {
      const res = await dialog.showMessageBox(
        BrowserWindow.fromWebContents(event.sender),
        {
          type: arg.type || "info",
          title: arg.title || "",
          buttons: arg.buttons || [],
          message: arg.message || "",
          noLink: arg.noLink || true,
        }
      );
      return res;
    });
    ipcMain.handle("open-errorbox", (event, arg) => {
      dialog.showErrorBox(arg.title, arg.message);
    });

    // 选择目录的函数
    ipcMain.handle("dialog:openDirectory", async (event) => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ["openDirectory"], // 选择目录
        }
      );
      return result.filePaths[0]; // 返回选中的目录路径
    });

    ipcMain.handle("dialog:openVideoFile", async (event) => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ["openFile"],
          filters: [
            {
              name: "Video",
              extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"],
            },
          ],
        }
      );
      if (
        result.canceled ||
        !result.filePaths ||
        result.filePaths.length === 0
      ) {
        return undefined;
      }
      return result.filePaths[0];
    });

    ipcMain.handle("dialog:openArticleFile", async (event) => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ["openFile"],
          filters: [
            {
              name: "Article",
              extensions: ["md", "txt"],
            },
          ],
        }
      );
      if (
        result.canceled ||
        !result.filePaths ||
        result.filePaths.length === 0
      ) {
        return undefined;
      }
      return result.filePaths[0];
    });

    ipcMain.handle("dialog:openImageFile", async (event) => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ["openFile"],
          filters: [
            {
              name: "Image",
              extensions: ["jpg", "jpeg", "png", "webp"],
            },
          ],
        }
      );
      if (
        result.canceled ||
        !result.filePaths ||
        result.filePaths.length === 0
      ) {
        return undefined;
      }
      return result.filePaths[0];
    });

    ipcMain.handle("dialog:openBatchDir", async (event) => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        { properties: ["openDirectory"] }
      );
      if (result.canceled || !result.filePaths || result.filePaths.length === 0)
        return null;
      return result.filePaths[0];
    });

    ipcMain.handle("dialog:openBatchXlsx", async (event) => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ["openFile"],
          filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
        }
      );
      if (result.canceled || !result.filePaths || result.filePaths.length === 0)
        return null;
      const filePath = result.filePaths[0];
      try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
        // 清洗 xlsx 单元格：去 BOM / 零宽 / NBSP / 换行 / 前后空白。
        // trim() 处理不了 ﻿ / ​ /  ，这些是从网页复制单元格最常踩的坑。
        const cleanCell = (v) =>
          String(v || "")
            .replace(/[﻿​‌‍ ]/g, "")
            .replace(/[\r\n\t]/g, "")
            .trim();
        // Normalize: support column headers "文件名"/"fileName", "标题"/"title", "标签"/"tags"
        // 列头本身也可能带不可见字符，做一份归一化映射。
        const normalizedRows = rows
          .map((row) => {
            const map = {};
            Object.keys(row).forEach((k) => {
              const key = cleanCell(k).toLowerCase();
              map[key] = row[k];
            });
            return {
              fileName: cleanCell(
                map["文件名"] != null
                  ? map["文件名"]
                  : map["filename"] != null
                  ? map["filename"]
                  : map["file"] || ""
              ),
              title: cleanCell(
                map["标题"] != null ? map["标题"] : map["title"] || ""
              ),
              tags: cleanCell(
                map["标签"] != null ? map["标签"] : map["tags"] || ""
              ),
            };
          })
          .filter((r) => r.fileName);
        return normalizedRows;
      } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
      }
    });

    // 校验 + 解析批量发布的真实文件路径：
    // - 拼 dirPath + fileName
    // - 如果 fileName 没带后缀（或后缀对不上磁盘大小写），自动在目录里找匹配
    // - 返回每条 { fileName, resolvedPath, exists, matchedFileName }
    ipcMain.handle("resolveBatchFiles", async (event, payload) => {
      try {
        const dirPath = payload && payload.dirPath;
        const fileNames = (payload && payload.fileNames) || [];
        if (!dirPath) return { error: "缺少目录路径" };
        if (!fs.existsSync(dirPath)) return { error: "目录不存在: " + dirPath };
        const dirEntries = fs.readdirSync(dirPath);
        // 建立 normalize 后的索引：忽略大小写 + 去不可见字符 -> 实际文件名
        const norm = (s) =>
          String(s || "")
            .replace(/[﻿​‌‍ ]/g, "")
            .replace(/[\r\n\t]/g, "")
            .trim()
            .toLowerCase();
        const indexByName = new Map(); // 全名（含扩展名）
        const indexByStem = new Map(); // 仅文件名主干（不含扩展名）
        dirEntries.forEach((entry) => {
          indexByName.set(norm(entry), entry);
          const stem = entry.replace(/\.[^/.]+$/, "");
          if (!indexByStem.has(norm(stem))) {
            indexByStem.set(norm(stem), entry);
          }
        });
        const results = fileNames.map((rawName) => {
          const fileName = norm(rawName);
          let matched = null;
          if (indexByName.has(fileName)) {
            matched = indexByName.get(fileName);
          } else if (indexByStem.has(fileName)) {
            // 用户在 xlsx 里只写了文件名主干，自动补磁盘上的真实后缀
            matched = indexByStem.get(fileName);
          } else {
            // 退一步：xlsx 里写了 stem.mp4 但磁盘是 stem.MP4 / stem.mov 之类
            const stem = norm(String(rawName).replace(/\.[^/.]+$/, ""));
            if (indexByStem.has(stem)) {
              matched = indexByStem.get(stem);
            }
          }
          if (matched) {
            return {
              fileName: rawName,
              matchedFileName: matched,
              resolvedPath: path.join(dirPath, matched),
              exists: true,
            };
          }
          return {
            fileName: rawName,
            matchedFileName: "",
            resolvedPath: path.join(dirPath, rawName),
            exists: false,
          };
        });
        return { ok: true, results };
      } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
      }
    });

    ipcMain.handle("dialog:downloadBatchTemplate", async () => {
      try {
        const workbook = xlsx.utils.book_new();
        const wsData = [
          ["文件名", "标题", "标签"],
          ["第01集.mp4", "精彩短剧第一集", "短剧,影视,追剧"],
          ["第02集.mp4", "精彩短剧第二集", "短剧,影视,追剧"],
        ];
        const ws = xlsx.utils.aoa_to_sheet(wsData);
        xlsx.utils.book_append_sheet(workbook, ws, "Sheet1");
        const downloadsDir = electronApp.getPath("downloads");
        const outPath = path.join(downloadsDir, "batch-publish-template.xlsx");
        xlsx.writeFile(workbook, outPath);
        shell.openPath(outPath);
        return { ok: true, path: outPath };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
      }
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
      let data = cidArray.filter((currentValue) => {
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
