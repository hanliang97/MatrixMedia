"use strict";
require("@babel/register")({ extensions: [".js"], ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { reserveNativeScheduleTask, markNativeScheduleSubmitting, finishNativeScheduleTask } =
  require("../src/main/services/nativeScheduleGuard.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-native-guard-"));
const task = { pt: "抖音", partition: "persist:unit抖音", filePath: path.join(dir, "video.mp4"),
  nativeScheduleAt: 2000000040000 };
try {
  const first = { ...task };
  assert.equal(reserveNativeScheduleTask(first, dir).ok, true);
  assert.equal(reserveNativeScheduleTask({ ...task }, dir).ok, false, "并发请求被原子文件锁拦截");
  finishNativeScheduleTask(first);
  const second = { ...task };
  assert.equal(reserveNativeScheduleTask(second, dir).ok, true, "提交前失败可释放占位");
  markNativeScheduleSubmitting(second);
  finishNativeScheduleTask(second);
  assert.equal(reserveNativeScheduleTask({ ...task }, dir).ok, false, "提交后保留，结果不明也不重传");
  assert.throws(() => markNativeScheduleSubmitting({ ...task }), /缺少/);
  const remote = { ...task, remoteFileUrl: "https://example.invalid/a.mp4" };
  assert.equal(reserveNativeScheduleTask(remote, dir).ok, true);
  assert.equal(reserveNativeScheduleTask({ ...remote, filePath: "/other/temp.mp4" }, dir).ok, false,
    "下载临时路径不同仍视为同一远程素材");
  finishNativeScheduleTask(remote);
  assert.equal(reserveNativeScheduleTask({ ...task, partition: "persist:other抖音" }, dir).ok, true);
  assert.equal(reserveNativeScheduleTask({ ...task, nativeScheduleAt: task.nativeScheduleAt + 60000 }, dir).ok, true);
  assert.equal(reserveNativeScheduleTask({ pt: "抖音" }, dir).ok, true, "普通任务不受影响");
  console.log("test-native-schedule-guard: 并发占位、提交前释放、提交后防重与远程素材身份通过");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
