"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
  // Node 20 的 require() 不支持 ESM 源码：显式补 preset-env(commonjs)，
  // .babelrc 只在 BABEL_ENV=renderer/web 下配置且 modules:false，默认不转模块
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});

const assert = require("assert");
const {
  buildVideoDramaOption,
  getVideoDramaCapability,
  normalizeVideoDramaId,
  platformSupportsVideoDrama,
  validateVideoDramaId,
} = require("../src/shared/videoDrama");
const {
  VIDEO_LINK_TYPES,
  buildVideoLinkOption,
  getSupportedVideoLinkTypes,
  validateVideoLinkValue,
} = require("../src/shared/videoLink");
const {
  DRAMA_LINK_LABELS,
  normalizeMenuText,
  resolveDramaMenuLabel,
  resolveDramaRowKey,
} = require("../src/main/services/upLoad/sphDrama");
const { attachSphVideoLink } = require("../src/main/services/upLoad/sphLink");
const {
  parsePublishArgs,
  parsePublishRequest,
  parseMultiPublishRequest,
} = require("../src/main/cli/parsePublishArgs");

function baseArgv(extra = []) {
  return [
    "-p",
    "sph",
    "--phone",
    "13800138000",
    "-f",
    "./v.mp4",
    "-t",
    "标题",
    ...extra,
  ];
}

const DRAMA_LINK_OPTION = {
  enabled: true,
  type: "mini_drama",
  inputKind: "entity_id",
  value: "1234567890",
  selectionMode: "drama_id",
  failurePolicy: "save_draft",
};

/* 1) 能力表：小程序短剧已开放自动化 */
assert.strictEqual(platformSupportsVideoDrama("视频号"), true);
assert.strictEqual(platformSupportsVideoDrama("抖音"), false);
const capability = getVideoDramaCapability("视频号");
assert.strictEqual(capability.implemented, true);
assert.strictEqual(capability.selectionMode, "drama_id");
assert.strictEqual(capability.maxItems, 1);
assert.ok(capability.placeholder.includes("短剧"));
assert.ok(
  getSupportedVideoLinkTypes("视频号")
    .map((item) => item.type)
    .includes(VIDEO_LINK_TYPES.MINI_DRAMA)
);

/* 2) 编号校验 */
assert.deepStrictEqual(validateVideoDramaId(""), { ok: true, dramaId: "" });
assert.strictEqual(normalizeVideoDramaId(" 1234567890 "), "1234567890");
assert.deepStrictEqual(validateVideoDramaId(" 1234567890 "), {
  ok: true,
  dramaId: "1234567890",
});
// 名称按包含匹配，允许空格（如「My Boss 是首富」）；仅拦截换行/制表符
assert.strictEqual(validateVideoDramaId("My Boss 是首富").ok, true);
assert.strictEqual(validateVideoDramaId("12\t34").ok, false);
assert.ok(validateVideoDramaId("12\t34").error.includes("换行"));
assert.strictEqual(validateVideoDramaId("x".repeat(65)).ok, false);
assert.strictEqual(
  validateVideoLinkValue("视频号", VIDEO_LINK_TYPES.MINI_DRAMA, "").error,
  "请填写短剧名称"
);

/* 3) 链接选项构造（GUI / CLI / HTTP 共用） */
assert.deepStrictEqual(
  buildVideoLinkOption("视频号", VIDEO_LINK_TYPES.MINI_DRAMA, " 1234567890 "),
  { ok: true, value: DRAMA_LINK_OPTION }
);
assert.deepStrictEqual(buildVideoDramaOption("视频号", "1234567890"), {
  ok: true,
  value: {
    enabled: true,
    type: "video_drama",
    selectionMode: "drama_id",
    dramaId: "1234567890",
    failurePolicy: "save_draft",
  },
});
assert.strictEqual(buildVideoDramaOption("抖音", "1234567890").value.enabled, false);
// 空编号在「已开放短剧」的视频号下属于参数错误（与 videoProduct 行为一致）
const emptyDrama = buildVideoDramaOption("视频号", "");
assert.strictEqual(emptyDrama.ok, false);
assert.ok(emptyDrama.error.includes("短剧名称"));

/* 4) 页面决策的纯函数（平台改版时只需改候选文案常量） */
assert.strictEqual(normalizeMenuText(" 小程序 短剧 "), "小程序短剧");
assert.strictEqual(
  resolveDramaMenuLabel(["无", "商品", "小程序短剧"]),
  "小程序短剧"
);
assert.strictEqual(resolveDramaMenuLabel(["无", "商品", "微短剧"]), "微短剧");
assert.strictEqual(resolveDramaMenuLabel(["无", "商品"]), "");
assert.deepStrictEqual(DRAMA_LINK_LABELS.slice(0, 2), ["小程序短剧", "微短剧"]);
assert.deepStrictEqual(
  resolveDramaRowKey(
    [
      { key: "1", text: "无关行" },
      { key: "2", text: "短剧二 1234567890" },
    ],
    "1234567890"
  ),
  { key: "2", text: "短剧二 1234567890" }
);
assert.strictEqual(resolveDramaRowKey([{ key: "1", text: "无关行" }], "9"), null);

