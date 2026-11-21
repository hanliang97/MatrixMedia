"use strict";

// 验证视频管理「获取状态」命中后回写 publishStatus（#71）：
// 命中作品必须把「发布中」改成 success/draft 并递增成功数，
// 已有链接且已成功的记录不再重复核对，发布中超时的记录收敛为待核对。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const root = path.join(__dirname, "..");
  const vue = fs.readFileSync(
    path.join(root, "src/renderer/views/videoManager/index.vue"),
    "utf8"
  );
  const script = vue
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "")
    .replace("export default", "globalThis.component =");
  const importedNames = [
    ...vue.matchAll(/^import\s+([\s\S]*?)\s+from\s+["'][^"']+["'];/gm),
  ].flatMap((m) =>
    m[1]
      .replace(/[{}]/g, "")
      .split(",")
      .map((x) => x.trim().split(/\s+as\s+/).pop())
      .filter(Boolean)
  );
  const stubs = Object.fromEntries(
    importedNames.map((name) => [
      name,
      () => {
        throw new Error(`Unexpected unrelated dependency: ${name}`);
      },
    ])
  );
  stubs.ptConfig = { 哔哩哔哩: { listIndex: "https://member.bilibili.com/list" } };
  stubs.recordAccountKeyOf = (row) => String((row && row.accountKey) || (row && row.phone) || "");
  stubs.buildAccountPartitionOf = () => "test-partition";
  stubs.recordGroupOf = () => "test-group";

  const context = vm.createContext({ ...stubs });
  vm.runInContext(script, context);
  const component = context.component;

  const messages = [];
  const updates = [];
  const invokeCalls = [];
  const state = {
    statusLoadingMap: {},
    ptConfig: stubs.ptConfig,
    $set: (o, k, v) => {
      o[k] = v;
    },
    $message: {
      info: (x) => messages.push(["info", x]),
      success: (x) => messages.push(["success", x]),
      warning: (x) => messages.push(["warning", x]),
      error: (x) => messages.push(["error", x]),
    },
    initDataFiltered: () => {},
  };
  for (const [name, fn] of Object.entries(component.methods)) {
    state[name] = fn.bind(state);
  }

  context.dataRequest = async (req) => {
    if (req.type === "update") updates.push(req.item);
    return { data: {} };
  };
  context.ipcRenderer = {
    invoke: async (channel, args) => {
      invokeCalls.push({ channel, args });
      return {
        matches: { 0: { found: true, url: "https://www.bilibili.com/video/BV1" } },
        errors: [],
      };
    },
    on: () => {},
    removeListener: () => {},
  };

  // 场景 1：发布中的记录命中作品 → 回写 success + 成功数 +1 + 链接；
  // 已成功带链接的记录不再参与核对
  const rowA = {
    textType: "local",
    showAlltype: [
      {
        textType: "local",
        pt: "哔哩哔哩",
        title: "视频A",
        selectedFile: "a.mp4",
        publishStatus: "publishing",
        publishSuccessCount: 0,
      },
      {
        textType: "local",
        pt: "哔哩哔哩",
        title: "视频B",
        selectedFile: "b.mp4",
        publishStatus: "success",
        videoLink: "https://www.bilibili.com/video/BVold",
      },
    ],
  };
  updates.length = 0;
  invokeCalls.length = 0;
  await state.handleGetStatus(rowA);
  assert.equal(invokeCalls.length, 1, "只调一次 match-works");
  assert.equal(invokeCalls[0].args.tasks.length, 1, "已成功记录不重复核对");
  assert.equal(invokeCalls[0].args.tasks[0].title, "视频A");
  assert.equal(updates.length, 1, "命中记录回写一次");
  assert.equal(updates[0].publishStatus, "success", "命中必须回写 publishStatus");
  assert.equal(updates[0].publishSuccessCount, 1, "成功数递增");
  assert.equal(updates[0].videoLink, "https://www.bilibili.com/video/BV1", "写入作品链接");
  assert.equal(updates[0].status, true);
  assert.ok(updates[0].lastPublishMessage, "写入确认文案");

  // 场景 2：存草稿记录命中 → 回写 draft
  const rowDraft = {
    textType: "local",
    showAlltype: [
      {
        textType: "local",
        pt: "哔哩哔哩",
        title: "视频C",
        selectedFile: "c.mp4",
        publishStatus: "publishing",
        publishMode: "draft",
        publishSuccessCount: 2,
      },
    ],
  };
  updates.length = 0;
  invokeCalls.length = 0;
  await state.handleGetStatus(rowDraft);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].publishStatus, "draft", "草稿模式回写 draft");
  assert.equal(updates[0].publishSuccessCount, 3);

  // 场景 3：未命中 → 不改状态，只提示
  context.ipcRenderer = {
    invoke: async () => ({ matches: { 0: { found: false } }, errors: [] }),
    on: () => {},
    removeListener: () => {},
  };
  updates.length = 0;
  messages.length = 0;
  await state.handleGetStatus(rowA);
  assert.equal(updates.length, 0, "未命中不能改状态");
  assert.ok(messages.some(([kind]) => kind === "warning"), "未命中给出提示");

  // 场景 4：发布中超 10 分钟 → 展示层收敛为待核对；新鲜记录不受影响
  const stale = state.fillPublishStats({
    publishStatus: "publishing",
    lastPublishAt: Date.now() - 20 * 60 * 1000,
  });
  assert.equal(stale.publishStatus, "abnormal", "超时发布中收敛为待核对");
  assert.ok(stale.lastPublishMessage.includes("获取状态"), "收敛文案引导人工核对");
  const fresh = state.fillPublishStats({
    publishStatus: "publishing",
    lastPublishAt: Date.now() - 60 * 1000,
  });
  assert.equal(fresh.publishStatus, "publishing", "未超时保持发布中");
  const noTime = state.fillPublishStats({ publishStatus: "publishing" });
  assert.equal(noTime.publishStatus, "publishing", "无时间戳的历史记录不收敛");

  console.log("test-get-status-sets-publish-status passed (命中回写/草稿/未命中/超时收敛)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
