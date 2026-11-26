"use strict";

import fs from "fs";
import path from "path";
import http from "http";
import crypto from "crypto";
import { matchPublishWindowEntry } from "../../shared/publishWindowMatch.js";
import { reconcileDeadEntriesToPushData } from "./publishReconcile.js";

const REGISTRY_FILE_NAME = "active-publish-windows.json";

const localWindows = new Map();
let controlServer = null;
let controlPort = 0;
let controlToken = "";
let controlServerPromise = null;
let exitCleanupRegistered = false;
let lastKnownUserDataDir = "";
let deadEntriesReconciler = null;

export function setDeadEntriesReconciler(fn) {
  deadEntriesReconciler = typeof fn === "function" ? fn : null;
}

export function getActiveLocalRecordIds() {
  const ids = [];
  for (const [key, item] of localWindows.entries()) {
    if (
      item.win &&
      typeof item.win.isDestroyed === "function" &&
      item.win.isDestroyed()
    ) {
      localWindows.delete(key);
      continue;
    }
    if (item.meta && item.meta.recordId) {
      ids.push(String(item.meta.recordId));
    }
  }
  return ids;
}

export function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  if (num === process.pid) return true;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    // EPERM 说明进程存在但无权发信号；ESRCH 说明进程已退出
    return Boolean(err && err.code === "EPERM");
  }
}

function getRegistryPath(userDataDir) {
  if (!userDataDir) return "";
  return path.join(userDataDir, REGISTRY_FILE_NAME);
}

function readRegistryEntries(
  userDataDir,
  { prune = true, pushDataDir = "" } = {}
) {
  const filePath = getRegistryPath(userDataDir);
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    if (!prune) return list;
    const alive = [];
    const dead = [];
    for (const e of list) {
      if (!e) continue;
      if (isPidAlive(e.pid)) alive.push(e);
      else dead.push(e);
    }
    if (dead.length > 0) {
      try {
        if (deadEntriesReconciler) {
          deadEntriesReconciler({
            deadEntries: dead,
            aliveEntries: alive,
            activeLocalRecordIds: getActiveLocalRecordIds(),
            pushDataDir,
          });
        } else if (pushDataDir) {
          reconcileDeadEntriesToPushData({
            deadEntries: dead,
            aliveEntries: alive,
            activeLocalRecordIds: getActiveLocalRecordIds(),
            pushDataDir,
          });
        }
      } catch (err) {
        console.warn(
          "[publish-window] 清理已退出进程前同步 pushData 失败:",
          err && err.message ? err.message : err
        );
      }
      writeRegistryEntries(userDataDir, alive);
    }
    return alive;
  } catch (_) {
    return [];
  }
}

function writeRegistryEntries(userDataDir, entries) {
  const filePath = getRegistryPath(userDataDir);
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn(
      "[publish-window] 写入活跃窗口索引失败:",
      err && err.message ? err.message : err
    );
  }
}

function removeKeyFromFile(userDataDir, key) {
  if (!userDataDir || !key) return;
  const entries = readRegistryEntries(userDataDir, { prune: true });
  const next = entries.filter((e) => e && e.key !== key);
  if (next.length !== entries.length) {
    writeRegistryEntries(userDataDir, next);
  }
}

function removePidFromFile(userDataDir, pid) {
  if (!userDataDir || !pid) return;
  const entries = readRegistryEntries(userDataDir, { prune: false });
  const next = entries.filter((e) => e && e.pid !== pid && isPidAlive(e.pid));
  if (next.length !== entries.length) {
    writeRegistryEntries(userDataDir, next);
  }
}

/**
 * 同步清理当前进程在 active-publish-windows.json 中的全部登记条目（供信号/退出钩子调用）。
 */
export function cleanupCurrentProcessRegistry(userDataDir = "") {
  const dir = userDataDir || lastKnownUserDataDir;
  localWindows.clear();
  closeControlServerIfIdle();
  if (!dir) return;
  try {
    removePidFromFile(dir, process.pid);
  } catch (_) {}
}

