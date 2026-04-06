"use strict";

/**
 * 抖音 CLI 登录相关单测（无 Jest：esbuild 打 CJS 后 assert）
 * 覆盖：parseLoginArgs、nativeImageToBlockLines（Mock NativeImage）
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const loginBundle = path.join(outDir, "parseLoginArgs.cjs");
const blocksBundle = path.join(outDir, "qrBitmapToBlocks.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/cli/parseLoginArgs.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: loginBundle,
});

buildSync({
  entryPoints: [path.join(root, "src/main/services/cliLogin/qrBitmapToBlocks.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: blocksBundle,
});

const { parseLoginArgs } = require(loginBundle);
const { nativeImageToBlockLines, nativeImageToHalfBlockLines } = require(blocksBundle);

(() => {
  const r = parseLoginArgs(["-p", "dy", "--phone", "13800138000"]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.partition, "persist:13800138000抖音");
  assert.strictEqual(r.value.show, false);
  assert.strictEqual(r.value.terminalQr, true);
})();

(() => {
  const r = parseLoginArgs(["-p", "dy", "--phone", "13800138000", "--no-terminal-qr"]);
  assert.strictEqual(r.ok, false);
})();

(() => {
  const r = parseLoginArgs(["-p", "dy", "--phone", "1", "--show", "--no-terminal-qr"]);
  assert.strictEqual(r.ok, true);
})();

(() => {
  const r = parseLoginArgs(["-p", "抖音", "--partition", "persist:x抖音"]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.partition, "persist:x抖音");
})();

(() => {
  const r = parseLoginArgs(["--help"]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.help, true);
})();

(() => {
  const r = parseLoginArgs(["-p", "dy", "--phone", "1", "--timeout-sec", "10"]);
  assert.strictEqual(r.ok, false);
})();

(() => {
  const r = parseLoginArgs([
    "-p",
    "dy",
    "--phone",
    "1",
    "--puppeteer-headless",
    "--no-terminal-qr",
  ]);
  assert.strictEqual(r.ok, false);
})();

(() => {
  const r = parseLoginArgs([
    "-p",
    "dy",
    "--phone",
    "1",
    "--puppeteer-headless",
    "--no-terminal-qr",
    "--save-qr-png",
    "/tmp/mm-qr.png",
  ]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.puppeteerHeadless, true);
})();

(() => {
  const w = 32;
  const h = 32;
  const bpp = 4;
  const buf = Buffer.alloc(w * h * bpp, 0);
  const mockImg = {
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => buf,
  };
  const lines = nativeImageToBlockLines(mockImg, 40);
  assert.ok(lines.length >= 12);
  assert.ok(lines.some(line => line.includes("\u2588")));
})();

(() => {
  const w = 32;
  const h = 32;
  const bpp = 4;
  const buf = Buffer.alloc(w * h * bpp, 255);
  const mockImg = {
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => buf,
  };
  const lines = nativeImageToBlockLines(mockImg, 40);
  assert.ok(lines.every(line => !line.includes("\u2588")));
})();

(() => {
  const w = 32;
  const h = 32;
  const bpp = 4;
  const buf = Buffer.alloc(w * h * bpp, 0);
  const mockImg = {
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => buf,
  };
  const lines = nativeImageToHalfBlockLines(mockImg, 40);
  assert.ok(lines.some(line => /[\u2580\u2584\u2588]/.test(line)));
})();

console.log("test:cli-login 全部通过");
