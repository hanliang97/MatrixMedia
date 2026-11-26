"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache");
fs.mkdirSync(cache, { recursive: true });

const argsBundle = path.join(cache, "parsePublishArgs-title.cjs");
const metaBundle = path.join(cache, "videoMetadata-gui.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/cli/parsePublishArgs.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: argsBundle,
});
buildSync({
  entryPoints: [path.join(root, "src/shared/videoMetadata.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: metaBundle,
});

const {
  parsePublishArgs,
  parseMultiPublishRequest,
  publishHelpText,
} = require(argsBundle);
const videoMeta = require(metaBundle);

async function testPublishVideoSkippedAndTimeout() {
  const cancelCalls = [];
  const recordUpdates = [];
  const harness = {
    changeData(req) {
      if (req.type === "add") {
        return {
          success: true,
          data: [{ ...req.item, id: "rec-skip-1" }],
        };
      }
      if (req.type === "update") {
        recordUpdates.push(req.item);
        return { success: true };
      }
      return { success: true, data: {} };
    },
    runPuppeteerTask(payload, transport) {
      harness.lastTask = { payload, transport };
    },
    cancelPuppeteerTaskById(taskId, reason) {
      cancelCalls.push({ taskId, reason });
      return { cancelled: true, scope: "active" };
    },
  };
  global.__mmSkippedExitHarness = harness;
  const stubs = new Map([
    ["./puppeteerFile", "module.exports = { runPuppeteerTask: global.__mmSkippedExitHarness.runPuppeteerTask, cancelPuppeteerTaskById: global.__mmSkippedExitHarness.cancelPuppeteerTaskById };"],
    ["../server/utils", "module.exports = { changeData: global.__mmSkippedExitHarness.changeData };"],
    ["./resolvePublishFile", "module.exports = { isRemotePublishFile: () => false, resolvePublishFile: async (p) => ({ localPath: p, cleanup: null }), guessFileNameFromUrl: () => '' };"],
    ["./accountPublishSettingsResolver.js", "module.exports = { resolveAccountPublishMode: () => ({ publishMode: 'publish', publishToDraft: false }) };"],
    ["./accountLookup.js", "module.exports = { resolveTaskPartition: ({ partition }) => partition };"],
    ["./scheduledPublish", "module.exports = { createScheduledRecord: (x) => x };"],
    ["./scheduledDedupe.js", "module.exports = { findExistingScheduled: () => null };"],
    ["./upLoad/uploadTimeouts.js", "module.exports = { CLI_PUBLISH_TIMEOUT_MS: 40 };"],
  ]);

  const { build } = require("esbuild");
  const outFile = path.join(cache, "publishVideo-skipped-test.cjs");
  await build({
    entryPoints: [path.join(root, "src/main/services/publishVideo.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: outFile,
    plugins: [
      {
        name: "skipped-stubs",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            stubs.has(args.path) ? { path: args.path, namespace: "stub" } : null
          );
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: stubs.get(args.path),
            loader: "js",
          }));
        },
      },
    ],
  });

  const {
    runSingleFilePublish,
    runMultiPlatformPublish,
  } = require(outFile);

  const tmpVideo = path.join(cache, "dummy.mp4");
  fs.writeFileSync(tmpVideo, "mp4");

  try {
    // 1) payload.skipped yields exitCode 6 and status "skipped" (never exitCode 0)
    const p1 = runSingleFilePublish({
      platform: "抖音",
      file: tmpVideo,
      phone: "测试号",
      partition: "persist:测试号抖音",
      title: "正常标题",
    });
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(harness.lastTask.payload.recordDate, "taskPayload must carry recordDate");
    harness.lastTask.transport.reply("puppeteerFile-done", {
      taskId: harness.lastTask.payload.taskId,
      status: false,
      skipped: true,
      message: "用户关闭窗口，已跳过该平台的发布",
    });
    const res1 = await p1;
    assert.equal(res1.exitCode, 6);
    assert.equal(res1.status, "skipped");
    assert.equal(recordUpdates[recordUpdates.length - 1].publishStatus, "skipped");
    assert.equal(recordUpdates[recordUpdates.length - 1].publishSuccessCount, 0);
    assert.equal(recordUpdates[recordUpdates.length - 1].publishFailCount, 0);

    // 2) runMultiPlatformPublish tallies skipped (exitCode 6) as success:false, succeeded:0, failed:1
    const p2 = runMultiPlatformPublish([
      {
        platform: "抖音",
        file: tmpVideo,
        phone: "测试号",
        partition: "persist:测试号抖音",
        title: "正常标题",
      },
    ]);
    await new Promise((r) => setTimeout(r, 5));
    harness.lastTask.transport.reply("puppeteerFile-done", {
      taskId: harness.lastTask.payload.taskId,
      status: false,
      skipped: true,
      message: "用户关闭窗口",
    });
    const multiRes = await p2;
    assert.equal(multiRes.success, false);
    assert.equal(multiRes.exitCode, 6);
    assert.equal(multiRes.succeeded, 0);
    assert.equal(multiRes.failed, 1);

    // 3) Timeout calls cancelPuppeteerTaskById for the exact taskId
    const resTimeout = await runSingleFilePublish({
      platform: "抖音",
      file: tmpVideo,
      phone: "测试号",
      partition: "persist:测试号抖音",
      title: "超时测试",
    });
    assert.equal(resTimeout.exitCode, 1);
    assert.equal(cancelCalls.length, 1);
    assert.equal(cancelCalls[0].taskId, harness.lastTask.payload.taskId);
  } finally {
    delete global.__mmSkippedExitHarness;
  }
}