export function revealBrowserWindow(win, appRef = null) {
  if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) {
    return false;
  }
  try {
    if (!win._mmInitiallyShown) {
      win._mmRevealedFromBackground = true;
    }
    if (typeof win.isMinimized === "function" && win.isMinimized()) {
      win.restore();
    }
    if (typeof win.show === "function") {
      win.show();
    }
    if (typeof win.moveTop === "function") {
      win.moveTop();
    }
    if (typeof win.focus === "function") {
      win.focus();
    }
    if (process.platform === "darwin" && appRef) {
      try {
        if (appRef.dock && typeof appRef.dock.show === "function") {
          appRef.dock.show();
        }
        if (typeof appRef.focus === "function") {
          appRef.focus({ steal: true });
        }
      } catch (_) {}
    }
    return true;
  } catch (err) {
    console.warn(
      "[publish-window] 唤起发布窗口失败:",
      err && err.message ? err.message : err
    );
    return false;
  }
}

async function ensureControlServer(appRef) {
  if (controlServer && controlPort > 0) {
    return { port: controlPort, token: controlToken };
  }
  if (controlServerPromise) return controlServerPromise;

  controlServerPromise = new Promise((resolve) => {
    const token = crypto.randomBytes(24).toString("hex");
    const server = http.createServer((req, res) => {
      const sendJson = (statusCode, payload) => {
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method !== "POST" || req.url !== "/show") {
        sendJson(404, { ok: false, message: "not found" });
        return;
      }
      if (req.headers["x-mm-token"] !== token) {
        sendJson(403, { ok: false, message: "forbidden" });
        return;
      }
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 32 * 1024) req.destroy();
      });
      req.on("end", () => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (_) {}
        const target = body.key
          ? localWindows.get(body.key)
          : localWindows.values().next().value;
        if (!target || !revealBrowserWindow(target.win, appRef)) {
          sendJson(404, {
            ok: false,
            message: "目标发布窗口已关闭",
          });
          return;
        }
        sendJson(200, {
          ok: true,
          mode: "remote",
          key: target.meta.key,
          title: target.meta.title || "",
        });
      });
    });

    server.on("error", () => {
      controlServerPromise = null;
      resolve({ port: 0, token: "" });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      controlServer = server;
      controlPort = addr && typeof addr === "object" ? addr.port : 0;
      controlToken = token;
      // 不阻止子进程在任务收尾后自然退出
      if (typeof server.unref === "function") server.unref();
      controlServerPromise = null;
      resolve({ port: controlPort, token: controlToken });
    });
  });

  return controlServerPromise;
}

function closeControlServerIfIdle() {
  if (localWindows.size > 0 || !controlServer) return;
  const srv = controlServer;
  controlServer = null;
  controlPort = 0;
  controlToken = "";
  try {
    srv.close();
  } catch (_) {}
}

function requestRemoteWindowShow(entry) {
  return new Promise((resolve) => {
    const port = Number(entry && entry.controlPort);
    const token = String((entry && entry.token) || "");
    if (!port || !token) {
      resolve({ ok: false, reason: "no_control_endpoint" });
      return;
    }
    const payload = JSON.stringify({ key: entry.key });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/show",
        method: "POST",
        timeout: 3000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "X-MM-Token": token,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data || "{}");
            resolve(parsed);
          } catch (_) {
            resolve({ ok: false, reason: "invalid_response" });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: "timeout" });
    });
    req.on("error", () => {
      resolve({ ok: false, reason: "unreachable" });
    });
    req.write(payload);
    req.end();
  });
}

function sanitizePublicEntry(meta) {
  return {
    key: meta.key,
    pid: meta.pid,
    recordId: meta.recordId || "",
    recordDate: meta.recordDate || "",
    taskId: meta.taskId != null ? String(meta.taskId) : "",
    pt: meta.pt || "",
    partition: meta.partition || "",
    phone: meta.phone || "",
    bookName: meta.bookName || "",
    textOtherName: meta.textOtherName || "",
    selectedFile: meta.selectedFile || "",
    title: meta.title || "",
    startedAt: meta.startedAt || 0,
  };
}

/**
 * 注册一个正在运行中的发布 BrowserWindow（同进程 + 跨进程共享索引）。
 * 返回幂等的注销函数，窗口关闭时调用。
 */
