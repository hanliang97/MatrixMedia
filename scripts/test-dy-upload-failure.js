"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache");
fs.mkdirSync(cache, { recursive: true });

const dyBundle = path.join(cache, "dy-upload-failure-test.cjs");
const metaBundle = path.join(cache, "videoMetadata-test.cjs");
const workMatchBundle = path.join(cache, "workStatsMatch-test.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/services/upLoad/dy.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: dyBundle,
});
buildSync({
  entryPoints: [path.join(root, "src/shared/videoMetadata.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: metaBundle,
});
buildSync({
  entryPoints: [path.join(root, "src/shared/workStatsMatch.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: workMatchBundle,
});

const {
  probeDyUploadState,
  waitForDyUploadReady,
  isDyTitleComplete,
} = require(dyBundle);
const {
  PLATFORM_TITLE_LIMITS,
  countCodePoints,
  countTitleChars,
  sliceCodePoints,
  validatePlatformTitle,
} = require(metaBundle);
const { findWorkByTitle } = require(workMatchBundle);

function makeNode({
  tag = "div",
  text = "",
  className = "",
  id = "",
  visible = true,
  closestMatch = false,
  parent = null,
  children = [],
} = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    className,
    id,
    innerText: text,
    textContent: text,
    parentElement: parent,
    getBoundingClientRect: () =>
      visible ? { width: 120, height: 24 } : { width: 0, height: 0 },
    getAttribute: (name) => {
      if (name === "class") return className;
      if (name === "id") return id;
      return "";
    },
    closest: () => (closestMatch ? {} : null),
    querySelectorAll: () => children,
  };
  for (const c of children) c.parentElement = node;
  return node;
}

function runProbeWithDom({ videos = [], nodes = [] }, probeConfig) {
  const prevDoc = global.document;
  const prevStyle = global.getComputedStyle;
  global.document = {
    querySelectorAll: (sel) => {
      if (sel === "video") return videos;
      return nodes;
    },
  };
  global.getComputedStyle = () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
  });
  try {
    return probeDyUploadState(probeConfig);
  } finally {
    global.document = prevDoc;
    global.getComputedStyle = prevStyle;
  }
}

async function main() {
  // 1) Ready video + permanent '重新上传' button returns ready
  {
    const readyVideo = {
      currentSrc: "https://v26-web.douyin.com/video/tos/123",
      getAttribute: () => "",
      parentElement: {
        querySelector: (s) => (s === ".rc-slider.rc-slider-horizontal" ? {} : null),
      },
    };
    const reuploadBtn = makeNode({ tag: "span", text: "重新上传" });
    const res = runProbeWithDom({ videos: [readyVideo], nodes: [reuploadBtn] }, {});
    assert.deepEqual(res, { state: "ready" });
  }

  // 2) Permanent '重新上传' alone without failure phrase returns pending (NEVER false-fail)
  {
    const reuploadBtn = makeNode({ tag: "span", text: "重新上传" });
    const res = runProbeWithDom({ videos: [], nodes: [reuploadBtn] }, {});
    assert.deepEqual(res, { state: "pending" });
  }

  // 3) Visible '上传失败，请重新上传' returns failed; waitForDyUploadReady requires 2 consecutive ticks
  {
    const failBadge = makeNode({ tag: "div", text: "上传失败，请重新上传" });
    assert.deepEqual(
      runProbeWithDom({ videos: [], nodes: [failBadge] }, {}),
      { state: "failed", reason: "上传失败，请重新上传" }
    );

    // 1 fail tick then pending then ready -> must NOT fail!
    let tick = 0;
    const states = [
      { state: "failed", reason: "上传失败" },
      { state: "pending" },
      { state: "ready" },
    ];
    const recoveringPage = {
      url: () => "https://creator.douyin.com/creator-micro/content/upload",
      evaluate: async () => states[tick++] || { state: "ready" },
      waitForTimeout: async () => {},
    };
    await waitForDyUploadReady(recoveringPage, { title: "测试标题" }, { totalMs: 5000, stepMs: 1 });
    assert.equal(tick, 3);

    // 2 consecutive fail ticks -> fail fast!
    let failTicks = 0;
    const failingPage = {
      url: () => "https://creator.douyin.com/creator-micro/content/upload",
      evaluate: async () => {
        failTicks++;
        return { state: "failed", reason: "上传失败，请重新上传" };
      },
      waitForTimeout: async () => {},
    };
    await assert.rejects(
      waitForDyUploadReady(failingPage, { title: "测试标题" }, { totalMs: 5000, stepMs: 1 }),
      /抖音视频上传失败.*上传失败，请重新上传/
    );
    assert.equal(failTicks, 2);
  }

  // 4) User title/description containing '上传失败' mirrored in phone preview does NOT false-trigger
  {
    const title = "为什么抖音视频总是上传失败？排查教程";
    const mirrored = makeNode({ tag: "div", text: title });
    const res = runProbeWithDom(
      { videos: [], nodes: [mirrored] },
      {
        titlePrefix: title.slice(0, 12),
        descPrefix: "",
        submittedTitleNorm: title,
        submittedDescNorm: "",
      }
    );
    assert.deepEqual(res, { state: "pending" });
  }

  // 5) 发文助手 panel and transient '网络异常，正在重试' do NOT false-trigger
  {
    const assistant = makeNode({ tag: "div", text: "发文助手：上传失败常见问题" });
    const retrying = makeNode({ tag: "span", text: "网络异常，正在重试..." });
    const res = runProbeWithDom({ videos: [], nodes: [assistant, retrying] }, {});
    assert.deepEqual(res, { state: "pending" });
  }

  // 6) Mid-upload login redirect throws with loginRequired=true immediately
  {
    const page = {
      url: () => "https://passport.douyin.com/login?next=creator",
      evaluate: async () => ({ state: "pending" }),
      waitForTimeout: async () => {},
    };
    await assert.rejects(
      waitForDyUploadReady(page, { title: "测试" }, { totalMs: 5000, stepMs: 1 }),
      (err) => err.loginRequired === true && /登录状态已失效/.test(err.message)
    );
  }

  // 7) Full title readback catches 30-char truncation that 8-char matchesHead misses
  {
    const full33 = "Claude Ship上线！写代码审PR批合并，AI一条龙全包了？";
    const truncated30 = Array.from(full33).slice(0, 30).join("");
    assert.equal(countCodePoints(full33), 33);
    assert.equal(countCodePoints(truncated30), 30);
    assert.equal(isDyTitleComplete(truncated30, full33), false);
    assert.equal(isDyTitleComplete("Claude Ship上线！", "Claude Ship上线！"), true);
  }

  // 8) PLATFORM_TITLE_LIMITS + emoji code-point counting + validatePlatformTitle
  {
    assert.equal(PLATFORM_TITLE_LIMITS["抖音"], 30);
    assert.equal(PLATFORM_TITLE_LIMITS["小红书"], 20);
    const thirtyWithEmoji = "🔥" + "a".repeat(28) + "👇";
    assert.equal(countCodePoints(thirtyWithEmoji), 30);
    assert.equal(countTitleChars(`  ${thirtyWithEmoji}  `), 30);
    assert.equal(validatePlatformTitle("抖音", thirtyWithEmoji).ok, true);
    assert.equal(validatePlatformTitle("抖音", thirtyWithEmoji + "！").ok, false);
    assert.equal(validatePlatformTitle("哔哩哔哩", "长".repeat(50)).ok, true);
    assert.equal(validatePlatformTitle("小红书", "长".repeat(25)).ok, true);
    assert.equal(sliceCodePoints("🔥测试标题", 2), "🔥测");
  }

  // 9) findWorkByTitle handles Douyin "{title} {desc} #tags" and rejects short collisions
  {
    const works = [
      {
        workId: "1",
        title: "Antigravity报错无权使用？号没废！两招秒进满血版 实测有效 #AI编程 #Antigravity",
        itemTitle: "",
      },
      {
        workId: "2",
        title: "AI工具合集推荐 效率翻倍 #AI",
        itemTitle: "AI工具合集推荐",
      },
      {
        workId: "3",
        title: "无简介纯标题#话题",
      },
    ];
    assert.equal(
      findWorkByTitle(works, "Antigravity报错无权使用？号没废！两招秒进满血版").workId,
      "1"
    );
    assert.equal(findWorkByTitle(works, "AI工具合集推荐").workId, "2");
    assert.equal(findWorkByTitle(works, "无简介纯标题").workId, "3");
    assert.equal(findWorkByTitle(works, "AI"), null, "短词不应误匹配长标题前缀");
    assert.equal(findWorkByTitle(works, "AI工具"), null, "非词边界前缀不应误匹配");
  }

  console.log("test-dy-upload-failure: 全部断言通过");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
