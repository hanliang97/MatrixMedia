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
  buildVideoSeriesOption,
  normalizeVideoSeriesId,
  platformSupportsVideoSeries,
  validateVideoSeriesId,
} = require("../src/shared/videoSeries");
const {
  VIDEO_LINK_TYPES,
  buildVideoLinkOption,
  getVideoLinkTypeCapability,
  validateVideoLinkValue,
} = require("../src/shared/videoLink");
const {
  SERIES_LINK_LABELS,
  SERIES_DIALOG_HINTS,
  SERIES_SEARCH_INPUT_HINTS,
  SERIES_PRIMARY_BUTTON_LABELS,
  attachSphVideoSeries,
  normalizeSeriesText,
  resolveSeriesMenuLabel,
  resolveSeriesRowKey,
} = require("../src/main/services/upLoad/sphSeries");
const { attachSphVideoLink } = require("../src/main/services/upLoad/sphLink");
const {
  parsePublishArgs,
  parsePublishRequest,
  parseMultiPublishRequest,
  publishHelpText,
} = require("../src/main/cli/parsePublishArgs");

// ---- 共享能力表：视频号剧集已开放，且与小程序短剧区分 ----
assert.strictEqual(platformSupportsVideoSeries("视频号"), true);
assert.strictEqual(platformSupportsVideoSeries("抖音"), false);
assert.strictEqual(
  getVideoLinkTypeCapability("视频号", VIDEO_LINK_TYPES.SPH_SERIES).label,
  "视频号剧集"
);
assert.strictEqual(
  getVideoLinkTypeCapability("视频号", VIDEO_LINK_TYPES.SPH_SERIES)
    .automationSupported,
  true
);
assert.strictEqual(
  getVideoLinkTypeCapability("视频号", VIDEO_LINK_TYPES.SPH_SERIES)
    .selectionMode,
  "series_id"
);
// 剧集与短剧是两种独立类型
assert.notStrictEqual(
  VIDEO_LINK_TYPES.SPH_SERIES,
  VIDEO_LINK_TYPES.MINI_DRAMA
);

// ---- 名称规范化 / 校验（与短剧同规则） ----
assert.strictEqual(normalizeVideoSeriesId(" 6688990 "), "6688990");
assert.deepStrictEqual(validateVideoSeriesId(""), { ok: true, seriesId: "" });
assert.strictEqual(validateVideoSeriesId("My Boss 是首富").ok, true);
assert.strictEqual(validateVideoSeriesId("12\t34").ok, false);
assert.strictEqual(validateVideoSeriesId("x".repeat(65)).ok, false);
assert.deepStrictEqual(validateVideoSeriesId("6688990"), {
  ok: true,
  seriesId: "6688990",
});
assert.strictEqual(
  validateVideoLinkValue("视频号", VIDEO_LINK_TYPES.SPH_SERIES, "").error,
  "请填写剧集名称"
);
// 名称允许空格（按包含匹配），仅换行/制表符被拒
assert.strictEqual(
  validateVideoLinkValue("视频号", VIDEO_LINK_TYPES.SPH_SERIES, "My Boss 是首富").ok,
  true
);
assert.strictEqual(
  validateVideoLinkValue("视频号", VIDEO_LINK_TYPES.SPH_SERIES, "12\t34").ok,
  false
);

// ---- 选项构造 ----
assert.deepStrictEqual(buildVideoSeriesOption("视频号", "6688990"), {
  ok: true,
  value: {
    enabled: true,
    type: "video_series",
    selectionMode: "series_id",
    seriesId: "6688990",
    failurePolicy: "save_draft",
  },
});
assert.strictEqual(buildVideoSeriesOption("抖音", "6688990").value.enabled, false);
assert.strictEqual(
  buildVideoSeriesOption("视频号", "").ok,
  false
);
assert.deepStrictEqual(
  buildVideoLinkOption("视频号", VIDEO_LINK_TYPES.SPH_SERIES, "6688990"),
  {
    ok: true,
    value: {
      enabled: true,
      type: "sph_series",
      inputKind: "entity_id",
      value: "6688990",
      selectionMode: "series_id",
      failurePolicy: "save_draft",
    },
  }
);

