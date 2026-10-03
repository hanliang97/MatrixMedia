"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const compiler = require("vue-template-compiler");

const source = fs.readFileSync(path.join(__dirname,
  "../src/renderer/views/videoManager/index.vue"), "utf8");
const component = compiler.parseComponent(source);
const compiled = compiler.compile(component.template.content);
assert.deepStrictEqual(compiled.errors, [], "发布记录模板应编译通过");
const expressions = [...component.template.content.matchAll(
  /@click="(hasFailScreenshot\(sub\) && openFailScreenshot\([^"]+\))"/g
)].map((match) => match[1]);
assert.strictEqual(expressions.length, 2, "应覆盖失败次数和异常次数两个入口");
const row = { bt: "同一视频", showAlltype: [] };
const sub = { pt: "哔哩哔哩", failScreenshot: "test.png" };
for (const expression of expressions) {
  const click = new Function("scope", "sub", "hasFailScreenshot", "openFailScreenshot", expression);
  const calls = [];
  click({ row }, sub, (item) => !!item.failScreenshot,
    (parent, platform) => calls.push({ parent, platform }));
  assert.deepStrictEqual(calls, [{ parent: row, platform: sub }]);
  click({ row }, { pt: "抖音" }, () => false, () => assert.fail("没有截图时不应打开弹窗"));
}
console.log("test-history-screenshot-click: 全部断言通过");
