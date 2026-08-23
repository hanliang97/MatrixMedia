"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundlePath = path.join(outDir, "puppeteerFile.cjs");

const stubModules = new Map([
  [
    "electron",
    "module.exports = { ipcMain: { on() {} }, app: {}, BrowserWindow: function BrowserWindow() {}, dialog: {} };",
  ],
  ["puppeteer-core", "module.exports = {};"],
  [
    "puppeteer-extra",
    "module.exports = { addExtra() { return { use() {} }; } };",
  ],
  ["puppeteer-in-electron", "module.exports = {};"],
  [
    "puppeteer-extra-plugin-stealth",
    "module.exports = function StealthPlugin() { return {}; };",
  ],
  ["./Type", "module.exports = {};"],
  [
    "./upLoad/uploadTimeouts.js",
    "exports.UPLOAD_WINDOW_AUTO_CLOSE_MS = 60000;",
  ],
  [
    "./upLoad/closeWindow.js",
    "exports.skipCloseConfirmation = function skipCloseConfirmation() {};",
  ],
]);

async function main() {
  await build({
    entryPoints: [path.join(root, "src/main/services/puppeteerFile.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundlePath,
    plugins: [
      {
        name: "puppeteer-cancel-test-stubs",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (!stubModules.has(args.path)) return null;
            return { path: args.path, namespace: "stub" };
          });
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: stubModules.get(args.path),
            loader: "js",
          }));
        },
      },
    ],
  });

  const {
    createPuppeteerTaskRuntime,
    normalizePuppeteerVideoTaskData,
  } = require(bundlePath);

  const articleData = {
    textType: "article",
    pt: "掘金",
    data: { title: "文章标题", content: "正文", bt2: "文章摘要" },
  };
  const originalArticleData = JSON.parse(JSON.stringify(articleData));
  assert.strictEqual(normalizePuppeteerVideoTaskData(articleData), articleData);
  assert.deepStrictEqual(articleData, originalArticleData);

  const videoData = {
    textType: "local",
    pt: "抖音",
    data: { bt1: "视频标题", bt2: "视频简介", bq: "#旅行" },
  };
  normalizePuppeteerVideoTaskData(videoData);
  assert.strictEqual(videoData.data.title, "视频标题");
  assert.strictEqual(videoData.data.description, "视频简介");
  assert.deepStrictEqual(videoData.data.tags, ["旅行"]);

  const started = [];
  const runtime = createPuppeteerTaskRuntime({
    runTask(task, done) {
      started.push(task.data.taskId);
      task.setCancelHandler(() => {
        done();
      });
    },
  });

  runtime.enqueueTask({ taskId: "active" }, { reply() {} });
  runtime.enqueueTask({ taskId: "queued-1" }, { reply() {} });
  runtime.enqueueTask({ taskId: "queued-2" }, { reply() {} });

  assert.deepStrictEqual(started, ["active"]);

  const result = runtime.cancelPuppeteerTasks("获取状态已中断上传");

  assert.deepStrictEqual(result, { active: 1, queued: 2, total: 3 });
  assert.deepStrictEqual(started, ["active"]);
  assert.strictEqual(runtime.getQueueSize(), 0);
  assert.strictEqual(runtime.isBusy(), false);

  runtime.enqueueTask({ taskId: "after-cancel" }, { reply() {} });

  assert.deepStrictEqual(started, ["active", "after-cancel"]);

  console.log("test-puppeteer-cancel passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
