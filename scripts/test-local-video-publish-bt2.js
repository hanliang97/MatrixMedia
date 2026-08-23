"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const fs = require("fs");
const path = require("path");
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

const root = path.join(__dirname, "..");
const localPublishSource = fs.readFileSync(
  path.join(root, "src/renderer/components/LocalVideoPublish.vue"),
  "utf8"
);
const videoManagerSource = fs.readFileSync(
  path.join(root, "src/renderer/views/videoManager/index.vue"),
  "utf8"
);
const ipcSource = fs.readFileSync(
  path.join(root, "src/main/services/ipcMain.js"),
  "utf8"
);
const cliSource = fs.readFileSync(
  path.join(root, "src/main/cli/index.js"),
  "utf8"
);

assert.ok(localPublishSource.includes('label="视频简介"'));
assert.ok(localPublishSource.includes('v-model="form.description"'));
assert.ok(localPublishSource.includes('label="视频号短标题"'));
assert.ok(localPublishSource.includes('v-model="form.shortTitle"'));
assert.ok(localPublishSource.includes("description:"));
assert.ok(localPublishSource.includes("shortTitle:"));
assert.ok(localPublishSource.includes("tags:"));
assert.ok(videoManagerSource.includes("normalizeVideoRecordMetadata"));
assert.ok(videoManagerSource.includes("tags: sample.tags"));
assert.ok(ipcSource.includes('map["简介"]'));
assert.ok(ipcSource.includes('map["视频号短标题"]'));
assert.ok(cliSource.includes('map["简介"]'));
assert.ok(cliSource.includes('map["视频号短标题"]'));

console.log("test-local-video-publish-bt2 passed");
