"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundlePath = path.join(outDir, "accountLoginWindowManager.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/services/accountLoginWindowManager.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
});

const {
  closeOtherAccountLoginWindows,
  destroyAccountLoginWindows,
  getAccountLoginWindowByPartition,
  registerAccountLoginWindow,
} = require(bundlePath);

function createWindow(partition) {
  return {
    partition,
    closeCount: 0,
    destroyCount: 0,
    destroyed: false,
    close() {
      this.closeCount += 1;
    },
    destroy() {
      this.destroyCount += 1;
      this.destroyed = true;
    },
    isDestroyed() {
      return this.destroyed;
    },
    on(eventName, handler) {
      if (eventName === "closed") this.closedHandler = handler;
    },
  };
}

const winA = createWindow("persist:100小红书");
const winB = createWindow("persist:200抖音");

registerAccountLoginWindow(winA, winA.partition);
registerAccountLoginWindow(winB, winB.partition);

assert.strictEqual(getAccountLoginWindowByPartition(winA.partition), winA);
assert.strictEqual(getAccountLoginWindowByPartition(winB.partition), winB);

closeOtherAccountLoginWindows(winA.partition);
assert.strictEqual(winA.closeCount, 0);
assert.strictEqual(winB.closeCount, 1);

destroyAccountLoginWindows();
assert.strictEqual(winA.destroyCount, 1);
assert.strictEqual(winB.destroyCount, 1);
assert.strictEqual(getAccountLoginWindowByPartition(winA.partition), null);
assert.strictEqual(getAccountLoginWindowByPartition(winB.partition), null);

console.log("test-account-login-window-manager passed");
