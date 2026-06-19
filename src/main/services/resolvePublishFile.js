"use strict";

import fs from "fs";
import path from "path";
import axios from "axios";
import { app } from "electron";

const REMOTE_FILE_RE = /^https?:\/\//i;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

export function isRemotePublishFile(file) {
  return REMOTE_FILE_RE.test(String(file || "").trim());
}

export function guessFileNameFromUrl(url) {
  try {
    const parsed = new URL(String(url).trim());
    const base = path.basename(decodeURIComponent(parsed.pathname || ""));
    if (base && base !== "/" && base !== ".") {
      return base;
    }
  } catch (_) {
    /* ignore */
  }
  return `matrixmedia-${Date.now()}.mp4`;
}

function getPublishTempDir() {
  return path.join(app.getPath("temp"), "matrixmedia-publish");
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.warn(
      "MatrixMedia: 清理临时视频失败:",
      filePath,
      e && e.message ? e.message : e
    );
  }
}

/**
 * 将发布 file 解析为本地路径；若为 http(s) URL 则下载到临时目录。
 * @param {string} file 本地路径或 http(s) URL
 * @returns {Promise<{ localPath: string, remoteUrl: string|null, cleanup: (() => void)|null }>}
 */
export async function resolvePublishFile(file) {
  const raw = String(file || "").trim();
  if (!raw) {
    throw new Error("file 不能为空");
  }

  if (!isRemotePublishFile(raw)) {
    return {
      localPath: path.resolve(raw),
      remoteUrl: null,
      cleanup: null,
    };
  }

  const tmpDir = getPublishTempDir();
  fs.mkdirSync(tmpDir, { recursive: true });

  const fileName = guessFileNameFromUrl(raw);
  const localPath = path.join(tmpDir, `${Date.now()}-${fileName}`);

  console.log("[resolvePublishFile] 开始下载远程视频:", raw);

  const response = await axios({
    method: "GET",
    url: raw,
    responseType: "stream",
    timeout: DEFAULT_DOWNLOAD_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(localPath);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", (err) => {
      safeUnlink(localPath);
      reject(err);
    });
    response.data.on("error", (err) => {
      safeUnlink(localPath);
      reject(err);
    });
  });

  const stat = fs.statSync(localPath);
  if (!stat.isFile() || stat.size <= 0) {
    safeUnlink(localPath);
    throw new Error("下载的视频文件为空");
  }

  console.log(
    "[resolvePublishFile] 下载完成:",
    localPath,
    `(${(stat.size / 1024 / 1024).toFixed(2)} MB)`
  );

  return {
    localPath,
    remoteUrl: raw,
    cleanup: () => safeUnlink(localPath),
  };
}
