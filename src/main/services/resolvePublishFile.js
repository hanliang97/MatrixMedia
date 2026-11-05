"use strict";

/**
 * 把发布参数里的 `file` 解析成本地路径；`http(s)://` 远程视频先下载到临时目录。
 *
 * 安全边界（见 Issue #35「安全审计 · 远程 URL 下载」）：
 *  1. 大小上限：`Content-Length` 先卡一道，流式写入再卡一道，防止一个指向
 *     超大文件的 URL 把用户磁盘写满（CLI / HTTP API 都允许传远程 URL，
 *     URL 可能来自复制粘贴或 AI Agent，不能假设它一定指向正常大小的视频）。
 *  2. 类型校验：按 `Content-Type` 拒绝 HTML / JSON / 纯文本等「其实是个错误页」
 *     的响应，避免下游上传拿到一个伪装成 .mp4 的错误页后报「上传失败」。
 *  3. 临时文件清理：下载失败（含超限、中断、类型不符）等写句柄关闭后再删，
 *     并对 Windows 的 EPERM/EBUSY 做短重试；每次下载前顺带清理超过 24h 的
 *     遗留临时文件（只动本模块命名的 `<时间戳>-*` 文件），防止 GUI 预览下载
 *     （publish:downloadRemoteFile）这类「文件留给下次发布用」的路径无限堆积。
 *
 * 不做的边界：不阻止指向内网 / 回环地址的 URL。企业内网文件服务器是正常用法，
 * 而本函数只把响应写进本地临时文件、不把结果回传给 URL 提供方，SSRF 收益有限。
 *
 * 注意：`guessFileNameFromUrl` 同时被 publishVideo 用来算任务名 / 去重键
 * （selectedFile），语义必须保持原样；落盘文件名另由 `toSafeTempFileName` 归一。
 */

import fs from "fs";
import os from "os";
import path from "path";
import { Transform } from "stream";
import axios from "axios";

const REMOTE_FILE_RE = /^https?:\/\//i;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** 远程视频默认上限 4 GiB（覆盖各平台允许的最大成片，同时挡住无限大的响应） */
export const DEFAULT_MAX_REMOTE_FILE_BYTES = 4 * 1024 * 1024 * 1024;

/** 临时目录里超过这个时长仍未被发布流程清理的文件，视为遗留，下次下载时删除 */
export const STALE_TEMP_FILE_MS = 24 * 60 * 60 * 1000;

/** 只清理本模块自己产出的文件（`<13 位以上时间戳>-<名字>`），避免误删同目录他人文件 */
const TEMP_FILE_NAME_RE = /^\d{13,}-/;

/** 落盘文件名（含扩展名）的字节上限：ext4 单名 255 字节，前面还有时间戳前缀 */
const MAX_TEMP_NAME_BYTES = 120;

/** 允许落盘的视频扩展名；URL 后缀不在其中时按视频容器归一为 .mp4 */
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".webm",
  ".m4v",
  ".flv",
  ".wmv",
]);

/**
 * 接受下载的 Content-Type：视频流本身，以及对象存储/下载站常用的
 * 「通用二进制」类型（很多 CDN 对 mp4 就回 application/octet-stream）。
 * 其余一律拒绝 —— 典型误用是把一个网页/接口地址填进 file。
 */
const VIDEO_CONTENT_TYPE_RE =
  /^(video\/|binary\/octet-stream|application\/(octet-stream|mp4|download|force-download|x-download))/i;

/** 未声明 Content-Type 时无法判定，按「不拦」处理 */
function isUnspecifiedContentType(contentType) {
  return !String(contentType || "").trim();
}

/**
 * 通用 Content-Type（octet-stream / 无声明）时，再按「视频容器魔数」复核响应内容。
 *
 * 为什么需要：不少 CDN / 对象存储对视频回 application/octet-stream，但同样有
 * 站点把 404 页面也回成 octet-stream —— 只信 Content-Type 的话，错误页会被
 * 存成 .mp4 交给平台，最后只报「上传失败」。这里只在「服务端没明确说是视频」
 * 时嗅探前 16 字节，`video/*` 直接信任，避免误杀正常素材。
 */
