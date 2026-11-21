"use strict";

require("@babel/register")({
  extensions: [".js"], ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});
const assert = require("assert");
const { parsePublishArgs, parsePublishRequest, parseMultiPublishRequest } = require("../src/main/cli/parsePublishArgs.js");
const { parsePublishAt, resolveVideoSchedule } = require("../src/shared/videoSchedule.js");
const { resolvePublishCompletion } = require("../src/shared/publishResult.js");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const babel = require("@babel/core");

const now = new Date(2030, 0, 1, 12, 0, 0).getTime();
const publishAt = "2030-01-02 13:45:00";
const request = { platform: "dy", publishAt, preferNativeSchedule: true };

for (const platform of ["dy", "抖音"]) {
  const r = resolveVideoSchedule({ ...request, platform }, now);
  assert.equal(r.ok, true);
  assert.equal(r.mode, "native");
  assert.equal(r.fields.scheduledTask, false, "原生排期不能被软件调度器执行");
  assert.equal(r.fields.nativeScheduleAt, new Date(2030, 0, 2, 13, 45).getTime(), "按本机时区解析");
}
for (const platform of ["ks", "xhs", "blbl", "sph", "视频号"]) {
  const r = resolveVideoSchedule({ ...request, platform }, now);
  assert.equal(r.mode, "local");
  assert.equal(r.fields.scheduledTask, true);
  assert.equal(r.fields.nativeScheduleAt, null);
}
assert.equal(resolveVideoSchedule({ ...request, preferNativeSchedule: false }, now).mode, "local");
assert.equal(resolveVideoSchedule({ platform: "dy" }, now).mode, "immediate");
assert.equal(resolveVideoSchedule({ ...request, draft: true }, now).ok, false);
assert.equal(resolveVideoSchedule({ ...request, publishAt: null }, now).ok, false);
assert.equal(resolveVideoSchedule({ ...request, publishAt: "2030-01-02 13:45:01" }, now).ok, false);
assert.equal(parsePublishAt("2030-02-30 12:00:00", now).ok, false);
assert.equal(parsePublishAt("2029-12-31 12:00:00", now).ok, false);
assert.equal(parsePublishAt("2030-01-02", now).ok, false);

const future = "2090-01-02 13:45:00";
const args = ["-p", "dy", "--phone", "test", "-f", "./v.mp4", "-t", "标题"];
const cli = parsePublishArgs([...args, "--publish-at", future, "--prefer-native-schedule"]);
assert.equal(cli.ok, true);
assert.equal(cli.value.preferNativeSchedule, true);
assert.equal(parsePublishArgs([...args, "--prefer-native-schedule"]).ok, false);
assert.equal(parsePublishArgs([...args, "--publish-at", future, "--prefer-native-schedule", "--draft"]).ok, false);
const body = { platform: "dy", phone: "test", file: "./v.mp4", title: "标题", publishAt: future, preferNativeSchedule: true };
assert.equal(parsePublishRequest(body).value.preferNativeSchedule, true);
assert.equal(parsePublishRequest({ ...body, preferNativeSchedule: false }).value.preferNativeSchedule, false);
const multi = parseMultiPublishRequest({ ...body, platform: undefined, platforms: ["dy", "ks"] });
assert.equal(multi.ok, true);
assert.ok(multi.value.every(r => r.preferNativeSchedule));

const pending = resolvePublishCompletion({ status: true, nativeScheduleAt: now });
assert.equal(pending.status, "needs_attention", "仅上传/跳转不能证明已排期");
assert.equal(pending.recordStatus, "abnormal");
assert.equal(pending.exitCode, 4);
assert.equal(pending.needsAttention, true);
const confirmed = resolvePublishCompletion({ status: true, nativeScheduleAt: now, nativeScheduleVerified: true });
assert.equal(confirmed.status, "native_scheduled");
assert.equal(confirmed.recordStatus, "native_scheduled");
assert.equal(confirmed.exitCode, 0);
assert.equal(confirmed.nativeScheduled, true);
assert.equal(confirmed.savedAsDraft, false);
for (const extra of [
  { publishAbnormal: true }, { needsAttention: true }, { publishMode: "draft" },
]) {
  const ambiguous = resolvePublishCompletion({
    status: true, nativeScheduleAt: now, nativeScheduleVerified: true, ...extra,
  });
  assert.equal(ambiguous.nativeScheduled, false, "异常或草稿不能覆盖成平台已排期");
  assert.equal(ambiguous.exitCode, 4);
}
assert.equal(resolvePublishCompletion({ status: false, nativeScheduleAt: now }).exitCode, 3);
assert.equal(resolvePublishCompletion({ status: false, nativeScheduleAt: now,
  nativeSubmitAttempted: true }).exitCode, 4, "点过提交后即使关窗/异常也必须人工核对");
