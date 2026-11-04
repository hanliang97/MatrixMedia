"use strict";

/**
 * 验证视频元数据文本拼接的话题上限处理：
 * 1. 快手超过 4 个话题时裁到 4 个（平台硬限制，超出会导致本次发布被拒）
 * 2. 快手 <= 4 个话题时原样保留，不影响正常链路
 * 3. 其它平台不受该上限影响（抖音/视频号/小红书维持原有行为）
 * 4. 哔哩哔哩仍然不带 # 前缀
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "videoMetadata.cjs");
buildSync({
  entryPoints: [path.join(root, "src/shared/videoMetadata.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const { buildPlatformVideoText, formatTagsForPlatform, PLATFORM_TAG_LIMITS } =
  require(bundle);

/** 统计文本里的话题个数（# 开头的连续片段） */
function countTopics(text) {
  return (String(text || "").match(/#[^\s#]+/g) || []).length;
}

const fiveTags = ["贰臣传", "历史", "明清史", "衣冠所向", "历史冷知识"];

(async () => {
  // 1. 快手 5 个话题 → 只保留前 4 个（与 CLI 传入顺序一致，裁尾不裁头）
  {
    const text = buildPlatformVideoText("快手", {
      title: "课本只写清军入关",
      description: "简介正文",
      tags: fiveTags,
    });
    assert.strictEqual(countTopics(text.description), 4, "快手描述最多 4 个话题");
    for (const tag of fiveTags.slice(0, 4)) {
      assert.ok(text.description.includes(`#${tag}`), `应保留 #${tag}`);
    }
    assert.ok(
      !text.description.includes("#历史冷知识"),
      "第 5 个话题超出快手上限，不应拼进描述"
    );
    assert.ok(text.description.includes("简介正文"), "正文不能被裁剪影响");
  }

  // 2. 快手正好 4 个话题 → 全部保留，不误裁
  {
    const description = formatTagsForPlatform("快手", fiveTags.slice(0, 4));
    assert.strictEqual(countTopics(description), 4);
  }

  // 3. 快手无话题 → 不引入多余空白/占位
  {
    const text = buildPlatformVideoText("快手", {
      title: "标题",
      description: "只有正文",
      tags: [],
    });
    assert.strictEqual(text.description, "只有正文");
  }

  // 4. 抖音 5 个话题 → 不受快手上限影响（本次只约束快手）
  {
    const text = buildPlatformVideoText("抖音", {
      title: "标题",
      description: "正文",
      tags: fiveTags,
    });
    assert.strictEqual(countTopics(text.description), 5);
  }

  // 5. 视频号 / 小红书同样保持原行为
  for (const platform of ["视频号", "小红书"]) {
    const text = buildPlatformVideoText(platform, {
      title: "标题",
      description: "正文",
      tags: fiveTags,
    });
    assert.strictEqual(countTopics(text.description), 5, `${platform} 不受影响`);
  }

  // 6. 哔哩哔哩仍不带 # 前缀，也不受上限影响
  {
    const text = buildPlatformVideoText("哔哩哔哩", {
      title: "标题",
      description: "正文",
      tags: fiveTags,
    });
    assert.strictEqual(text.description, "正文");
    const tagsText = formatTagsForPlatform("哔哩哔哩", fiveTags);
    assert.ok(!tagsText.includes("#"), "B 站标签不带 # 前缀");
    assert.strictEqual(tagsText.split(" ").length, 5);
  }

  // 7. 上限表本身：只登记已实测的硬限制平台
  assert.strictEqual(PLATFORM_TAG_LIMITS["快手"], 4);

  console.log("test-video-metadata-tags: 全部断言通过");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