const SNIFF_BYTES = 16;

/** ISO-BMFF（mp4 / mov / m4v）首个 4 字节可能是这些 box，ftyp 并非总是第一个 */
const ISO_BMFF_LEADING_TYPES = new Set([
  "ftyp",
  "moov",
  "mdat",
  "free",
  "skip",
  "wide",
  "styp",
  "sidx",
  "pnot",
  "uuid",
]);

const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // mkv / webm
const ASF_SIGNATURE = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]); // wmv

/**
 * 响应开头是否像已知视频容器。
 * @param {Buffer} head 至少前 16 字节（不足则按现有字节判断）
 * @returns {boolean}
 */
export function looksLikeVideoContainer(head) {
  if (!head || head.length < 8) return false;
  const ascii = (start, len) => head.toString("latin1", start, start + len);
  // 常见布局是 [4 字节 size]["ftyp"]；也可能直接以 free/moov 等 box 开头
  if (ISO_BMFF_LEADING_TYPES.has(ascii(0, 4))) return true;
  if (ISO_BMFF_LEADING_TYPES.has(ascii(4, 4))) return true;
  if (head.subarray(0, 4).equals(EBML_SIGNATURE)) return true;
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") return true;
  if (head.length >= 8 && head.subarray(0, 8).equals(ASF_SIGNATURE)) return true;
  if (ascii(0, 3) === "FLV") return true;
  return false;
}

/** 只有「服务端没明确声明 video/*」时才需要嗅探 */
export function needsContainerSniff(contentType) {
  return !/^video\//i.test(String(contentType || "").trim());
}

const NOT_VIDEO_CONTAINER_MESSAGE =
  "下载地址返回的不是视频文件（响应内容不是可识别的视频容器），请检查链接是否有效";

/** 先缓冲前 SNIFF_BYTES 字节做容器校验，通过后原样透传给下游 */
function createVideoSniffer() {
  let buffered = Buffer.alloc(0);
  let verified = false;
  const reject = () => new Error(NOT_VIDEO_CONTAINER_MESSAGE);
  return new Transform({
    transform(chunk, _enc, callback) {
      if (verified) return callback(null, chunk);
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < SNIFF_BYTES) return callback();
      if (!looksLikeVideoContainer(buffered)) return callback(reject());
      verified = true;
      const out = buffered;
      buffered = Buffer.alloc(0);
      callback(null, out);
    },
    flush(callback) {
      if (verified) return callback();
      if (buffered.length === 0) {
        return callback(new Error("下载的视频文件为空"));
      }
      if (!looksLikeVideoContainer(buffered)) return callback(reject());
      verified = true;
      const out = buffered;
      buffered = Buffer.alloc(0);
      this.push(out);
      callback();
    },
  });
}

export function isRemotePublishFile(file) {
  return REMOTE_FILE_RE.test(String(file || "").trim());
}

/**
 * 大小上限。默认 4 GiB；`MATRIXMEDIA_MAX_REMOTE_FILE_BYTES` 可覆盖
 * （测试用，也给自建超大素材的用户留出口）。
 */
