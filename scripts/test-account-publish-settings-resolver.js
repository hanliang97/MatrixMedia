"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { build } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const resolverBundle = path.join(outDir, "accountPublishSettingsResolver.cjs");

const mockUtilsPath = path.join(outDir, "mock-utils.cjs");
fs.writeFileSync(
  mockUtilsPath,
  `"use strict";
if (!global.__mmMockAccountStore) global.__mmMockAccountStore = {};
function setStore(next) { global.__mmMockAccountStore = next; }
function changeData(opts) {
  if (opts.type !== "get" || opts.fileName !== "account") return { success: true, data: {} };
  return { success: true, data: global.__mmMockAccountStore };
}
module.exports = { changeData, __setStore: setStore };
`
);

(async () => {
  await build({
    entryPoints: [path.join(root, "src/main/services/accountPublishSettingsResolver.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: resolverBundle,
    plugins: [
      {
        name: "mock-server-utils",
        setup(b) {
          b.onResolve({ filter: /server\/utils/ }, (args) => {
            return { path: mockUtilsPath };
          });
          b.onLoad({ filter: /.*/ }, (args) => {
            // 仅用于调试
          });
        },
      },
    ],
  });

  const {
    findAccountPublishSettings,
    resolveAccountPublishMode,
  } = require(resolverBundle);
  const { __setStore } = require(mockUtilsPath);

  __setStore({
    "2026-06-26": [
      {
        phone: "13800138000",
        pt: "小红书",
        defaultPublishToDraft: true,
      },
      {
        phone: "13900139000",
        pt: "抖音",
        defaultPublishToDraft: false,
      },
    ],
  });

  // 调试：直接调用 mock changeData
  const mockUtils = require(mockUtilsPath);
  const debugResult = mockUtils.changeData({ fileName: "account", type: "get", item: { page: 1, pageSize: 9999 } });
  console.log("debug mock changeData result keys:", Object.keys(debugResult.data || {}));

  const s1 = findAccountPublishSettings({ phone: "13800138000", pt: "小红书" });
  assert.strictEqual(s1 && s1.defaultPublishToDraft, true);

  const s2 = findAccountPublishSettings({ phone: "13900139000", pt: "抖音" });
  assert.strictEqual(s2 && s2.defaultPublishToDraft, false);

  const s3 = findAccountPublishSettings({ phone: "13700000000", pt: "小红书" });
  assert.strictEqual(s3, null);

  const m1 = resolveAccountPublishMode({
    phone: "13800138000",
    pt: "小红书",
    requestDraftMode: false,
  });
  assert.deepStrictEqual(m1, { publishMode: "draft", publishToDraft: true });

  const m2 = resolveAccountPublishMode({
    phone: "13900139000",
    pt: "抖音",
    requestDraftMode: false,
  });
  assert.deepStrictEqual(m2, { publishMode: "publish", publishToDraft: false });

  const m3 = resolveAccountPublishMode({
    phone: "13900139000",
    pt: "抖音",
    requestDraftMode: true,
  });
  assert.deepStrictEqual(m3, { publishMode: "draft", publishToDraft: true });

  const m4 = resolveAccountPublishMode({
    phone: "13700000000",
    pt: "小红书",
    requestDraftMode: true,
  });
  assert.deepStrictEqual(m4, { publishMode: "draft", publishToDraft: true });

  const m5 = resolveAccountPublishMode({
    phone: "13800138000-主号",
    pt: "小红书",
    requestDraftMode: false,
  });
  assert.deepStrictEqual(m5, { publishMode: "draft", publishToDraft: true });

  __setStore({});
  const m6 = resolveAccountPublishMode({
    phone: "13800138000",
    pt: "小红书",
    requestDraftMode: false,
  });
  assert.deepStrictEqual(m6, { publishMode: "publish", publishToDraft: false });

  console.log("test-account-publish-settings-resolver passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
