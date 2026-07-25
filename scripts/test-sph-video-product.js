"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  buildVideoProductOption,
  normalizeVideoProductId,
  platformSupportsVideoProduct,
  validateVideoProductId,
} = require("../src/shared/videoProduct");
const {
  VIDEO_LINK_TYPES,
  buildVideoLinkOption,
  getDisplayableVideoLinkTypes,
  getSupportedVideoLinkTypes,
  getVideoLinkTypeCapability,
  platformSupportsVideoLink,
  resolveVideoLinkOption,
  validateVideoLinkValue,
} = require("../src/shared/videoLink");

assert.strictEqual(platformSupportsVideoProduct("视频号"), true);
assert.strictEqual(platformSupportsVideoProduct("抖音"), false);
assert.strictEqual(
  normalizeVideoProductId(" 10000591263144 "),
  "10000591263144"
);
assert.deepStrictEqual(validateVideoProductId(""), { ok: true, productId: "" });
assert.strictEqual(validateVideoProductId("abc").ok, false);
assert.deepStrictEqual(buildVideoProductOption("视频号", "10000591263144"), {
  ok: true,
  value: {
    enabled: true,
    type: "video_product",
    selectionMode: "product_id",
    productId: "10000591263144",
    failurePolicy: "save_draft",
  },
});
assert.strictEqual(
  buildVideoProductOption("抖音", "10000591263144").value.enabled,
  false
);

assert.strictEqual(platformSupportsVideoLink("视频号"), true);
assert.strictEqual(platformSupportsVideoLink("抖音"), false);
assert.deepStrictEqual(
  getSupportedVideoLinkTypes("视频号").map((item) => item.type),
  [VIDEO_LINK_TYPES.NONE, VIDEO_LINK_TYPES.PRODUCT]
);
assert.ok(
  getDisplayableVideoLinkTypes("视频号").length >
    getSupportedVideoLinkTypes("视频号").length
);
assert.strictEqual(
  validateVideoLinkValue("视频号", VIDEO_LINK_TYPES.PRODUCT, "").ok,
  false
);
assert.strictEqual(
  getVideoLinkTypeCapability("视频号", VIDEO_LINK_TYPES.OFFICIAL_ARTICLE)
    .automationSupported,
  false
);
assert.strictEqual(
  getVideoLinkTypeCapability("视频号", VIDEO_LINK_TYPES.RED_PACKET_COVER)
    .automationSupported,
  false
);
assert.strictEqual(
  getVideoLinkTypeCapability("视频号", VIDEO_LINK_TYPES.MINI_GAME)
    .automationSupported,
  false
);
assert.strictEqual(
  getVideoLinkTypeCapability("视频号", VIDEO_LINK_TYPES.MINI_DRAMA)
    .automationSupported,
  false
);
assert.strictEqual(getVideoLinkTypeCapability("视频号", "member_zone"), null);
assert.deepStrictEqual(
  buildVideoLinkOption("视频号", VIDEO_LINK_TYPES.PRODUCT, "10000591263144"),
  {
    ok: true,
    value: {
      enabled: true,
      type: "product",
      inputKind: "entity_id",
      value: "10000591263144",
      selectionMode: "product_id",
      failurePolicy: "save_draft",
    },
  }
);
assert.deepStrictEqual(resolveVideoLinkOption("视频号", {}), {
  enabled: false,
  type: "none",
  inputKind: "none",
  value: "",
  selectionMode: "none",
  failurePolicy: "save_draft",
});

console.log("test-sph-video-product passed");
