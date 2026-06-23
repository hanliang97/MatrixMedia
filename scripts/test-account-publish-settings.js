"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  isDefaultPublishToDraftEnabled,
  normalizeAccountPublishSettings,
  resolveEffectivePublishMode,
  updateAccountTreePublishSettings,
} = require("../src/shared/accountPublishSettings");

assert.deepStrictEqual(normalizeAccountPublishSettings({}), {
  defaultPublishToDraft: false,
});
assert.deepStrictEqual(
  normalizeAccountPublishSettings({ defaultPublishToDraft: true }),
  { defaultPublishToDraft: true }
);

assert.strictEqual(isDefaultPublishToDraftEnabled({}), false);
assert.strictEqual(
  isDefaultPublishToDraftEnabled({ defaultPublishToDraft: true }),
  true
);

assert.deepStrictEqual(resolveEffectivePublishMode(false, {}), {
  publishMode: "publish",
  publishToDraft: false,
});
assert.deepStrictEqual(
  resolveEffectivePublishMode(false, { defaultPublishToDraft: true }),
  {
    publishMode: "draft",
    publishToDraft: true,
  }
);
assert.deepStrictEqual(resolveEffectivePublishMode(true, {}), {
  publishMode: "draft",
  publishToDraft: true,
});

const accountTree = {
  13800138000: {
    children: [
      { pt: "小红书", phone: "13800138000", defaultPublishToDraft: false },
      { pt: "抖音", phone: "13800138000", defaultPublishToDraft: false },
    ],
  },
};
const nextTree = updateAccountTreePublishSettings(accountTree, {
  phone: "13800138000-备注",
  pt: "小红书",
  defaultPublishToDraft: true,
});
assert.strictEqual(
  nextTree["13800138000"].children[0].defaultPublishToDraft,
  true
);
assert.strictEqual(
  nextTree["13800138000"].children[1].defaultPublishToDraft,
  false
);
assert.strictEqual(
  accountTree["13800138000"].children[0].defaultPublishToDraft,
  false
);

console.log("test-account-publish-settings passed");
