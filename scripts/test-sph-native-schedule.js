"use strict";
require("@babel/register")({ extensions: [".js"], ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const {
  inspectSphNativeSchedule, matchesSphNativeScheduled, readSphWorkList,
  sphWorkListItems, validateSphNativeScheduleAt, verifySphNativeScheduled,
} = require("../src/main/services/upLoad/sphNativeSchedule.js");

const now = Date.now();
const at = Math.ceil((now + 24 * 3600000) / 60000) * 60000;
const target = validateSphNativeScheduleAt(at, now);
assert.equal(target.ok, true);
assert.equal(validateSphNativeScheduleAt(Date.UTC(2030, 0, 1, 16), 0).text, "2030-01-02 00:00");
for (const invalid of [now, at + 1000, Infinity, 9e18, null]) {
  assert.equal(validateSphNativeScheduleAt(invalid, now).ok, false);
}

const current = { objectId: "12345678901234567890", effectiveTime: at / 1000,
  createTime: Math.floor(now / 1000), handleStatus: 2,
  desc: { description: "测试文案", shortTitle: [{ shortTitle: "测试标题" }] },
};
const text = { description: "测试文案", shortTitle: "测试标题" };
const baseline = { excludedIds: new Set(["11111111111111111111"]), submittedAt: now };
assert.equal(matchesSphNativeScheduled(current, text, at, baseline, now), true);
for (const change of [
  { objectId: "11111111111111111111" }, { objectId: Number(current.objectId) },
  { createTime: current.createTime - 60 }, { createTime: null },
  { handleStatus: 1 }, { handleStatus: 3 }, { effectiveTime: at / 1000 + 60 },
  { effectiveTime: undefined }, { desc: { ...current.desc, description: "测试文案重复" } },
]) {
  assert.equal(matchesSphNativeScheduled({ ...current, ...change }, text, at, baseline, now), false);
}
assert.equal(matchesSphNativeScheduled(current, text, at, baseline, at), false);
assert.equal(sphWorkListItems({ errCode: 300002, data: { list: [] } }), null, "平台失败不能被当作空面板");
assert.equal(sphWorkListItems({ errCode: 0, data: { baseResp: { errcode: 1 }, list: [] } }), null);
assert.deepEqual(sphWorkListItems({ errCode: 0, data: { totalCount: 0 } }), []);

async function run() {
  // 在隔离 DOM 中实际执行同一次校验与点击，验证模式被重置时不会立即发布。
  let clicks = 0;
  const input = { value: target.text, disabled: false, getClientRects: () => [1] };
  const timed = { checked: true, disabled: false };
  const immediate = { checked: false };
  const button = { disabled: false, getClientRects: () => [1], getAttribute: () => null,
    classList: { contains: () => false }, innerText: "发表", click: () => clicks++ };
  const wrap = { querySelector: selector =>
    selector.includes('value="1"') ? timed : selector.includes('value="0"') ? immediate :
      selector.includes("placeholder") ? input : null };
  const document = { querySelector: () => ({ shadowRoot: {
    querySelector: selector => selector === ".post-time-wrap" ? wrap : button,
  } }) };
  const location = { origin: "https://channels.weixin.qq.com", pathname: "/platform/post/create" };
  const page = { evaluate: (fn, ...args) =>
    vm.runInNewContext(`(${fn.toString()})(...args)`, { document, location, args }) };
  await inspectSphNativeSchedule(page, at);
  assert.equal(clicks, 0);
  for (const [node, key, good, bad] of [
    [input, "value", target.text, "失效的旧时间"], [timed, "checked", true, false],
    [immediate, "checked", false, true], [button, "disabled", false, true],
    [location, "pathname", "/platform/post/create", "/platform/post/list"],
  ]) {
    node[key] = bad;
    await assert.rejects(inspectSphNativeSchedule(page, at, true), /校验未通过/);
    node[key] = good;
    assert.equal(clicks, 0);
  }
  await inspectSphNativeSchedule(page, at, true);
  assert.equal(clicks, 1);

  const list = new EventEmitter();
  list.waitForTimeout = async () => {};
  list.url = () => "https://channels.weixin.qq.com/platform/post/list";
  const payload = { errCode: 0, data: { list: [current] } };
  list.goto = async () => {
    for (const p of [2, 1]) list.emit("response", {
      url: () => "https://channels.weixin.qq.com/micro/content/cgi-bin/mmfinderassistant-bin/post/post_list",
      ok: () => true, request: () => ({ postData: () => JSON.stringify({ userpageType: 11, currentPage: p }) }),
      json: async () => p === 1 ? payload : { errCode: 300002 },
    });
  };
  assert.deepEqual(await readSphWorkList(list), { items: [current] });
  assert.equal(await verifySphNativeScheduled(list, text, at, baseline), true);
  payload.data.list.push({ ...current, objectId: "24444444444444444444" });
  assert.equal(await verifySphNativeScheduled(list, text, at, baseline), false, "匹配多条不能确认排期");
  payload.errCode = 300002;
  assert.deepEqual(await readSphWorkList(list), { error: "平台错误码 300002" });
  assert.equal(await verifySphNativeScheduled(list, text, at, baseline), false, "列表失败不能确认排期");
  payload.errCode = 300334;
  assert.deepEqual(await readSphWorkList(list), { error: "视频号登录已失效" });
  list.goto = async () => {};
  list.url = () => "https://channels.weixin.qq.com/login.html";
  assert.deepEqual(await readSphWorkList(list), { error: "助手跳转到了登录页" });
  assert.equal(list.listenerCount("response"), 0);
  console.log("test-sph-native-schedule: 时间、提交防误点、平台回读与旧作品排除通过");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