assert.equal(resolvePublishCompletion({ status: true }).status, "success");
assert.equal(resolvePublishCompletion({ status: true, publishMode: "draft" }).status, "draft");
const login = resolvePublishCompletion({ status: true, nativeScheduleAt: now,
  nativeScheduleVerified: true, loginRequired: true });
assert.equal(login.nativeScheduled, false);
assert.equal(login.exitCode, 5);
assert.equal(resolveVideoSchedule({ platform: "dy" }, now).fields.nativeScheduleVerified, false);

function vueMethod(relative, name, globals = {}) {
  const content = fs.readFileSync(path.join(__dirname, relative), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
  const ast = babel.parseSync(content, { configFile: false, babelrc: false, sourceType: "module" });
  const component = ast.program.body.find(n => n.type === "ExportDefaultDeclaration").declaration;
  const methods = component.properties.find(n => n.key.name === "methods").value;
  const method = methods.properties.find(n => n.key.name === name);
  assert.ok(method, name);
  return vm.runInNewContext(`({${content.slice(method.start, method.end)}}).${name}`, globals);
}

(async () => {
  for (const extra of [
    {}, { nativeScheduleVerified: true },
    { nativeScheduleVerified: true, publishAbnormal: true },
    { nativeScheduleVerified: true, publishMode: "draft" },
    { nativeScheduleVerified: true, needsAttention: true },
    { nativeScheduleVerified: true, loginRequired: true },
    { status: false, nativeScheduleVerified: true },
    { status: false, nativeSubmitAttempted: true, interrupted: true },
  ]) {
    const updates = [];
    const sync = vueMethod("../src/renderer/views/videoManager/index.vue", "syncPublishProgress", {
      resolvePublishCompletion, dataRequest: async value => updates.push(value.item),
    });
    const row = { id: "r1", nativeScheduleAt: now, scheduleMode: "native", publishFailCount: 0 };
    const payload = { textType: "local", pt: "抖音", status: true, ...extra };
    await sync.call({
      findLocalPublishRecord: () => ({ date: "2030-01-01", row }),
      fillPublishStats: value => value, normalizeCount: value => Number(value) || 0,
      pickFailScreenshot: () => "", loadRecords() {}, $notify() {},
    }, payload);
    const expected = resolvePublishCompletion({ ...payload, nativeScheduleAt: now });
    assert.equal(updates[0].publishStatus, expected.recordStatus, "GUI 与服务共用相同判定");
    assert.equal(updates[0].nativeScheduleVerified, expected.nativeScheduled === true);
    assert.equal(updates[0].publishAbnormalCount, expected.recordStatus === "abnormal" ? 1 : 0);
  }
  {
    const requests = [];
    let loaded = false;
    const sync = vueMethod("../src/renderer/views/videoManager/index.vue", "syncPublishProgress", {
      resolvePublishCompletion, dataRequest: async value => {
        requests.push(value);
        return { success: true, data: {} };
      },
    });
    const row = { id: "fast", nativeScheduleAt: now, scheduleMode: "native", publishFailCount: 0 };
    await sync.call({
      findLocalPublishRecord: () => loaded ? { date: "2030-01-01", row } : null,
      initDataFiltered() { loaded = true; }, fillPublishStats: value => value,
      normalizeCount: value => Number(value) || 0, pickFailScreenshot: () => "",
      loadRecords() {}, $notify() {},
    }, { textType: "local", pt: "抖音", status: true, nativeScheduleAt: now, needsAttention: true });
    assert.equal(requests[0].type, "get", "列表未刷新时先补读持久化记录");
    assert.equal(requests[1].item.publishStatus, "abnormal", "快速防重回执也必须保存终态");
  }
  for (const name of ["open", "openRepublish", "resetState", "openDirectory"]) {
    // 只检查会话重置的直接赋值；其余行为仍由组件既有回归覆盖。
    const method = vueMethod("../src/renderer/components/LocalVideoPublish.vue", name);
    assert.ok(method.toString().includes("this.preferNativeSchedule = false"), `${name} 必须清掉上次勾选`);
  }
  console.log("test-native-schedule: 参数、时区、路由、GUI与共享回执断言全部通过");
})().catch(error => { console.error(error); process.exitCode = 1; });
