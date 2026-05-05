"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const schedulerBundle = path.join(outDir, "scheduledPublish.cjs");
const publishArgsBundle = path.join(outDir, "parsePublishArgs.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/services/scheduledPublish.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: schedulerBundle,
  external: ["electron", "puppeteer-core", "puppeteer-extra", "puppeteer-in-electron", "puppeteer-extra-plugin-stealth"],
});

buildSync({
  entryPoints: [path.join(root, "src/main/cli/parsePublishArgs.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: publishArgsBundle,
});

const {
  parsePublishAt,
  createScheduledRecord,
  isExpiredScheduledRecord,
  buildTaskPayloadFromRecord,
} = require(schedulerBundle);
const { parsePublishArgs, publishHelpText } = require(publishArgsBundle);

const fixedNow = new Date("2026-05-05T08:00:00+08:00").getTime();

(() => {
  const r = parsePublishAt("2026-05-05 20:30:00", fixedNow);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(new Date(r.value).getFullYear(), 2026);
  assert.strictEqual(new Date(r.value).getMonth(), 4);
  assert.strictEqual(new Date(r.value).getDate(), 5);
})();

(() => {
  const r = parsePublishAt("2026/05/05 20:30", fixedNow);
  assert.strictEqual(r.ok, false);
})();

(() => {
  const r = parsePublishAt("2026-05-05 07:59:59", fixedNow);
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.error).includes("未来"));
})();

(() => {
  const base = {
    bookName: "任务名",
    textOtherName: "视频文本名",
    textType: "local",
    pt: "抖音",
    selectedFile: "v.mp4",
    bt: "标题",
    bt2: "短标题",
    bq: "#标签",
    address: "广州",
    filePath: "/tmp/v.mp4",
    useragent: "ua",
    phone: "13800138000",
    partition: "persist:13800138000抖音",
    url: "https://example.com/list",
    date: "2026-05-05",
  };
  const r = createScheduledRecord(base, "2026-05-05 20:30:00", fixedNow);
  assert.strictEqual(r.publishStatus, "scheduled");
  assert.strictEqual(r.lastPublishMessage, "等待定时发布");
  assert.strictEqual(r.scheduledTask, true);
  assert.strictEqual(r.bt, "标题");
  assert.strictEqual(r.bq, "#标签");
  assert.strictEqual(r.filePath, "/tmp/v.mp4");
  assert.ok(r.scheduledPublishAt > fixedNow);
})();

(() => {
  const expired = {
    publishStatus: "scheduled",
    scheduledTask: true,
    scheduledPublishAt: fixedNow - 1,
  };
  const pending = {
    publishStatus: "scheduled",
    scheduledTask: true,
    scheduledPublishAt: fixedNow + 1,
  };
  assert.strictEqual(isExpiredScheduledRecord(expired, fixedNow), true);
  assert.strictEqual(isExpiredScheduledRecord(pending, fixedNow), false);
})();

(() => {
  const payload = buildTaskPayloadFromRecord({
    id: "1",
    taskId: "old",
    bookName: "任务名",
    textType: "local",
    textOtherName: "视频文本名",
    bt: "标题",
    bt2: "短标题",
    bq: "#标签",
    address: "广州",
    pt: "抖音",
    url: "https://example.com/upload",
    useragent: "ua",
    partition: "persist:13800138000抖音",
    filePath: "/tmp/v.mp4",
    selectedFile: "v.mp4",
    phone: "13800138000",
  });
  assert.strictEqual(payload.bookName, "任务名");
  assert.strictEqual(payload.data.bt1, "标题");
  assert.strictEqual(payload.data.textOtherName, "视频文本名");
  assert.strictEqual(payload.pt, "抖音");
  assert.notStrictEqual(payload.taskId, "old");
})();

(() => {
  const r = parsePublishArgs([
    "-p",
    "dy",
    "--phone",
    "13800138000",
    "-f",
    "./v.mp4",
    "-t",
    "标题",
    "--publish-at",
    "2026-05-05 20:30:00",
  ]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.publishAt, "2026-05-05 20:30:00");
})();

(() => {
  assert.ok(publishHelpText().includes("--publish-at"));
})();

console.log("test:scheduled-publish 全部通过");
