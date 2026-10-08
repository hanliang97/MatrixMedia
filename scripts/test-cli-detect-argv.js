"use strict";

/**
 * detectArgv 单测（无 Jest：esbuild 打 CJS 后 assert）
 * 覆盖：isCliMode、getCliSubArgv（含包装脚本重复注入 cli 的兼容）
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "detectArgv.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/cli/detectArgv.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const { isCliMode, getCliSubArgv } = require(bundle);

// 标准形式：electron . cli publish ...
assert.strictEqual(isCliMode(["electron", ".", "cli", "publish"]), true);
assert.deepStrictEqual(
  getCliSubArgv(["electron", ".", "cli", "publish", "-p", "dy"]),
  ["publish", "-p", "dy"]
);

// 包装脚本重复注入：matrixmedia cli publish → electron . cli cli publish
assert.deepStrictEqual(
  getCliSubArgv(["electron", ".", "cli", "cli", "publish", "-p", "dy"]),
  ["publish", "-p", "dy"]
);

// 多重重复注入
assert.deepStrictEqual(
  getCliSubArgv(["electron", ".", "cli", "cli", "cli", "history", "-n", "5"]),
  ["history", "-n", "5"]
);

// 无 cli 标记：GUI 启动
assert.strictEqual(isCliMode(["electron", "."]), false);
assert.strictEqual(getCliSubArgv(["electron", "."]), null);

// 只有 cli：返回空数组，由调用方打印用法
assert.deepStrictEqual(getCliSubArgv(["electron", ".", "cli"]), []);
assert.deepStrictEqual(getCliSubArgv(["electron", ".", "cli", "cli"]), []);

// 参数值里出现 cli 不应被误剥：--name cli 保留
assert.deepStrictEqual(
  getCliSubArgv(["electron", ".", "cli", "publish", "--name", "cli"]),
  ["publish", "--name", "cli"]
);

console.log("test-cli-detect-argv: all assertions passed");
