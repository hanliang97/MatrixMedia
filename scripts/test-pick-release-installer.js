"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const bundle = path.join(outDir, "pickReleaseInstaller.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/services/pickReleaseInstaller.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const { preferMacArm, pickReleaseInstaller } = require(bundle);

const assets = [
  { name: "MatrixMedia-0.12.0-win-x64.exe" },
  { name: "MatrixMedia-0.12.0-mac-x64.dmg" },
  { name: "MatrixMedia-0.12.0-mac-arm64.dmg" },
];

assert.strictEqual(preferMacArm({ arch: "arm64" }), true);
assert.strictEqual(preferMacArm({ arch: "x64", translated: true }), true);
assert.strictEqual(preferMacArm({ arch: "x64", translated: false }), false);

assert.strictEqual(
  pickReleaseInstaller(assets, { platform: "darwin", arch: "arm64" }).name,
  "MatrixMedia-0.12.0-mac-arm64.dmg"
);
assert.strictEqual(
  pickReleaseInstaller(assets, {
    platform: "darwin",
    arch: "x64",
    translated: true,
  }).name,
  "MatrixMedia-0.12.0-mac-arm64.dmg"
);
assert.strictEqual(
  pickReleaseInstaller(assets, { platform: "darwin", arch: "x64" }).name,
  "MatrixMedia-0.12.0-mac-x64.dmg"
);
assert.strictEqual(
  pickReleaseInstaller(assets, { platform: "win32", arch: "x64" }).name,
  "MatrixMedia-0.12.0-win-x64.exe"
);

console.log("test-pick-release-installer: all assertions passed");
