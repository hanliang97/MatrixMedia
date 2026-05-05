"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const launchInstallerBundle = path.join(outDir, "launchInstaller.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/services/launchInstaller.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: launchInstallerBundle,
});

const { createLaunchInstallerHandler } = require(launchInstallerBundle);

(async () => {
  let openedPath = "";
  let quitCount = 0;

  const handler = createLaunchInstallerHandler({
    platform: "darwin",
    spawn: () => {
      throw new Error("spawn should not be used on darwin");
    },
    shell: {
      openPath: async installerPath => {
        openedPath = installerPath;
        return "";
      },
    },
    electronApp: {
      quit: () => {
        quitCount += 1;
      },
    },
  });

  const result = await handler(null, "/tmp/matrixmedia.dmg");

  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(openedPath, "/tmp/matrixmedia.dmg");
  assert.strictEqual(quitCount, 1);
})();

(async () => {
  let spawnedPath = "";
  let unrefCalled = false;
  let quitCount = 0;

  const handler = createLaunchInstallerHandler({
    platform: "win32",
    spawn: installerPath => {
      spawnedPath = installerPath;
      return {
        unref: () => {
          unrefCalled = true;
        },
      };
    },
    shell: {
      openPath: async () => {
        throw new Error("openPath should not be used on win32");
      },
    },
    electronApp: {
      quit: () => {
        quitCount += 1;
      },
    },
  });

  const result = await handler(null, "C:\\Temp\\matrixmedia.exe");

  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(spawnedPath, "C:\\Temp\\matrixmedia.exe");
  assert.strictEqual(unrefCalled, true);
  assert.strictEqual(quitCount, 1);
})();

(async () => {
  const handler = createLaunchInstallerHandler({
    platform: "darwin",
    spawn: () => {},
    shell: {
      openPath: async () => {
        throw new Error("openPath should not be called for invalid path");
      },
    },
    electronApp: {
      quit: () => {
        throw new Error("quit should not be called for invalid path");
      },
    },
  });

  const result = await handler(null, "");

  assert.deepStrictEqual(result, { ok: false });
})();

console.log("launch installer tests passed");
