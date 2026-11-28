"use strict";

/**
 * 安全审计回归：open-win 子窗口的 webPreferences 必须保持隔离基线。
 * 该通道当前无调用方（存在历史遗留风险），一旦恢复使用，渲染进程不应具备 Node 能力。
 * 运行：node scripts/test-ipc-open-win-security.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/main/services/ipcMain.js"),
  "utf8"
);

const start = source.indexOf('ipcMain.handle("open-win"');
assert(start > -1, "未找到 open-win handler");

// 截取 handler 起后的一小段（含 webPreferences），避免误判其他窗口配置
const block = source.slice(start, start + 5000);

assert(
  block.includes("nodeIntegration: false"),
  "open-win 必须关闭 nodeIntegration"
);
assert(
  block.includes("contextIsolation: true"),
  "open-win 必须开启 contextIsolation"
);
assert(
  !block.includes("nodeIntegration: true"),
  "open-win 不得开启 nodeIntegration"
);
assert(
  !block.includes("webSecurity: false"),
  "open-win 不得关闭 webSecurity"
);
assert(
  !block.includes("allowRunningInsecureContent: true"),
  "open-win 不得允许不安全内容"
);

console.log("test-ipc-open-win-security: PASS");