// ---- 纯函数：菜单文案 / 行匹配（和短剧同工厂实现） ----
assert.strictEqual(normalizeSeriesText(" 视频号 剧集 "), "视频号剧集");
assert.deepStrictEqual(SERIES_LINK_LABELS.slice(0, 2), ["视频号剧集", "剧集"]);
assert.ok(Array.isArray(SERIES_DIALOG_HINTS));
assert.ok(Array.isArray(SERIES_SEARCH_INPUT_HINTS));
assert.ok(Array.isArray(SERIES_PRIMARY_BUTTON_LABELS));
assert.strictEqual(
  resolveSeriesMenuLabel(["无", "商品", "视频号剧集"]),
  "视频号剧集"
);
assert.strictEqual(resolveSeriesMenuLabel(["无", "商品"], SERIES_LINK_LABELS), "");
assert.strictEqual(
  resolveSeriesMenuLabel(["无", "剧集"], SERIES_LINK_LABELS),
  "剧集"
);
const rows = [
  { key: "6688990", text: "都市奇缘 第 1 季" },
  { key: "999", text: "另一部剧" },
];
assert.deepStrictEqual(resolveSeriesRowKey(rows, "6688990"), rows[0]);
assert.strictEqual(resolveSeriesRowKey(rows, "404"), null);
assert.strictEqual(
  resolveSeriesRowKey([{ key: "", text: "都市奇缘 6688990" }], "6688990").text,
  "都市奇缘 6688990"
);

// ---- 自动化入口：未启用/未实现类型短路 ----
(async () => {
  assert.strictEqual(
    await attachSphVideoSeries(null, { enabled: false }),
    null
  );
  assert.strictEqual(await attachSphVideoLink(null, { enabled: false }), null);
  await assert.rejects(
    () => attachSphVideoSeries({}, { enabled: true, seriesId: "" }),
    /请填写视频号剧集名称/
  );
  // 未开放类型仍被路由拦截
  await assert.rejects(
    () =>
      attachSphVideoLink({}, {
        enabled: true,
        type: "official_article",
        value: "x",
      }),
    /尚未开放/
  );
  console.log("test-sph-video-series passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

// ---- CLI 参数 ----
{
  const parsed = parsePublishArgs([
    "-p",
    "sph",
    "--phone",
    "13800138000",
    "-f",
    "./v.mp4",
    "-t",
    "t",
    "--sph-series-id",
    "6688990",
    "--draft",
  ]);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.value.publishOptions.link.type, "sph_series");
  assert.strictEqual(parsed.value.publishOptions.link.value, "6688990");
}
{
  const parsed = parsePublishArgs([
    "-p",
    "sph",
    "--phone",
    "13800138000",
    "-f",
    "./v.mp4",
    "-t",
    "t",
    "--sph-link-type",
    "剧集",
    "--sph-link-value",
    "6688990",
  ]);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.value.publishOptions.link.type, "sph_series");
}
{
  const parsed = parsePublishArgs([
    "-p",
    "sph",
    "--phone",
    "13800138000",
    "-f",
    "./v.mp4",
    "-t",
    "t",
    "--sph-series-id",
    "",
  ]);
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.error, /剧集名称/);
}
{
  const parsed = parsePublishArgs([
    "-p",
    "douyin",
    "--phone",
    "13800138000",
    "-f",
    "./v.mp4",
    "-t",
    "t",
    "--sph-series-id",
    "6688990",
  ]);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.value.publishOptions.link, undefined);
}
// HTTP 快捷字段
{
  const parsed = parsePublishRequest({
    platform: "sph",
    phone: "13800138000",
    file: "./v.mp4",
    title: "t",
    sphSeriesId: "6688990",
    draft: true,
  });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.value.publishOptions.link.type, "sph_series");
  assert.strictEqual(parsed.value.publishOptions.link.value, "6688990");
}
// HTTP 链接对象
{
  const parsed = parsePublishRequest({
    platform: "sph",
    phone: "13800138000",
    file: "./v.mp4",
    title: "t",
    sphLink: { type: "sph_series", value: "6688990" },
  });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.value.publishOptions.link.type, "sph_series");
}
// HTTP 多平台：剧集只落到视频号
{
  const parsed = parseMultiPublishRequest({
    phone: "13800138000",
    file: "./v.mp4",
    title: "标题",
    platformOptions: {
      sph: { link: { type: "sph_series", value: "6688990" } },
    },
    platforms: ["dy", "sph"],
  });
  assert.strictEqual(parsed.ok, true);
  const dyTarget = parsed.value.find((item) => item.platform === "抖音");
  const sphTarget = parsed.value.find((item) => item.platform === "视频号");
  assert.deepStrictEqual(dyTarget.publishOptions, {});
  assert.strictEqual(sphTarget.publishOptions.link.type, "sph_series");
  assert.strictEqual(sphTarget.publishOptions.link.value, "6688990");
}

// ---- 帮助文本 ----
{
  const help = publishHelpText();
  assert.match(help, /--sph-series-id <name>/);
  assert.match(help, /sph_series/);
  assert.match(help, /剧集/);
}

console.log("test-sph-video-series passed");
