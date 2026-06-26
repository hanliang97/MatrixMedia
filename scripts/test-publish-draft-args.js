"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  parsePublishArgs,
  parsePublishRequest,
  publishBodyToArgv,
} = require("../src/main/cli/parsePublishArgs");

// 基础有效 argv（不含 --draft）
function baseArgv() {
  return [
    "-p", "dy",
    "--phone", "13800138000",
    "-f", "./v.mp4",
    "-t", "标题",
  ];
}

// 1) 不加 --draft：draft 字段应为 false
const r1 = parsePublishArgs(baseArgv());
assert.strictEqual(r1.ok, true);
assert.strictEqual(r1.value.draft, false, "默认 draft 应为 false");

// 2) 加 --draft：draft 字段应为 true
const r2 = parsePublishArgs([...baseArgv(), "--draft"]);
assert.strictEqual(r2.ok, true);
assert.strictEqual(r2.value.draft, true, "--draft 应让 draft=true");

// 3) HTTP body draft: true → argv 含 --draft → parsed.draft=true
const argv3 = publishBodyToArgv({
  platform: "dy",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  draft: true,
});
assert.ok(argv3.includes("--draft"), "body.draft=true 应产出 --draft argv");

const r3 = parsePublishRequest({
  platform: "dy",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  draft: true,
});
assert.strictEqual(r3.ok, true);
assert.strictEqual(r3.value.draft, true, "HTTP body draft:true 应解析为 draft=true");

// 4) HTTP body draft: false → argv 不含 --draft → parsed.draft=false
const argv4 = publishBodyToArgv({
  platform: "dy",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  draft: false,
});
assert.ok(!argv4.includes("--draft"), "body.draft=false 不应产出 --draft argv");

const r4 = parsePublishRequest({
  platform: "dy",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  draft: false,
});
assert.strictEqual(r4.ok, true);
assert.strictEqual(r4.value.draft, false, "HTTP body draft:false 应解析为 draft=false");

// 5) HTTP body 不传 draft → parsed.draft=false
const r5 = parsePublishRequest({
  platform: "dy",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
});
assert.strictEqual(r5.ok, true);
assert.strictEqual(r5.value.draft, false, "不传 draft 应为 false");

console.log("test-publish-draft-args passed");