/* 5) CLI：快捷参数 / 类型别名 / 缺编号 / 未知类型 / 其他平台忽略 */
const cliDrama = parsePublishArgs(baseArgv(["--sph-drama-id", "1234567890"]));
assert.strictEqual(cliDrama.ok, true);
assert.deepStrictEqual(cliDrama.value.publishOptions.link, DRAMA_LINK_OPTION);

const cliAlias = parsePublishArgs(
  baseArgv(["--sph-link-type", "短剧", "--sph-link-value", "1234567890"])
);
assert.strictEqual(cliAlias.ok, true);
assert.deepStrictEqual(cliAlias.value.publishOptions.link, DRAMA_LINK_OPTION);

const cliDraftDrama = parsePublishArgs(
  baseArgv(["--draft", "--sph-drama-id", "1234567890"])
);
assert.strictEqual(cliDraftDrama.value.draft, true);
assert.strictEqual(cliDraftDrama.value.publishOptions.link.enabled, true);

const cliMissingValue = parsePublishArgs(baseArgv(["--sph-drama-id"]));
assert.strictEqual(cliMissingValue.ok, false);
assert.ok(cliMissingValue.error.includes("短剧名称"));

const cliUnknownType = parsePublishArgs(
  baseArgv(["--sph-link-type", "official_article", "--sph-link-value", "x"])
);
assert.strictEqual(cliUnknownType.ok, false);
assert.ok(
  cliUnknownType.error.includes("none、product、mini_drama 或 sph_series")
);

const cliOtherPlatform = parsePublishArgs([
  "-p",
  "dy",
  "--phone",
  "13800138000",
  "-f",
  "./v.mp4",
  "-t",
  "标题",
  "--sph-drama-id",
  "1234567890",
]);
assert.strictEqual(cliOtherPlatform.ok, true);
assert.deepStrictEqual(cliOtherPlatform.value.publishOptions, {});

/* 6) HTTP：快捷字段 / sphLink / platformOptions / 多平台隔离 */
const httpShortcut = parsePublishRequest({
  platform: "sph",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  sphDramaId: "1234567890",
});
assert.strictEqual(httpShortcut.ok, true);
assert.deepStrictEqual(httpShortcut.value.publishOptions.link, DRAMA_LINK_OPTION);

const httpSphLink = parsePublishRequest({
  platform: "sph",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  sphLink: { type: "mini_drama", value: "1234567890" },
});
assert.strictEqual(httpSphLink.ok, true);
assert.deepStrictEqual(httpSphLink.value.publishOptions.link, DRAMA_LINK_OPTION);

const httpPlatformOptions = parsePublishRequest({
  platform: "sph",
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  platformOptions: {
    sph: { link: { type: "mini_drama", value: "1234567890" } },
  },
});
assert.strictEqual(httpPlatformOptions.ok, true);
assert.deepStrictEqual(
  httpPlatformOptions.value.publishOptions.link,
  DRAMA_LINK_OPTION
);

const httpMulti = parseMultiPublishRequest({
  phone: "13800138000",
  file: "./v.mp4",
  title: "标题",
  platformOptions: {
    sph: { link: { type: "mini_drama", value: "1234567890" } },
  },
  platforms: ["dy", "sph"],
});
assert.strictEqual(httpMulti.ok, true);
const dyTarget = httpMulti.value.find((item) => item.platform === "抖音");
const sphTarget = httpMulti.value.find((item) => item.platform === "视频号");
assert.deepStrictEqual(dyTarget.publishOptions, {});
assert.deepStrictEqual(sphTarget.publishOptions.link, DRAMA_LINK_OPTION);

/* 7) 主进程入口路由：未启用直接跳过，未开放类型快速失败（不触达页面） */
(async () => {
  assert.strictEqual(await attachSphVideoLink(null, { enabled: false }), null);
  await assert.rejects(
    () =>
      attachSphVideoLink(null, {
        enabled: true,
        type: VIDEO_LINK_TYPES.OFFICIAL_ARTICLE,
        value: "https://mp.weixin.qq.com/s/xxx",
      }),
    /尚未开放/
  );
  await assert.rejects(
    () =>
      attachSphVideoLink(null, {
        enabled: true,
        type: VIDEO_LINK_TYPES.MINI_DRAMA,
        value: "12\t34",
      }),
    /换行|尚未开放/
  );
  console.log("test-sph-video-drama passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
