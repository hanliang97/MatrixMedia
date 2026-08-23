"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {
  parsePublishArgs,
  parsePublishRequest,
  parseMultiPublishRequest,
  publishBodyToArgv,
} = require("../src/main/cli/parsePublishArgs");
const { resolvePublishCompletion } = require("../src/shared/publishResult");

// 基础有效 argv（不含 --draft）
function baseArgv() {
  return ["-p", "dy", "--phone", "13800138000", "-f", "./v.mp4", "-t", "标题"];
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
assert.strictEqual(
  r3.value.draft,
  true,
  "HTTP body draft:true 应解析为 draft=true"
);

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
assert.strictEqual(
  r4.value.draft,
  false,
  "HTTP body draft:false 应解析为 draft=false"
);

// 5) HTTP body 不传 draft → parsed.draft=false
const r5 = parsePublishRequest({
  platform: "dy",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
});
assert.strictEqual(r5.ok, true);
assert.strictEqual(r5.value.draft, false, "不传 draft 应为 false");

// 6) CLI：视频号商品链接进入 publishOptions，且可与草稿模式同时使用
const r6 = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--draft",
  "--sph-link-type",
  "product",
  "--sph-link-value",
  "10000591263144",
]);
assert.strictEqual(r6.ok, true);
assert.strictEqual(r6.value.draft, true);
assert.deepStrictEqual(r6.value.publishOptions.link, {
  enabled: true,
  type: "product",
  inputKind: "entity_id",
  value: "10000591263144",
  selectionMode: "product_id",
  failurePolicy: "save_draft",
});

// 7) 视频号商品缺少编号时报参数错误
const r7 = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--sph-link-type",
  "product",
]);
assert.strictEqual(r7.ok, false);
assert.ok(r7.error.includes("商品编号"));

// 8) 视频号专属参数误传给其他平台时忽略，不报错
const r8 = parsePublishArgs([
  ...baseArgv(),
  "--sph-link-type",
  "product",
  "--sph-link-value",
  "not-a-product-id",
]);
assert.strictEqual(r8.ok, true);
assert.deepStrictEqual(r8.value.publishOptions, {});

// 9) HTTP：平台专属命名空间转换为视频号发布参数
const r9 = parsePublishRequest({
  platform: "sph",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  draft: true,
  platformOptions: {
    sph: { link: { type: "product", value: "10000591263144" } },
  },
});
assert.strictEqual(r9.ok, true);
assert.strictEqual(r9.value.draft, true);
assert.strictEqual(r9.value.publishOptions.link.value, "10000591263144");

// 10) HTTP 多平台：视频号读取专属参数，其他平台忽略
const r10 = parseMultiPublishRequest({
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  draft: true,
  platformOptions: {
    sph: { link: { type: "product", value: "10000591263144" } },
  },
  platforms: ["dy", "sph"],
});
assert.strictEqual(r10.ok, true);
const dy = r10.value.find((item) => item.platform === "抖音");
const sph = r10.value.find((item) => item.platform === "视频号");
assert.deepStrictEqual(dy.publishOptions, {});
assert.strictEqual(sph.publishOptions.link.value, "10000591263144");

// 11) HTTP 多视频号账号允许 target 覆盖顶层视频号商品编号
const r11 = parseMultiPublishRequest({
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  platformOptions: {
    sph: { link: { type: "product", value: "100" } },
  },
  platforms: [
    { platform: "sph" },
    {
      platform: "sph",
      phone: "13900139000",
      platformOptions: {
        sph: { link: { type: "product", value: "200" } },
      },
    },
  ],
});
assert.strictEqual(r11.ok, true);
assert.deepStrictEqual(
  r11.value.map((item) => item.publishOptions.link.value),
  ["100", "200"]
);

// 12) CLI 快捷参数 --sph-product-id
const r12 = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--sph-product-id",
  "10000591263144",
]);
assert.strictEqual(r12.ok, true);
assert.strictEqual(r12.value.publishOptions.link.value, "10000591263144");
assert.strictEqual(r12.value.publishOptions.link.enabled, true);

// 13) 只传 --sph-link-value 时默认按商品上架
const r13 = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--sph-link-value",
  "10000591263144",
]);
assert.strictEqual(r13.ok, true);
assert.strictEqual(r13.value.publishOptions.link.type, "product");

// 14) HTTP 快捷字段 sphProductId
const r14 = parsePublishRequest({
  platform: "sph",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  sphProductId: "10000591263144",
});
assert.strictEqual(r14.ok, true);
assert.strictEqual(r14.value.publishOptions.link.value, "10000591263144");

