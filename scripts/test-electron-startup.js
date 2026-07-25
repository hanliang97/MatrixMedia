"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  initializeElectronRuntime,
} = require("../src/main/services/electronStartup");
const {
  isPlatformLoginUrl,
} = require("../src/shared/platformPageState");

async function testStartupOrder() {
  const calls = [];
  let ready = false;
  const switches = new Map();
  const app = {
    isReady: () => ready,
    commandLine: {
      getSwitchValue: (key) => switches.get(key) || "",
    },
    whenReady: async () => {
      calls.push("whenReady");
      ready = true;
    },
  };
  const pie = {
    initialize: async (receivedApp) => {
      assert.strictEqual(receivedApp, app);
      assert.strictEqual(ready, false);
      calls.push("initialize");
      switches.set("remote-debugging-port", "30123");
    },
  };
  const logs = [];
  await initializeElectronRuntime({
    app,
    pie,
    timeoutMs: 100,
    logger: { log: (message) => logs.push(message) },
  });
  assert.deepStrictEqual(calls, ["initialize", "whenReady"]);
  assert.ok(logs.some((line) => line.includes("调试端口=30123")));
}

async function testStartupFailure() {
  const app = {
    isReady: () => false,
    commandLine: { getSwitchValue: () => "" },
    whenReady: async () => {},
  };
  await assert.rejects(
    () =>
      initializeElectronRuntime({
        app,
        pie: {
          initialize: async () => {
            throw new Error("初始化失败");
          },
        },
        timeoutMs: 100,
        logger: { log() {} },
      }),
    /初始化失败/
  );
}

async function testStartupTimeout() {
  const app = {
    isReady: () => false,
    commandLine: { getSwitchValue: () => "" },
    whenReady: async () => {},
  };
  await assert.rejects(
    () =>
      initializeElectronRuntime({
        app,
        pie: { initialize: () => new Promise(() => {}) },
        timeoutMs: 20,
        logger: { log() {} },
      }),
    /初始化超时/
  );
}

async function main() {
  await testStartupOrder();
  await testStartupFailure();
  await testStartupTimeout();
  assert.strictEqual(
    isPlatformLoginUrl(
      "视频号",
      "https://channels.weixin.qq.com/login.html"
    ),
    true
  );
  assert.strictEqual(
    isPlatformLoginUrl(
      "视频号",
      "https://channels.weixin.qq.com/platform/post/create"
    ),
    false
  );
  assert.strictEqual(
    isPlatformLoginUrl("抖音", "https://channels.weixin.qq.com/login.html"),
    false
  );
  console.log("test-electron-startup passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
