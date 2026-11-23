"use strict";

require("@babel/register")({
  extensions: [".js"], ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const babel = require("@babel/core");
const { resolveVideoSchedule } = require("../src/shared/videoSchedule.js");
const { resolvePublishCompletion } = require("../src/shared/publishResult.js");
const { normalizeCreativeStatement } = require("../src/shared/creativeStatement.js");
const { normalizeVideoMetadata } = require("../src/shared/videoMetadata.js");
const { findExistingScheduled } = require("../src/main/services/scheduledDedupe.js");

// 执行真实服务函数，仅替换文件下载、历史存储和上传队列；不接触账号或平台。
const source = fs.readFileSync(path.join(__dirname, "../src/main/services/publishVideo.js"), "utf8");
const ast = babel.parseSync(source, { configFile: false, babelrc: false, sourceType: "module" });
const functions = ast.program.body.map(n => n.declaration || n)
  .filter(n => n.type === "FunctionDeclaration")
  .map(n => source.slice(n.start, n.end)).join("\n");
const request = {
  platform: "抖音", phone: "unit", partition: "persist:unit抖音",
  file: "https://example.invalid/video.mp4", title: "定时测试",
  publishAt: "2090-01-02 13:45:00", preferNativeSchedule: true,
};

function harness(autoReply) {
  const tasks = [], records = [], updates = [], timers = new Map();
  let downloads = 0, cleanups = 0, timerSeq = 0;
  const context = {
    fs, path, resolveVideoSchedule, resolvePublishCompletion, normalizeCreativeStatement,
    normalizeVideoMetadata, findExistingScheduled,
    ptConfig: Object.fromEntries(["抖音", "视频号", "快手"].map(pt => [pt, { upload: "about:blank", listIndex: "about:blank" }])),
    console: { log() {}, warn() {}, error() {} },
    CLI_PUBLISH_TIMEOUT_MS: 2100000,
    isRemotePublishFile: file => /^https?:/.test(file),
    guessFileNameFromUrl: () => "video.mp4",
    resolvePublishFile: async () => { downloads++; return { localPath: "/fixture/video.mp4", cleanup: () => cleanups++ }; },
    resolveTaskPartition: v => v.partition,
    resolveAccountPublishMode: v => ({ publishMode: v.requestDraftMode ? "draft" : "publish", publishToDraft: v.requestDraftMode }),
    createScheduledRecord: (item, at) => ({ ...item, scheduledTask: true, publishStatus: "scheduled", scheduledPublishAt: new Date(at).getTime(), scheduledPublishAtText: at }),
    changeData: ({ type, item }) => {
      if (type === "get") return { success: true, data: { today: records } };
      if (type === "add") { records.push({ ...item, id: `r${records.length + 1}` }); return { success: true, data: records }; }
      updates.push(item);
      return { success: true };
    },
    runPuppeteerTask: (data, transport) => {
      tasks.push({ data, transport });
      if (autoReply) queueMicrotask(() => transport.reply("puppeteerFile-done", { taskId: data.taskId, ...autoReply }));
    },
    setTimeout: (fn, ms) => {
      if (ms === 4000) { queueMicrotask(fn); return 0; }
      const id = ++timerSeq; timers.set(id, fn); return id;
    },
    clearTimeout: id => timers.delete(id),
  };
  const api = vm.runInNewContext(`${functions}\n({runSingleFilePublish, runMultiPlatformPublish})`, context);
  return { api, tasks, updates, records, timers, counts: () => ({ downloads, cleanups }) };
}

(async () => {
  for (const draft of [false, true]) {
    const h = harness({ status: true, publishMode: draft ? "draft" : "publish" });
    const r = await h.api.runSingleFilePublish({
      ...request, publishAt: null, preferNativeSchedule: false, draft,
    });
    assert.equal(r.status, draft ? "draft" : "success");
    const previous = { scheduleMode: "native", nativeScheduleAt: 123,
      nativeScheduleVerified: true, scheduledPublishAt: 123, scheduledPublishAtText: "旧排期" };
    const merged = { ...previous, ...h.records[0] };
    assert.equal(merged.scheduleMode, "immediate", "合并同素材历史后不能遗留原生排期模式");
    assert.equal(merged.nativeScheduleAt, null);
    assert.equal(merged.nativeScheduleVerified, false);
    assert.equal(merged.scheduledPublishAt, null);
    assert.equal(merged.scheduledPublishAtText, "");
    assert.equal(h.tasks[0].data.nativeScheduleAt, null);
  }
  {
    const h = harness();
    const r = await h.api.runSingleFilePublish({ ...request, preferNativeSchedule: false });
    assert.equal(r.status, "scheduled");
    assert.equal(h.records[0].scheduleMode, "local");
    assert.equal(h.records[0].nativeScheduleAt, null);
    assert.equal(h.records[0].nativeScheduleVerified, false);
  }
  for (const reply of [
    { status: true },
    { status: true, nativeScheduleVerified: true, publishAbnormal: true },
    { status: true, nativeScheduleVerified: true, publishMode: "draft" },
    { status: false, nativeSubmitAttempted: true },
    { status: false, nativeSubmitAttempted: true, skipped: true },
  ]) {
    const h = harness(reply);
    const r = await h.api.runSingleFilePublish({ ...request });
    assert.equal(r.exitCode, 4, "回执缺少排期证据或含异常时不能声称排期成功");
    assert.equal(r.nativeScheduleVerified, false);
    assert.equal(h.updates.at(-1).nativeScheduleVerified, false);
    assert.equal(h.updates.at(-1).publishStatus, "abnormal");
  }
  {
    const h = harness({ status: true, nativeScheduleVerified: true });
    const sph = { ...request, platform: "视频号", partition: "persist:unit视频号" };
    const r = await h.api.runMultiPlatformPublish([sph]);
    assert.equal(r.status, "native_scheduled");
    assert.equal(h.tasks[0].data.pt, sph.platform);
    assert.equal(h.tasks[0].data.scheduledTask, false);
    for (const result of [r, r.results[0]]) {
      assert.equal(result.nativeScheduleVerified, true);
      assert.equal(result.nativeScheduled, true);
      assert.equal(result.publishAt, request.publishAt);
      assert.equal(result.scheduled, false, "平台排期不能被误读成软件等待定时");
    }
  }
  {
    const h = harness();
    const pending = h.api.runSingleFilePublish({ ...request });
    for (let i = 0; i < 8 && !h.tasks.length; i++) await Promise.resolve();
    assert.equal(h.tasks.length, 1);
    [...h.timers.values()][0]();
    const r = await pending;
    assert.equal(r.exitCode, 4, "超时结果不明，应人工核对而非普通失败重试");
    const count = h.updates.length;
    h.tasks[0].transport.reply("puppeteerFile-done", { status: true, nativeScheduleVerified: true });
    assert.equal(h.updates.length, count, "迟到回执不能覆盖已经报告的超时状态");
  }
  {
    const h = harness();
    const r = await h.api.runMultiPlatformPublish([{ ...request }, { ...request, platform: "快手" }]);
    assert.equal(r.results.length, 2);
    assert.equal(h.tasks.length, 1, "本地定时不立即上传");
    assert.equal(h.counts().cleanups, 0, "上传中的任务仍持有下载文件");
    const task = h.tasks[0];
    task.transport.reply("puppeteerFile-done", { status: true, nativeScheduleVerified: true });
    assert.deepEqual(h.counts(), { downloads: 1, cleanups: 1 }, "混合原生/本地定时最终清理一次");
    task.transport.reply("puppeteerFile-done", { status: true });
    assert.equal(h.counts().cleanups, 1);
  }
  {
    const h = harness();
    const r = await h.api.runMultiPlatformPublish([
      { ...request, cover: "/missing/native-cover.png" },
      { ...request, platform: "快手", cover: "/missing/local-cover.png" },
    ]);
    assert.equal(r.success, false);
    assert.equal(r.failed, 2);
    assert.equal(h.tasks.length, 0);
    assert.equal(h.counts().cleanups, 1, "全部前置失败也必须释放共享临时文件");
  }
  {
    const h = harness();
    await h.api.runMultiPlatformPublish([
      { ...request, platform: "快手" }, { ...request, platform: "快手" },
    ]);
    assert.deepEqual(h.counts(), { downloads: 0, cleanups: 0 }, "纯软件定时不提前下载");
  }
  console.log("test-native-schedule-service: 回执、超时、HTTP透传与混合任务资源释放通过");
})().catch(error => { console.error(error); process.exitCode = 1; });
