"use strict";

// 应用更新检查 / 下载的公共实现，供两处调用：
//   - 渲染进程走 ipcMain.js 里的 "check-for-updates" / "start-update-download" IPC
//   - 托盘菜单（index.js）「检查更新」项直接调用
// 共用同一份 Gitee Release 缓存与安装包选择逻辑，避免两处逻辑漂移。

const https = require("https");
const version = require("../../../package.json").version;
import { app as electronApp } from "electron";
import downloadFile from "./downloadFile";
import { pickReleaseInstaller } from "./pickReleaseInstaller";

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
        if (res.statusCode !== 200) {
          console.warn(`Gitee API ${path} 返回 ${res.statusCode}，跳过解析`);
          resolve(fallback);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          console.warn("Gitee 响应非 JSON，跳过:", data.slice(0, 80));
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
 * 检查是否有新版本。只做检测、返回版本信息，不自动开始下载；
 * 是否下载由调用方（用户确认后）通过 downloadLatestUpdate 触发。
 */
async function checkForUpdate() {
  const lastData = await getLatestRelease();
  if (!lastData) {
    return { hasUpdate: false };
  }
  const remoteVer =
    (lastData.tag_name && String(lastData.tag_name).replace(/^v/i, "")) ||
    (lastData.name && String(lastData.name).replace(/^v/i, ""));
  const cmp = compareSemver(remoteVer, version);
  const assets = lastData.assets || [];

  const installer = pickReleaseInstaller(assets, {
    translated: Boolean(electronApp.runningUnderARM64Translation),
  });
  const downloadURL = installer && installer.browser_download_url;

  return {
    hasUpdate: Boolean(downloadURL && cmp > 0),
    currentVersion: version,
    latestVersion: remoteVer || "",
    releaseName: lastData.name || lastData.tag_name || "",
    releaseBody: lastData.body || "",
  };
}

/**
 * 下载最新版安装包。下载地址不信任调用方传参，
 * 由主进程重新解析一次 Release（1 小时缓存），避免被篡改。
 * 进度通过窗口 webContents 的 download-progress / download-done 等事件推送。
 */
async function downloadLatestUpdate(win) {
  try {
    const lastData = await getLatestRelease();
    if (!lastData) {
      return { ok: false, message: "未获取到版本信息，请检查网络" };
    }
    const installer = pickReleaseInstaller(lastData.assets || [], {
      translated: Boolean(electronApp.runningUnderARM64Translation),
    });
    const downloadURL = installer && installer.browser_download_url;
    if (!downloadURL) {
      return { ok: false, message: "未找到适合当前平台的安装包" };
    }
    if (!win || win.isDestroyed()) {
      return { ok: false, message: "主窗口已关闭，无法下载" };
    }
    downloadFile.download(win, downloadURL);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e && e.message) || "启动下载失败" };
  }
}

export {
  getLatestRelease,
  compareSemver,
  checkForUpdate,
  downloadLatestUpdate,
  version,
};
export default { getLatestRelease, compareSemver, checkForUpdate, downloadLatestUpdate, version };
