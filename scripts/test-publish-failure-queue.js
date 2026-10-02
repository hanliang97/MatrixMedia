"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");

async function main() {
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "test/.cache");
  fs.mkdirSync(outDir, { recursive: true });
  const attempts = [];
  const replies = [];
  let screenshots = 0;
  let disconnects = 0;
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const harness = {
    app: {},
    ipcMain: { on() {} },
    dialog: {},
    BrowserWindow: class {
      constructor() {
        this.handlers = new Map();
        this.destroyed = false;
        this.webContents = {
          on() {},
          setWindowOpenHandler() {},
          capturePage: async () => ({ isEmpty: () => true }),
        };
      }
      async loadURL() {}
      on(name, handler) { this.handlers.set(name, handler); }
      isDestroyed() { return this.destroyed; }
      close() {
        this.destroyed = true;
        const handler = this.handlers.get("closed");
        if (handler) handler();
      }
    },
    pie: {
      connect: async () => ({ disconnect() { disconnects++; } }),
      getPage: async () => ({
        evaluateOnNewDocument: async () => {},
        url: () => "https://member.bilibili.com/platform/upload/video/frame/",
        screenshot: async () => { screenshots++; return Buffer.alloc(0); },
      }),
    },
    async fail(page, data, window, event) {
      attempts.push(data.taskId);
      // 与平台 handler 的 catch 分支一样，通过统一失败回执通知队列。
      await harness.replyPublishFailure({
        page, data, window, event, message: "模拟上传失败", closeWindow: true,
      });
    },
  };
  global.__mmFailureQueueHarness = harness;
  const stubs = new Map([
    ["electron", "module.exports = global.__mmFailureQueueHarness;"],
    ["puppeteer-core", "module.exports = {};"],
    ["puppeteer-extra", "exports.addExtra = () => ({ use() {} });"],
    ["puppeteer-extra-plugin-stealth", "module.exports = () => ({});"],
    ["puppeteer-in-electron", "module.exports = global.__mmFailureQueueHarness.pie;"],
    ["./Type", "module.exports = { '哔哩哔哩': global.__mmFailureQueueHarness.fail };"],
    ["./proxyConfig.js", "exports.applyAccountProxyForTask = async () => ({ applied: false });"],
    ["./upLoad/xhsChrome.js", "module.exports = async () => {};"],
  ]);
  await build({
    entryPoints: {
      puppeteerFile: path.join(root, "src/main/services/puppeteerFile.js"),
      publishOutcome: path.join(root, "src/main/services/upLoad/publishOutcome.js"),
    },
    bundle: true, platform: "node", format: "cjs", outdir: outDir,
    plugins: [{ name: "failure-queue-stubs", setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path)
        ? { path: args.path, namespace: "stub" } : null);
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
        contents: stubs.get(args.path), loader: "js",
      }));
    } }],
  });
  const { runPuppeteerTask } = require(path.join(outDir, "puppeteerFile.js"));
  harness.replyPublishFailure = require(path.join(outDir, "publishOutcome.js")).replyPublishFailure;
  global.setTimeout = (fn, ms) => {
    const timer = { fn, ms, cleared: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => { if (timer) timer.cleared = true; };
  try {
    let finished = 0;
    for (const taskId of ["first", "second"]) {
      runPuppeteerTask({
        taskId, pt: "哔哩哔哩", partition: "persist:test",
        url: "https://member.bilibili.com/platform/upload/video/frame/",
        textType: "local", data: {}, closeWindowAfterPublish: false,
      }, { reply: (channel, payload) => replies.push({ channel, payload }) },
      () => { finished++; });
    }
    for (let i = 0; i < 30; i++) {
      const index = timers.findIndex((timer) => !timer.cleared && timer.ms <= 3000);
      if (index < 0) break;
      const timer = timers.splice(index, 1)[0];
      await timer.fn();
      // 让异步窗口创建与 handler 链完成，保留真实失败控制流。
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.strictEqual(finished, 2, "失败耗尽重试后必须结束两项任务");
    assert.deepStrictEqual(attempts, [...Array(5).fill("first"), ...Array(5).fill("second")]);
    const completions = replies.filter((item) => item.channel === "puppeteerFile-done");
    assert.strictEqual(completions.length, 2, "每个任务只能向调用方发一次终结回执");
    assert.ok(completions.every((item) => item.payload.status === false));
    assert.strictEqual(screenshots, 12, "每次失败及最终兜底均应使用有效页面截图");
    assert.ok(disconnects >= 10, "失败重试应释放浏览器连接");
    console.log("test-publish-failure-queue: 全部断言通过");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    delete global.__mmFailureQueueHarness;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