export function registerPublishWindow(
  win,
  meta,
  { userDataDir = "", appRef = null, pushDataDir = "" } = {}
) {
  const key = `${process.pid}:${meta.taskId != null ? meta.taskId : Date.now()}:${crypto
    .randomBytes(4)
    .toString("hex")}`;
  const normalizedMeta = {
    key,
    pid: process.pid,
    recordId: meta.recordId ? String(meta.recordId) : "",
    recordDate: meta.recordDate ? String(meta.recordDate) : "",
    taskId: meta.taskId != null ? String(meta.taskId) : "",
    pt: String(meta.pt || ""),
    partition: String(meta.partition || ""),
    phone: String(meta.phone || ""),
    bookName: String(meta.bookName || ""),
    textOtherName: String(meta.textOtherName || ""),
    selectedFile: String(meta.selectedFile || ""),
    title: String(meta.title || ""),
    startedAt: Date.now(),
  };

  localWindows.set(key, { win, meta: normalizedMeta });
  if (userDataDir) {
    lastKnownUserDataDir = userDataDir;
    if (!exitCleanupRegistered) {
      exitCleanupRegistered = true;
      process.on("exit", () => {
        removePidFromFile(lastKnownUserDataDir, process.pid);
      });
    }
    ensureControlServer(appRef).then(({ port, token }) => {
      if (!localWindows.has(key)) return;
      const entries = readRegistryEntries(userDataDir, {
        prune: true,
        pushDataDir,
      }).filter((e) => e && e.key !== key);
      entries.push({
        ...normalizedMeta,
        controlPort: port,
        token,
      });
      writeRegistryEntries(userDataDir, entries);
    });
  }

  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    localWindows.delete(key);
    if (userDataDir) {
      removeKeyFromFile(userDataDir, key);
    }
    closeControlServerIfIdle();
  };
}

/**
 * 列出当前所有活跃发布窗口（本进程 + 其它正在运行的 CLI/MCP 子进程），供前端展示入口。
 */
export function listActivePublishWindows({ userDataDir = "", pushDataDir = "" } = {}) {
  const merged = new Map();
  for (const [key, item] of localWindows.entries()) {
    if (
      item.win &&
      typeof item.win.isDestroyed === "function" &&
      item.win.isDestroyed()
    ) {
      localWindows.delete(key);
      continue;
    }
    merged.set(key, sanitizePublicEntry(item.meta));
  }
  if (userDataDir) {
    const fileEntries = readRegistryEntries(userDataDir, {
      prune: true,
      pushDataDir,
    });
    for (const entry of fileEntries) {
      if (!entry || !entry.key || merged.has(entry.key)) continue;
      // 本进程里已不存在的旧条目忽略
      if (entry.pid === process.pid) continue;
      merged.set(entry.key, sanitizePublicEntry(entry));
    }
  }
  return [...merged.values()];
}

/**
 * 根据记录信息定位对应发布窗口并切到前台（优先本进程，再通过本机回环控制端唤起 CLI/MCP 子进程）。
 */
export async function showPublishWindow(
  query,
  { userDataDir = "", appRef = null, pushDataDir = "" } = {}
) {
  // 1. 优先匹配当前进程内的发布窗口
  const localMetas = [];
  for (const [key, item] of localWindows.entries()) {
    if (
      item.win &&
      typeof item.win.isDestroyed === "function" &&
      item.win.isDestroyed()
    ) {
      localWindows.delete(key);
      continue;
    }
    localMetas.push(item.meta);
  }
  const localHit = matchPublishWindowEntry(localMetas, query);
  if (localHit) {
    const item = localWindows.get(localHit.key);
    if (item && revealBrowserWindow(item.win, appRef)) {
      return {
        ok: true,
        mode: "local",
        key: localHit.key,
        pt: localHit.pt,
        title: localHit.title,
      };
    }
  }

  // 2. 尝试唤起其它仍在运行中的 CLI / MCP 子进程窗口
  if (userDataDir) {
    const remoteEntries = readRegistryEntries(userDataDir, {
      prune: true,
      pushDataDir,
    }).filter((e) => e && e.pid !== process.pid);
    const remoteHit = matchPublishWindowEntry(remoteEntries, query);
    if (remoteHit) {
      const resp = await requestRemoteWindowShow(remoteHit);
      if (resp && resp.ok) {
        return {
          ok: true,
          mode: "remote",
          key: remoteHit.key,
          pt: remoteHit.pt,
          title: remoteHit.title,
        };
      }
      // 远端窗口已关闭或不可达，清理陈旧索引
      if (resp && (resp.reason === "unreachable" || resp.message === "目标发布窗口已关闭")) {
        removeKeyFromFile(userDataDir, remoteHit.key);
      }
    }
  }

  return {
    ok: false,
    reason: "not_found",
    message: "当前没有运行中的发布窗口（可能仍在排队或任务已结束）",
  };
}