export function getMaxRemoteFileBytes() {
  const raw = Number(process.env.MATRIXMEDIA_MAX_REMOTE_FILE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_REMOTE_FILE_BYTES;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 从 URL 猜一个展示用的文件名（保持历史语义：就是 basename，不补扩展名）。
 * publishVideo 用它算任务名与去重键（selectedFile），改动会污染已有记录。
 */
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

/**
 * 把任意名字归一成安全的落盘文件名：去控制字符 / Windows 非法字符 / 前导点，
 * 扩展名不在视频白名单时改成 .mp4，并按字节截断（中文名不会撑爆文件名上限）。
 */
export function toSafeTempFileName(name) {
  const fallback = `matrixmedia-${Date.now()}.mp4`;
  const base = path.basename(String(name || "").trim());
  if (!base || base === "/" || base === "." || base === "..") return fallback;
  const rawExt = path.extname(base);
  const ext = VIDEO_EXTENSIONS.has(rawExt.toLowerCase()) ? rawExt : ".mp4";
  let stem = path
    .basename(base, rawExt)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (!stem) return fallback;
  const budget = MAX_TEMP_NAME_BYTES - Buffer.byteLength(ext);
  while (stem.length > 0 && Buffer.byteLength(stem) > budget) {
    stem = stem.slice(0, -1);
  }
  return `${stem}${ext}`;
}

/**
 * 临时下载目录。Electron 主进程用 `app.getPath("temp")`（与旧行为一致），
 * 单测 / 纯 node 环境回退到操作系统临时目录。
 */
export function getPublishTempDir() {
  const override = String(process.env.MATRIXMEDIA_PUBLISH_TEMP_DIR || "").trim();
  if (override) return path.resolve(override);
  try {
    // eslint-disable-next-line global-require
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("temp"), "matrixmedia-publish");
    }
  } catch (_) {
    /* 非 Electron 环境（单测）：回退系统临时目录 */
  }
  return path.join(os.tmpdir(), "matrixmedia-publish");
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

const RETRYABLE_UNLINK_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);

/**
 * 删除失败下载的半成品：等写句柄关闭后调用，并对 Windows 上常见的
 * EPERM/EBUSY（句柄未释放、杀软占用）做短重试，避免「说好了删掉」却留残骸。
 * @returns {Promise<boolean>} 是否已删除（文件本就不存在也算成功）
 */
export function unlinkWithRetry(filePath, attempts = 4, delayMs = 60) {
  return new Promise((resolve) => {
    let left = attempts;
    const attempt = () => {
      fs.unlink(filePath, (err) => {
        if (!err || err.code === "ENOENT") return resolve(true);
        left -= 1;
        if (left <= 0 || !RETRYABLE_UNLINK_CODES.has(err.code)) {
          console.warn(
            "MatrixMedia: 清理临时视频失败:",
            filePath,
            err && err.message ? err.message : err
          );
          return resolve(false);
        }
        setTimeout(attempt, delayMs);
      });
    };
    attempt();
  });
}

/**
 * 清理临时目录里超过 maxAgeMs 的遗留文件（只删本模块命名格式的文件）。
 * @returns {number} 删除数量
 */
export function pruneStaleTempFiles(
  dir = getPublishTempDir(),
  maxAgeMs = STALE_TEMP_FILE_MS,
  now = Date.now()
) {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // 只动自己产出的文件。目录可能被 MATRIXMEDIA_PUBLISH_TEMP_DIR 指到别处，
    // 按 mtime 无差别删除会误伤无关文件。
    if (!TEMP_FILE_NAME_RE.test(entry.name)) continue;
    const target = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(target);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(target);
        removed += 1;
      }
    } catch (_) {
      /* 单个文件删不掉不影响下载 */
    }
  }
  if (removed > 0) {
    console.log(`[resolvePublishFile] 已清理 ${removed} 个超期临时文件`);
  }
  return removed;
}

function assertDownloadSize(received, maxBytes) {
  if (received > maxBytes) {
    throw new Error(
      `远程视频超过大小上限（已下载 ${formatMb(received)}，上限 ${formatMb(maxBytes)}）；` +
        "如确需下载更大的文件，可调整 MATRIXMEDIA_MAX_REMOTE_FILE_BYTES"
    );
  }
}

function assertVideoContentType(contentType) {
  if (isUnspecifiedContentType(contentType)) return;
  if (VIDEO_CONTENT_TYPE_RE.test(String(contentType).trim())) return;
  throw new Error(
    `下载地址返回的不是视频文件（Content-Type: ${String(contentType).slice(0, 80)}），` +
      "请检查链接是否有效"
  );
}

