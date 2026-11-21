"use strict";
require("@babel/register")({ extensions: [".js"], ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});
const assert = require("assert");
const vm = require("vm");
const { EventEmitter } = require("events");
const { validateDyNativeScheduleAt, prepareDyNativeSchedule, assertDyNativeSchedule,
  verifyDyNativeScheduled, dyWorkListItems, matchesDyNativeScheduled,
  readDyWorkList } = require("../src/main/services/upLoad/dyNativeSchedule.js");
const now = Date.UTC(2030, 0, 1, 12);
assert.equal(validateDyNativeScheduleAt(now + 2 * 3600000, now).ok, true);
assert.equal(validateDyNativeScheduleAt(now + 2 * 3600000 - 60000, now).ok, false);
assert.equal(validateDyNativeScheduleAt(now + 14 * 86400000, now).ok, true);
assert.equal(validateDyNativeScheduleAt(now + 14 * 86400000 + 60000, now).ok, false);
assert.equal(validateDyNativeScheduleAt(now + 7200001, now).ok, false);
assert.equal(validateDyNativeScheduleAt(Infinity, now).ok, false);
assert.equal(validateDyNativeScheduleAt(9e18, now).ok, false);
assert.equal(validateDyNativeScheduleAt(Date.UTC(2030, 0, 1, 16), now).text, "2030-01-02 00:00");

const target = Math.ceil((Date.now() + 86400000) / 60000) * 60000;
function pageFixture() {
  const input = { value: "old", attr: "old", disabled: false, focus() {}, select() {},
    getAttribute: () => input.attr };
  const native = { checked: false }, immediate = { checked: true };
  const label = (text, state) => ({ textContent: text, getClientRects: () => [1],
    querySelector: () => state, click: () => { native.checked = true; immediate.checked = false; } });
  const labels = [label("定时发布", native), label("立即发布", immediate)];
  const document = { querySelector: () => input, querySelectorAll: () => labels };
  let zone, focused = false;
  return { input, native, immediate,
    page: {
      evaluate: (fn, ...args) => vm.runInNewContext(`(${fn.toString()})(...args)`, { document, args }),
      emulateTimezone: async value => { zone = value; },
      target: () => ({ createCDPSession: async () => ({ send: async (_, opts) => { focused = opts.enabled; }, detach: async () => {} }) }),
      waitForSelector: async () => {},
      keyboard: {
        sendCharacter: async value => { assert.equal(focused, true); input.value = value; },
        press: async key => { assert.equal(key, "Tab"); input.attr = input.value; },
      },
    },
    zone: () => zone,
  };
}
(async () => {
  const f = pageFixture();
  await prepareDyNativeSchedule(f.page, target);
  assert.equal(f.zone(), "Asia/Shanghai");
  assert.equal((await assertDyNativeSchedule(f.page, target)).ok, true);
  f.input.attr = "old";
  await assert.rejects(assertDyNativeSchedule(f.page, target), /回读不符/);
  f.input.attr = f.input.value;
  f.immediate.checked = true;
  await assert.rejects(assertDyNativeSchedule(f.page, target), /回读不符/);
  f.immediate.checked = false;
  f.native.checked = false;
  await assert.rejects(assertDyNativeSchedule(f.page, target), /回读不符/);
  await assert.rejects(prepareDyNativeSchedule(f.page, Date.now()), /秒数|2 小时/);

  const item = { aweme_id: "7710465185978354000", item_title: "测试标题",
    timer: { public_time: target / 1000, status: 0 },
    status: { is_delete: false, is_prohibited: false } };
  assert.equal(dyWorkListItems({ status_code: 7, aweme_list: [item] }), null);
  assert.equal(dyWorkListItems({ status_code: 0, items: [item] }), null);
  assert.equal(matchesDyNativeScheduled(item, "测试标题", target), true);
  assert.equal(matchesDyNativeScheduled(item, "测试标题", target, { excludedIds: [item.aweme_id] }), false,
    "同名旧作品不能冒充本次提交成功");
  assert.equal(matchesDyNativeScheduled(item, "测试标题", target, { expectedId: "1" }), false);
  for (const change of [
    { item_title: "别的标题" }, { timer: undefined, create_time: target / 1000 },
    { timer: { public_time: target / 1000 + 60, status: 0 } },
    { timer: { public_time: target / 1000, status: 9 } },
    { status: { is_delete: true, is_prohibited: false } },
    { status: { is_delete: false, is_prohibited: true } },
    { aweme_id: 7710465185978354000 },
  ]) assert.equal(matchesDyNativeScheduled({ ...item, ...change }, "测试标题", target), false);

  const response = (json, url = "https://creator.douyin.com/janus/douyin/creator/pc/work_list", status = 200) => ({
    url: () => url, status: () => status, json: async () => json,
  });
  const page = new EventEmitter();
  page.waitForFunction = async () => {};
  page.reload = async () => {
    page.emit("response", response({ status_code: 0, aweme_list: [item] }));
  };
  assert.equal(await verifyDyNativeScheduled(page, "测试标题", target), true);
  assert.equal(await verifyDyNativeScheduled(page, "测试标题", target, { excludedIds: [item.aweme_id] }), false);
  assert.equal(page.listenerCount("response"), 0, "成功和不匹配都必须清理监听");
  assert.equal(await readDyWorkList(page, async () => {
    page.emit("response", response({ status_code: 0, aweme_list: [item] }, "https://example.invalid/janus/douyin/creator/pc/work_list"));
    page.emit("response", response({ status_code: 0, aweme_list: [item] }, undefined, 500));
    page.emit("response", response({ status_code: 5, aweme_list: [item] }));
  }, 10), null);
  assert.equal(await readDyWorkList(page, async () => { throw new Error("导航失败"); }, 10), null);
  assert.equal(page.listenerCount("response"), 0, "超时及导航失败必须清理监听");
  console.log("test-dy-native-schedule: 时间边界、北京时间、控件回读与平台证据判据通过");
})().catch(error => { console.error(error); process.exitCode = 1; });
