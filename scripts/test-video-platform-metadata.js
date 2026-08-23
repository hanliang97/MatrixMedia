"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");

async function main() {
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "test/.cache");
  const bundlePath = path.join(outDir, "video-platform-metadata.cjs");
  fs.mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, "src/shared/videoMetadata.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundlePath,
  });

  const {
    buildPlatformVideoText,
    formatTagsForPlatform,
  } = require(bundlePath);
  const metadata = {
    title: "标题",
    description: "简介",
    shortTitle: "六个字短标题",
    tags: ["旅行", "#日常", "", null],
  };

  assert.strictEqual(
    formatTagsForPlatform("抖音", metadata.tags),
    "#旅行 #日常"
  );
  assert.strictEqual(
    formatTagsForPlatform("小红书", "#旅行#日常"),
    "#旅行 #日常"
  );
  assert.strictEqual(
    formatTagsForPlatform("哔哩哔哩", metadata.tags),
    "旅行 日常"
  );
  assert.deepStrictEqual(buildPlatformVideoText("抖音", metadata), {
    title: "标题",
    description: "简介 #旅行 #日常",
    shortTitle: "",
  });
  assert.deepStrictEqual(buildPlatformVideoText("视频号", metadata), {
    title: "标题",
    description: "简介 #旅行 #日常",
    shortTitle: "六个字短标题",
  });
  assert.deepStrictEqual(buildPlatformVideoText("快手", metadata), {
    title: "标题",
    description: "简介 #旅行 #日常",
    shortTitle: "",
  });
  assert.deepStrictEqual(buildPlatformVideoText("小红书", metadata), {
    title: "标题",
    description: "简介 #旅行 #日常",
    shortTitle: "",
  });
  assert.deepStrictEqual(buildPlatformVideoText("哔哩哔哩", metadata), {
    title: "标题",
    description: "简介",
    shortTitle: "",
  });
  assert.deepStrictEqual(
    buildPlatformVideoText("头条", {
      title: " 标题 ",
      description: undefined,
      tags: [],
    }),
    { title: "标题", description: "", shortTitle: "" }
  );
  assert.deepStrictEqual(
    buildPlatformVideoText("抖音", {
      title: "标题",
      description: "",
      tags: ["旅行"],
    }),
    { title: "标题", description: "#旅行", shortTitle: "" }
  );
  assert.deepStrictEqual(
    buildPlatformVideoText("抖音", {
      title: "标题",
      description: " 简介 ",
      tags: [],
    }),
    { title: "标题", description: "简介", shortTitle: "" }
  );

  console.log("test-video-platform-metadata passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
