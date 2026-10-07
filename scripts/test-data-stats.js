/**
 * 数据采集层单元测试（不依赖 Electron 运行环境）：
 * 1. 各平台适配器 collectScript 生成后可解析（语法检查）
 * 2. store.mergeDaily / mergeWorks 的合并与「发布增长封闭」逻辑
 *
 * 运行：yarn test:data-stats
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// mock electron.app（store.js 只用到 userData 路径）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm-stats-test-"));
require.cache[require.resolve("electron")] = {
  id: "electron",
  filename: "electron",
  loaded: true,
  exports: { app: { getPath: () => tmpRoot } },
};

const { ADAPTERS } = require("../src/main/services/dataStats/adapters.js");
const store = require("../src/main/services/dataStats/store.js");

/* ---------- 1. 适配器脚本语法 ---------- */
for (const [name, adapter] of Object.entries(ADAPTERS)) {
  const script = adapter.collectScript();
  assert(typeof script === "string" && script.length > 100, `${name} 脚本为空`);
  // new Function 仅做语法解析，不执行
  new Function(`return (${script});`);
  assert(adapter.landingPage.startsWith("https://"), `${name} 缺落地页`);
  console.log(`✓ ${name} 适配器脚本语法正确`);
}

/* ---------- 2. mergeDaily ---------- */
let daily = store.mergeDaily(
  "测试组",
  "抖音",
  { fans: 100, plays: 500, likes: 30, comments: 5, favorites: 2, shares: 1 },
  [{ date: "2026-10-01", value: 88 }, { date: "2026-10-02", value: 90 }],
  Date.now()
);
const today = store.todayStr();
assert.strictEqual(daily[today].fans, 100, "当日快照 fans 写入失败");
assert.strictEqual(daily["2026-10-01"].fans, 88, "粉丝历史回填失败");
// 回填不覆盖已有日期
daily = store.mergeDaily(
  "测试组",
  "抖音",
  { fans: 101 },
  [{ date: "2026-10-01", value: 999 }],
  Date.now()
);
assert.strictEqual(daily["2026-10-01"].fans, 88, "回填不应覆盖已有日期");
assert.strictEqual(daily[today].fans, 101, "当日快照应更新");
console.log("✓ mergeDaily：当日快照 + 历史回填补缺正确");

/* ---------- 3. mergeWorks 封闭逻辑 ---------- */
// 第一次采集：两个作品
store.mergeWorks("测试组", "抖音", [
  { workId: "A", title: "旧视频", publishTime: 1000, play: 50, like: 5, comment: 1, share: 0, favorite: 2, fansDelta: 3 },
  { workId: "B", title: "新视频", publishTime: 2000, play: 10, like: 0, comment: 0, share: 0, favorite: 0, fansDelta: 0 },
], 10000);
let works = store.readAccount("测试组", "抖音").works;
assert.strictEqual(works.length, 2);
assert.strictEqual(works.find((w) => w.workId === "B").closedStats, null, "最新作品不应被封闭");
assert.strictEqual(works.find((w) => w.workId === "A").closedStats, null, "首次导入时任何作品都不应被封闭");

// 第二次采集：出现新作品 C → B 应被封闭（封闭值为 B 当时累计）
store.mergeWorks("测试组", "抖音", [
  { workId: "A", title: "旧视频", publishTime: 1000, play: 60, like: 6, comment: 1, share: 0, favorite: 2, fansDelta: 3 },
  { workId: "B", title: "新视频", publishTime: 2000, play: 25, like: 4, comment: 1, share: 1, favorite: 1, fansDelta: 2 },
  { workId: "C", title: "最新视频", publishTime: 3000, play: 0, like: 0, comment: 0, share: 0, favorite: 0, fansDelta: 0 },
], 20000);
works = store.readAccount("测试组", "抖音").works;
const b = works.find((w) => w.workId === "B");
assert(b.closedStats, "B 应在 C 出现时封闭");
assert.strictEqual(b.closedStats.play, 25, "B 封闭值应取封闭时刻的累计值");
assert.strictEqual(b.play, 25, "B 当前值同步更新");
const c = works.find((w) => w.workId === "C");
assert.strictEqual(c.closedStats, null, "C 是最新作品，不封闭");
// 倒序展示：C 在最前
assert.strictEqual(works[0].workId, "C", "作品应按发布时间倒序");
console.log("✓ mergeWorks：新作品出现时封闭上一条，封闭值正确");

/* ---------- 4. readOverview 聚合 ---------- */
store.mergeDaily("测试组", "视频号", { fans: 50, plays: 100 }, [], Date.now());
const overview = store.readOverview();
assert.strictEqual(overview.daily[today].fans, 101 + 50, "总览应按账号求和");
assert.strictEqual(overview.daily[today].plays, 500 + 100);
assert(overview.accounts.length === 2, "accounts 列表应为 2 个账号");
assert(overview.accounts[0].latest, "accounts 应带最新快照");
console.log("✓ readOverview：全账号聚合正确");

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("\n全部通过");
