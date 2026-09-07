"use strict";

/**
 * 验证「点击发布后 5 秒页面地址未变化 → 发布异常」的判定与结果映射：
 * 1. replyPublishOutcome：地址未变化时上报 publishAbnormal，变化时上报成功
 * 2. 存草稿模式不做地址校验
 * 3. resolvePublishCompletion：publishAbnormal 降级为 abnormal，不计成功
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const outcomeBundle = path.join(outDir, "publishOutcome.cjs");
const resultBundle = path.join(outDir, "publishResult.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/services/upLoad/publishOutcome.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outcomeBundle,
  external: ["electron"],
});
buildSync({
  entryPoints: [path.join(root, "src/shared/publishResult.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: resultBundle,
});

const { replyPublishOutcome } = require(outcomeBundle);
const { resolvePublishCompletion } = require(resultBundle);

function createPage(urls) {
  let i = 0;
  return {
    url: () => urls[Math.min(i, urls.length - 1)],
    waitForTimeout: async () => {
      i += 1;
    },
  };
}

function createEvent() {
  const calls = [];
  return {
    calls,
    reply: (channel, payload) => calls.push({ channel, payload }),
  };
}

(async () => {
  // 1. 地址未变化 → 发布异常
  {
    const page = createPage(["https://x.com/publish", "https://x.com/publish"]);
    const event = createEvent();
    await replyPublishOutcome({
      page,
      data: { pt: "抖音", closeWindowAfterPublish: false },
      window: null,
      event,
      urlBefore: "https://x.com/publish",
      waitMs: 0,
    });
    const payload = event.calls[0].payload;
    assert.strictEqual(payload.status, true);
    assert.strictEqual(payload.publishAbnormal, true);
    assert.strictEqual(payload.outcome, "publish_abnormal");
    assert.ok(payload.message.includes("发布异常"));
  }

  // 2. 地址已跳到成功页 → 正常成功
  {
    const page = createPage(["https://x.com/publish", "https://x.com/success"]);
    const event = createEvent();
    await replyPublishOutcome({
      page,
      data: { pt: "抖音", closeWindowAfterPublish: false },
      window: null,
      event,
      urlBefore: "https://x.com/publish",
      waitMs: 0,
      successMessage: "上传成功",
    });
    const payload = event.calls[0].payload;
    assert.strictEqual(payload.status, true);
    assert.strictEqual(payload.publishAbnormal, undefined);
    assert.strictEqual(payload.message, "上传成功");
  }

  // 3. 存草稿不跳转，也不能判成异常
  {
    const page = createPage(["https://x.com/publish", "https://x.com/publish"]);
    const event = createEvent();
    await replyPublishOutcome({
      page,
      data: { pt: "抖音", closeWindowAfterPublish: false },
      window: null,
      event,
      urlBefore: "https://x.com/publish",
      isDraftMode: true,
      waitMs: 0,
      successMessage: "保存草稿成功",
    });
    const payload = event.calls[0].payload;
    assert.strictEqual(payload.publishAbnormal, undefined);
    assert.strictEqual(payload.message, "保存草稿成功");
  }

  // 4. 末尾斜杠差异不算跳转
  {
    const page = createPage([
      "https://x.com/publish",
      "https://x.com/publish/",
    ]);
    const event = createEvent();
    await replyPublishOutcome({
      page,
      data: { pt: "视频号", closeWindowAfterPublish: false },
      window: null,
      event,
      urlBefore: "https://x.com/publish",
      waitMs: 0,
    });
    assert.strictEqual(event.calls[0].payload.publishAbnormal, true);
  }

  // 5. 读不到地址时不误报异常
  {
    const page = { url: () => "", waitForTimeout: async () => {} };
    const event = createEvent();
    await replyPublishOutcome({
      page,
      data: { pt: "快手", closeWindowAfterPublish: false },
      window: null,
      event,
      urlBefore: "https://x.com/publish",
      waitMs: 0,
      successMessage: "上传成功",
    });
    assert.strictEqual(event.calls[0].payload.publishAbnormal, undefined);
  }

  // 6. 结果映射：异常不计成功
  {
    const abnormal = resolvePublishCompletion({
      status: true,
      publishAbnormal: true,
      needsAttention: true,
      message: "发布异常",
    });
    assert.strictEqual(abnormal.recordStatus, "abnormal");
    assert.strictEqual(abnormal.status, "publish_abnormal");
    assert.strictEqual(abnormal.savedAsDraft, false);
    assert.notStrictEqual(abnormal.exitCode, 0);

    const ok = resolvePublishCompletion({ status: true, message: "上传成功" });
    assert.strictEqual(ok.recordStatus, "success");
    assert.strictEqual(ok.exitCode, 0);
  }

  console.log("test-publish-abnormal: 全部断言通过");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
