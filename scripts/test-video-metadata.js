"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");

async function main() {
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "test/.cache");
  const bundlePath = path.join(outDir, "video-metadata.cjs");
  fs.mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, "src/shared/videoMetadata.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundlePath,
  });

  const {
    joinDescriptionAndTags,
    normalizeVideoMetadata,
    normalizeVideoRecordMetadata,
  } = require(bundlePath);

  assert.deepStrictEqual(
    normalizeVideoMetadata(
      {
        title: " 标题 ",
        description: " 简介 ",
        shortTitle: " 六个字短标题 ",
        tags: ["#旅行", "日常"],
      },
      "视频号"
    ),
    {
      title: "标题",
      description: "简介",
      shortTitle: "六个字短标题",
      tags: ["旅行", "日常"],
      legacy: {
        bt1: "标题",
        bt2: "简介",
        bt2Filled: "六个字短标题",
        bdText: "简介",
        bq: "旅行 日常",
      },
    }
  );

  assert.strictEqual(
    normalizeVideoMetadata({ bt1: "标题", bt2: "旧短标题" }, "视频号")
      .shortTitle,
    "旧短标题"
  );
  const normalizedOnce = normalizeVideoMetadata(
    {
      title: "标题",
      description: "视频号简介",
      shortTitle: "",
    },
    "视频号"
  );
  const normalizedTwice = normalizeVideoMetadata(
    {
      title: normalizedOnce.title,
      description: normalizedOnce.description,
      shortTitle: normalizedOnce.shortTitle,
      ...normalizedOnce.legacy,
    },
    "视频号"
  );
  assert.strictEqual(
    normalizedTwice.shortTitle,
    "",
    "显式空 shortTitle 不应在 legacy 双写后恢复"
  );
  assert.strictEqual(
    normalizeVideoMetadata({ bt1: "标题", bt2: "旧简介" }, "抖音")
      .description,
    "旧简介"
  );
  assert.strictEqual(
    normalizeVideoMetadata(
      { bt1: "标题", bdText: "", bt2: "旧简介" },
      "抖音"
    ).description,
    "旧简介"
  );
  assert.deepStrictEqual(
    normalizeVideoMetadata({ bq: "#旅行, 日常 旅行" }, "抖音").tags,
    ["旅行", "日常"]
  );
  assert.strictEqual(joinDescriptionAndTags("", ["#旅行"]), "#旅行");
  assert.strictEqual(
    joinDescriptionAndTags("视频简介", ["#旅行", "#日常"]),
    "视频简介 #旅行 #日常"
  );
  assert.deepStrictEqual(
    normalizeVideoRecordMetadata({
      pt: "视频号",
      bt: "标题",
      bt2: "旧短标题",
    }),
    {
      title: "标题",
      description: "",
      shortTitle: "旧短标题",
      tags: [],
      legacy: {
        bt1: "标题",
        bt2: "",
        bt2Filled: "旧短标题",
        bdText: "",
        bq: "",
      },
    }
  );
  assert.strictEqual(
    normalizeVideoRecordMetadata({
      pt: "视频号",
      bt: "标题",
      bt2: "标题",
    }).shortTitle,
    ""
  );
  assert.strictEqual(
    normalizeVideoRecordMetadata({
      pt: "视频号",
      bt: "标题",
      bt2: "旧短标题",
      shortTitle: "",
    }).shortTitle,
    "",
    "历史记录显式空 shortTitle 应阻止 bt2 回退"
  );
  assert.strictEqual(
    normalizeVideoRecordMetadata({
      pt: "抖音",
      bt: "标题",
      bt2: "旧简介",
    }).description,
    "旧简介"
  );
  assert.strictEqual(
    normalizeVideoRecordMetadata({
      pt: "抖音",
      bt: "标题",
      bt2: "旧简介",
      description: "",
    }).description,
    "",
    "历史记录显式空 description 应阻止 bt2 回退"
  );

  console.log("test-video-metadata passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
