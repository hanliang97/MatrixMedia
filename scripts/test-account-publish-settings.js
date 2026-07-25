"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  SPH_LOCATION_MODES,
  isDefaultPublishToDraftEnabled,
  normalizeAccountPublishSettings,
  normalizeSphLocationMode,
  resolveEffectivePublishMode,
  updateAccountTreePublishSettings,
} = require("../src/shared/accountPublishSettings");

assert.deepStrictEqual(normalizeAccountPublishSettings({}), {
  defaultPublishToDraft: false,
  useRealBrowser: false,
  sphLocationMode: SPH_LOCATION_MODES.PLATFORM_DEFAULT,
});
assert.deepStrictEqual(
  normalizeAccountPublishSettings({
    defaultPublishToDraft: true,
    useRealBrowser: true,
    sphLocationMode: "none",
  }),
  {
    defaultPublishToDraft: true,
    useRealBrowser: true,
    sphLocationMode: SPH_LOCATION_MODES.NONE,
  }
);
assert.strictEqual(
  normalizeSphLocationMode("unexpected"),
  SPH_LOCATION_MODES.PLATFORM_DEFAULT
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
      {
        meta: {
          pt: "视频号",
          phone: "13800138000",
          defaultPublishToDraft: false,
        },
      },
      {
        meta: {
          pt: "抖音",
          phone: "13800138000",
          defaultPublishToDraft: false,
        },
      },
    ],
  },
};
const nextTree = updateAccountTreePublishSettings(accountTree, {
  phone: "13800138000-备注",
  pt: "视频号",
  defaultPublishToDraft: true,
  sphLocationMode: "none",
});
assert.strictEqual(
  nextTree["13800138000"].children[0].meta.defaultPublishToDraft,
  true
);
assert.strictEqual(
  nextTree["13800138000"].children[0].meta.sphLocationMode,
  SPH_LOCATION_MODES.NONE
);
assert.strictEqual(
  nextTree["13800138000"].children[1].meta.defaultPublishToDraft,
  false
);
assert.strictEqual(
  accountTree["13800138000"].children[0].meta.defaultPublishToDraft,
  false
);

console.log("test-account-publish-settings passed");