/**
 * 将发布 file 解析为本地路径；若为 http(s) URL 则下载到临时目录。
 * @param {string} file 本地路径或 http(s) URL
 * @param {{ maxBytes?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ localPath: string, remoteUrl: string|null, cleanup: (() => void)|null }>}
 */
export async function resolvePublishFile(file, options = {}) {
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

  const maxBytes =
    Number(options.maxBytes) > 0 ? Number(options.maxBytes) : getMaxRemoteFileBytes();

  const tmpDir = getPublishTempDir();
  fs.mkdirSync(tmpDir, { recursive: true });
  pruneStaleTempFiles(tmpDir);

  const fileName = toSafeTempFileName(guessFileNameFromUrl(raw));
  const localPath = path.join(tmpDir, `${Date.now()}-${fileName}`);

  console.log("[resolvePublishFile] 开始下载远程视频:", raw);

  // 失败不在这里加前缀：调用方（publishVideo）已经拼「下载视频失败: …」
  const response = await axios({
    method: "GET",
    url: raw,
    responseType: "stream",
    timeout: options.timeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  // 1) 类型先校验：错误页 / 接口返回的 JSON 不该被当成视频写盘
  const contentType = response.headers && response.headers["content-type"];
  try {
    assertVideoContentType(contentType);
  } catch (err) {
    if (response.data && typeof response.data.destroy === "function") {
      response.data.destroy();
    }
    throw err;
  }

  // 2) 服务端给了 Content-Length 就先卡一道，省掉白下的流量
  const declared = Number(response.headers && response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.data && typeof response.data.destroy === "function") {
      response.data.destroy();
    }
    throw new Error(
      `远程视频超过大小上限（服务端声明 ${formatMb(declared)}，上限 ${formatMb(maxBytes)}）`
    );
  }

  // 3) 流式写入并累计字节数，防止「声明很小、实际很大」或不给 Content-Length 的响应；
  //    通用 Content-Type 时再过一道容器魔数校验
  const sniffer = needsContainerSniff(contentType) ? createVideoSniffer() : null;
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(localPath);
    let received = 0;
    let settled = false;
    let finished = false;
    let fallbackTimer = null;

    const removeAndReject = (err) => {
      if (finished) return;
      finished = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      // writer 已 close，句柄释放后再删；EBUSY/EPERM 由 unlinkWithRetry 重试
      unlinkWithRetry(localPath).finally(() => reject(err));
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        if (response.data && typeof response.data.destroy === "function") {
          response.data.destroy();
        }
      } catch (_) {
        /* ignore */
      }
      try {
        writer.destroy();
      } catch (_) {
        /* ignore */
      }
      try {
        if (sniffer) sniffer.destroy();
      } catch (_) {
        /* ignore */
      }
      if (writer.closed) {
        removeAndReject(err);
      } else {
        writer.once("close", () => removeAndReject(err));
        // 极端情况 close 一直不来：2s 后仍尝试删除并返回失败
        fallbackTimer = setTimeout(() => removeAndReject(err), 2000);
      }
    };

    response.data.on("data", (chunk) => {
      received += chunk && chunk.length ? chunk.length : 0;
      try {
        assertDownloadSize(received, maxBytes);
      } catch (err) {
        fail(err);
      }
    });
    const sink = sniffer ? response.data.pipe(sniffer) : response.data;
    sink.pipe(writer);
    if (sniffer) sniffer.on("error", fail);
    writer.on("finish", () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      resolve();
    });
    writer.on("error", fail);
    response.data.on("error", fail);
  });

  const stat = fs.statSync(localPath);
  if (!stat.isFile() || stat.size <= 0) {
    await unlinkWithRetry(localPath);
    throw new Error("下载的视频文件为空");
  }

  console.log(
    "[resolvePublishFile] 下载完成:",
    localPath,
    `(${formatMb(stat.size)})`
  );

  return {
    localPath,
    remoteUrl: raw,
    cleanup: () => safeUnlink(localPath),
  };
}
