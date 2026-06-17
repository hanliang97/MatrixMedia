"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  isBt2SelectAllShortcut,
  sanitizeVideohaoBt2Input,
  validateVideohaoBt2,
} = require("../src/renderer/utils/localVideoPublishBt2");

assert.strictEqual(validateVideohaoBt2("概括视频主要内容"), "");
assert.strictEqual(
  validateVideohaoBt2("概括视频，主要内容"),
  "视频号概括短标题不能包含特殊标点符号"
);
assert.strictEqual(
  sanitizeVideohaoBt2Input("概括视频，主要内容! 123"),
  "概括视频主要内容 123"
);
assert.strictEqual(sanitizeVideohaoBt2Input("标题-测试#标签"), "标题测试标签");
assert.strictEqual(isBt2SelectAllShortcut({ key: "a", ctrlKey: true }), true);
assert.strictEqual(isBt2SelectAllShortcut({ key: "A", metaKey: true }), true);
assert.strictEqual(isBt2SelectAllShortcut({ key: "a" }), false);

console.log("test-local-video-publish-bt2 passed");
