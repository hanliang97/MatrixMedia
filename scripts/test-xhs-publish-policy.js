"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  applyXhsConservativePublishOptions,
  getPublishAttemptLimit,
  getXhsSecondClickDelayMs,
  isXhsPlatform,
} = require("../src/shared/xhsPublishPolicy");

assert.strictEqual(isXhsPlatform("小红书"), true);
assert.strictEqual(isXhsPlatform("小红书状态"), true);
assert.strictEqual(isXhsPlatform("抖音"), false);

assert.deepStrictEqual(
  applyXhsConservativePublishOptions({
    pt: "小红书",
    show: false,
    closeWindowAfterPublish: true,
  }),
  {
    pt: "小红书",
    show: true,
    closeWindowAfterPublish: false,
    xhsConservativeMode: true,
  }
);

assert.deepStrictEqual(
  applyXhsConservativePublishOptions({
    pt: "抖音",
    show: false,
    closeWindowAfterPublish: true,
  }),
  {
    pt: "抖音",
    show: false,
    closeWindowAfterPublish: true,
  }
);

assert.strictEqual(getPublishAttemptLimit({ pt: "小红书" }, 5), 1);
assert.strictEqual(getPublishAttemptLimit({ pt: "快手" }, 5), 5);

assert.strictEqual(getXhsSecondClickDelayMs(() => 0), 5000);
assert.strictEqual(getXhsSecondClickDelayMs(() => 1), 10000);

console.log("test-xhs-publish-policy passed");
