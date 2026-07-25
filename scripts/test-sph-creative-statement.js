"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  CREATIVE_STATEMENT_VALUES,
  getCreativeStatementOptionsForPlatform,
  getCreativeStatementPlatformKey,
  normalizeCreativeStatement,
  platformSupportsCreativeStatement,
  resolveSphCreativeStatementLabel,
} = require("../src/shared/creativeStatement");
const {
  VIDEO_LINK_TYPES,
  getDisplayableVideoLinkTypes,
  getSupportedVideoLinkTypes,
  validateVideoLinkValue,
} = require("../src/shared/videoLink");

assert.strictEqual(platformSupportsCreativeStatement("视频号"), true);
assert.strictEqual(getCreativeStatementPlatformKey("视频号"), "sph");
assert.strictEqual(
  resolveSphCreativeStatementLabel(CREATIVE_STATEMENT_VALUES.AI_GENERATED),
  "含AI生成内容"
);
assert.strictEqual(
  resolveSphCreativeStatementLabel(CREATIVE_STATEMENT_VALUES.SELF_SHOT),
  "内容为自行拍摄"
);
assert.strictEqual(
  normalizeCreativeStatement("无需标注"),
  CREATIVE_STATEMENT_VALUES.NONE
);

const sphOptions = getCreativeStatementOptionsForPlatform("视频号").map(
  (item) => item.value
);
assert.ok(sphOptions.includes(CREATIVE_STATEMENT_VALUES.NONE));
assert.ok(sphOptions.includes(CREATIVE_STATEMENT_VALUES.AI_GENERATED));
assert.ok(sphOptions.includes(CREATIVE_STATEMENT_VALUES.SELF_SHOT));
assert.ok(sphOptions.includes(CREATIVE_STATEMENT_VALUES.REPOST));
assert.ok(!sphOptions.includes(CREATIVE_STATEMENT_VALUES.SELF_MADE_NO_REPOST));

assert.deepStrictEqual(
  getSupportedVideoLinkTypes("视频号").map((item) => item.type),
  [VIDEO_LINK_TYPES.NONE, VIDEO_LINK_TYPES.PRODUCT]
);
assert.ok(
  getDisplayableVideoLinkTypes("视频号").some(
    (item) => item.type === VIDEO_LINK_TYPES.OFFICIAL_ARTICLE
  )
);
assert.strictEqual(
  validateVideoLinkValue("视频号", VIDEO_LINK_TYPES.PRODUCT, "").ok,
  false
);
assert.strictEqual(
  validateVideoLinkValue(
    "视频号",
    VIDEO_LINK_TYPES.OFFICIAL_ARTICLE,
    "https://mp.weixin.qq.com/s/x"
  ).ok,
  false
);

console.log("test-sph-creative-statement passed");