function testParseArgsAndGuiTitleValidation() {
  // 1) CLI parsePublishArgs Douyin 30-char boundary
  const title30 = "🔥" + "A".repeat(28) + "！";
  const title31 = "🔥" + "A".repeat(29) + "！";
  assert.equal(
    parsePublishArgs(["-p", "dy", "-f", "/tmp/a.mp4", "--phone", "1", "-t", title30]).ok,
    true
  );
  const fail31 = parsePublishArgs([
    "-p",
    "dy",
    "-f",
    "/tmp/a.mp4",
    "--phone",
    "1",
    "-t",
    title31,
  ]);
  assert.equal(fail31.ok, false);
  assert.match(fail31.error, /30 字/);

  // Non-Douyin platforms allow >30 chars (including xhs 29-char e2e title)
  assert.equal(
    parsePublishArgs(["-p", "xhs", "-f", "/tmp/a.mp4", "--phone", "1", "-t", "长".repeat(29)]).ok,
    true
  );
  assert.equal(
    parsePublishArgs(["-p", "blbl", "-f", "/tmp/a.mp4", "--phone", "1", "-t", "长".repeat(45)]).ok,
    true
  );

  // HTTP multi-platform fails on shared 35-char title and succeeds with Douyin per-target override
  const multiFail = parseMultiPublishRequest({
    file: "/tmp/a.mp4",
    phone: "1",
    title: "一".repeat(35),
    platforms: ["dy", "blbl"],
  });
  assert.equal(multiFail.ok, false);
  const multiOk = parseMultiPublishRequest({
    file: "/tmp/a.mp4",
    phone: "1",
    title: "一".repeat(35),
    platforms: [{ platform: "dy", title: "一".repeat(30) }, "blbl"],
  });
  assert.equal(multiOk.ok, true);
  assert.match(publishHelpText(), /30 字/);

  // 2) GUI LocalVideoPublish.vue validatePlatformTitles parity
  const vue = fs.readFileSync(
    path.join(root, "src/renderer/components/LocalVideoPublish.vue"),
    "utf8"
  );
  const script = vue
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "")
    .replace("export default", "globalThis.component =");
  const importedNames = [
    ...vue.matchAll(/^import\s+([\s\S]*?)\s+from\s+["'][^"']+["'];/gm),
  ].flatMap((m) =>
    m[1]
      .replace(/[{}]/g, "")
      .split(",")
      .map((x) => x.trim().split(/\s+as\s+/).pop())
      .filter(Boolean)
  );
  const stubs = Object.fromEntries(importedNames.map((n) => [n, () => {}]));
  const ctx = vm.createContext({ ...stubs, ...videoMeta });
  vm.runInContext(script, ctx);
  const validatePlatformTitles = ctx.component.methods.validatePlatformTitles;
  assert.match(
    validatePlatformTitles([{ pt: "抖音" }], "一".repeat(31)),
    /30 字/
  );
  assert.equal(validatePlatformTitles([{ pt: "抖音" }], "一".repeat(30)), "");
  assert.equal(validatePlatformTitles([{ pt: "哔哩哔哩" }], "一".repeat(45)), "");
}

async function main() {
  testParseArgsAndGuiTitleValidation();
  await testPublishVideoSkippedAndTimeout();
  console.log("test-publish-skipped-exit: 全部断言通过");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