// 15) HTTP sphLink 对象
const r15 = parsePublishRequest({
  platform: "sph",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  sphLink: { type: "product", value: "10000591263144" },
});
assert.strictEqual(r15.ok, true);
assert.strictEqual(r15.value.publishOptions.link.value, "10000591263144");

// 16) 主动草稿成功与“链接失败后转存草稿”必须返回不同结果
assert.deepStrictEqual(
  resolvePublishCompletion({
    status: true,
    publishMode: "draft",
    message: "保存草稿成功",
  }),
  {
    ok: true,
    message: "保存草稿成功",
    fallbackDraft: false,
    savedAsDraft: true,
    recordStatus: "draft",
    status: "draft",
    exitCode: 0,
  }
);
assert.deepStrictEqual(
  resolvePublishCompletion({
    status: true,
    outcome: "draft_saved",
    publishMode: "draft",
    needsAttention: true,
    message: "商品添加失败，已保存草稿",
  }),
  {
    ok: true,
    message: "商品添加失败，已保存草稿",
    fallbackDraft: true,
    savedAsDraft: true,
    recordStatus: "draft",
    status: "needs_attention",
    exitCode: 4,
  }
);

// 17) CLI 语义字段应独立解析
const r17 = parsePublishArgs([
  ...baseArgv(),
  "--description",
  "视频简介",
  "--short-title",
  "六个字短标题",
]);
assert.strictEqual(r17.ok, true);
assert.strictEqual(r17.value.description, "视频简介");
assert.strictEqual(r17.value.shortTitle, "六个字短标题");

// 18) 旧 bt2 按平台分流，不能同时污染简介和短标题
const legacyDy = parsePublishArgs([...baseArgv(), "--bt2", "旧简介"]);
assert.strictEqual(legacyDy.value.description, "旧简介");
assert.strictEqual(legacyDy.value.shortTitle, "");
const legacySph = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--bt2",
  "六个字短标题",
]);
assert.strictEqual(legacySph.value.description, "");
assert.strictEqual(legacySph.value.shortTitle, "六个字短标题");

const shortTitleTooShort = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--short-title",
  "太短了",
]);
assert.strictEqual(shortTitleTooShort.ok, false);
assert.ok(shortTitleTooShort.error.includes("6～16"));

const legacyShortTitleTooLong = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--bt2",
  "这是一个明显超过十六个字的视频号短标题内容",
]);
assert.strictEqual(legacyShortTitleTooLong.ok, false);
assert.ok(legacyShortTitleTooLong.error.includes("6～16"));

const shortTitleWithPunctuation = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--short-title",
  "六个字，短标题",
]);
assert.strictEqual(shortTitleWithPunctuation.ok, false);
assert.ok(shortTitleWithPunctuation.error.includes("特殊标点"));

const validShortTitle = parsePublishArgs([
  "-p",
  "sph",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--short-title",
  "  六个字短标题  ",
]);
assert.strictEqual(validShortTitle.ok, true);
assert.strictEqual(validShortTitle.value.shortTitle, "六个字短标题");

// 19) HTTP 单平台与多平台应保留语义字段
const semanticHttp = parsePublishRequest({
  platform: "dy",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  description: "HTTP 简介",
  shortTitle: "HTTP 短标题",
});
assert.strictEqual(semanticHttp.value.description, "HTTP 简介");
assert.strictEqual(semanticHttp.value.shortTitle, "HTTP 短标题");
const semanticMulti = parseMultiPublishRequest({
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  description: "共享简介",
  shortTitle: "共享六字短标题",
  platforms: ["dy", "sph"],
});
assert.strictEqual(semanticMulti.ok, true);
assert.ok(semanticMulti.value.every((item) => item.description === "共享简介"));
assert.ok(
  semanticMulti.value.every((item) => item.shortTitle === "共享六字短标题")
);

const root = path.join(__dirname, "..");
const publishVideoSource = fs.readFileSync(
  path.join(root, "src/main/services/publishVideo.js"),
  "utf8"
);
const mcpPublishSource = fs.readFileSync(
  path.join(root, "mcp/src/tools/publish.ts"),
  "utf8"
);
assert.ok(publishVideoSource.includes("normalizeVideoMetadata"));
assert.ok(publishVideoSource.includes("description: metadata.description"));
assert.ok(publishVideoSource.includes("shortTitle: metadata.shortTitle"));
assert.ok(publishVideoSource.includes("tags: metadata.tags"));
assert.ok(mcpPublishSource.includes("description: {"));
assert.ok(mcpPublishSource.includes("shortTitle: {"));
assert.ok(mcpPublishSource.includes('"--description"'));
assert.ok(mcpPublishSource.includes('"--short-title"'));

console.log("test-publish-draft-args passed");
