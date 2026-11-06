"use strict";

// 即时/定时任务通过真实临时存储和公开 history 验证；只隔离外部运行环境。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const root = path.resolve(__dirname, "..");
const cache = path.join(root, "test/.cache/waiting-confirmation");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-waiting-service-"));
fs.mkdirSync(cache, { recursive: true });
const state = { temp, tasks: [], allTasks: [] };
global.__waitingHarness = state;

async function main() {
  let scheduler;
  let pending;
  try {
    await build({ entryPoints: ["src/main/services/publishVideo.js", "src/main/services/scheduledPublish.js",
      "src/main/cli/runHistoryCli.js", "src/main/server/utils.js", "src/shared/publishResult.js"].map(p => path.join(root, p)),
      bundle: true, platform: "node", format: "cjs", packages: "external", outdir: cache, outbase: root,
      plugins: [{ name: "external-runtime", setup(build) {
        build.onResolve({ filter: /^electron$/ }, args => ({ path: args.path, namespace: "runtime" }));
        build.onLoad({ filter: /.*/, namespace: "runtime" }, () => ({ contents:
          "exports.app={getPath:name=>require('path').join(global.__waitingHarness.temp,name)};exports.ipcMain={on(){}};" }));
        build.onResolve({ filter: /puppeteerFile$/ }, () => ({ path: "browser", namespace: "browser" }));
        build.onLoad({ filter: /.*/, namespace: "browser" }, () => ({ contents:
          "exports.runPuppeteerTask=(task,transport)=>{const item={task,transport};global.__waitingHarness.tasks.push(item);global.__waitingHarness.allTasks.push(item);};" }));
      } }] });
    const load = file => require(path.join(cache, "src", file));
    const { resolvePublishCompletion } = load("shared/publishResult.js");
    const { runSingleFilePublish } = load("main/services/publishVideo.js");
    const { runHistoryCli } = load("main/cli/runHistoryCli.js");
    const { changeData } = load("main/server/utils.js");
    scheduler = load("main/services/scheduledPublish.js");
    function history() {
      const lines = [];
      const log = console.log;
      console.log = value => lines.push(value);
      try { assert.equal(runHistoryCli({ all: true, json: true, limit: 100 }), 0); }
      finally { console.log = log; }
      return JSON.parse(lines[0]);
    }
    async function nextTask() {
      for (let i = 0; i < 100 && !state.tasks.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(state.tasks.length, "任务应到达外部发布浏览器边界");
      return state.tasks.shift();
    }
    for (const [payload, recordStatus] of [
      [{ status: true, outcome: "waiting_confirmation" }, "waiting_confirmation"],
      [{ status: true, outcome: "publish_unverified" }, "abnormal"],
      [{ status: true, pt: "公众号", publishVerified: false }, "abnormal"],
      [{ status: true, pt: "微信公众号", publishVerified: false }, "abnormal"],
    ]) {
      const result = resolvePublishCompletion(payload);
      assert.equal(result.status, "needs_attention");
      assert.equal(result.recordStatus, recordStatus);
      assert.equal(result.exitCode, 4);
      assert.equal(result.savedAsDraft, false);
    }
    assert.equal(resolvePublishCompletion({ status: true, pt: "公众号", publishVerified: true }).status, "success");
    assert.match(resolvePublishCompletion({ status: true, outcome: "waiting_confirmation" }).message, /等待|确认/);
    const events = [];
    let completed = false;
    pending = runSingleFilePublish({ platform: "抖音", file: __filename, title: "即时等待", phone: "fixture" },
      { sourceFile: __filename, resolvedFile: __filename }, { onProgress: value => events.push(value) })
      .then(result => { completed = true; return result; });
    const { task, transport } = await nextTask();
    transport.reply("puppeteerFile-progress", { ...task, taskId: "other", phase: "waiting_confirmation" });
    assert.equal(history()[0].status, "publishing");
    transport.reply("puppeteerFile-progress", { ...task, phase: "waiting_confirmation", message: "请扫码确认" });
    assert.equal(completed, false);
    assert.equal(history().length, 1);
    assert.equal(history()[0].status, "waiting_confirmation");
    assert.equal(history()[0].successCount, 0);
    assert.equal(events[0].phase, "waiting_confirmation");
    transport.reply("puppeteerFile-progress", { ...task, phase: "verifying" });
    assert.equal(history()[0].status, "publishing");
    transport.reply("puppeteerFile-done", { ...task, status: true, outcome: "waiting_confirmation" });
    const result = await pending;
    assert.equal(result.status, "needs_attention");
    assert.equal(result.needsAttention, true);
    assert.equal(history()[0].status, "waiting_confirmation");
    assert.equal(history()[0].successCount, 0);

    const date = new Date().toLocaleDateString("en-CA");
    for (const [id, payload] of [
      ["scheduled-draft", { status: true, publishMode: "draft", draftVerified: true }],
      ["scheduled-waiting", { status: true, outcome: "waiting_confirmation" }],
    ]) {
      const record = { id, date, bt: id, textOtherName: id, pt: "抖音", textType: "local",
        filePath: __filename, publishStatus: "scheduled", scheduledPublishAt: Date.now() + 20 };
      assert.equal(changeData({ fileName: "pushData", type: "add", item: record }).success, true);
      scheduler.schedulePublishRecord(record);
      const scheduled = await nextTask();
      scheduled.transport.reply("puppeteerFile-progress", { ...scheduled.task, phase: "waiting_confirmation" });
      assert.equal(history().find(row => row.id === id).status, "waiting_confirmation");
      scheduled.transport.reply("puppeteerFile-done", { ...scheduled.task, ...payload });
      assert.equal(history().find(row => row.id === id).status, payload.publishMode === "draft" ? "draft" : "waiting_confirmation");
    }
    console.log("test-publish-waiting-confirmation: 全部断言通过");
  } finally {
    for (const { task, transport } of state.allTasks) transport.reply("puppeteerFile-done", { ...task, skipped: true });
    if (pending) await Promise.allSettled([pending]);
    if (scheduler) scheduler.stopScheduledPublishScheduler();
    delete global.__waitingHarness;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
