/**
 * 数据趋势视图层单元测试（不依赖 Electron / DOM）：
 * 1. dailyToRows 排序与字段透传
 * 2. isCollected 采集态判据（plays/likes/comments 任一 >0 才算采过）
 * 3. pickDaily 缺日补齐：未采集日继承前一已采集日数值 + __filled 标记（折线连续、不画 0）
 * 4. pickDaily 窗口起点前无数据时留 __missing（不给值）
 *
 * 背景：daily 快照只在采集当天与 fans 历史回填时写入，主进程 readOverview 会把缺的指标补 0，
 * 直接按日期键渲染会把「没采集」画成「归零」。2026-11-06 断网未采集实证。
 *
 * 运行：yarn test:stats-trend
 */

"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});

const assert = require("assert");
const { dailyToRows, isCollected, pickDaily, pickWeekly, pickMonthly } = require("../src/renderer/views/dataStats/statsUtils");

/* ---------- 1. dailyToRows ---------- */
{
  const rows = dailyToRows({
    "2026-11-02": { plays: 10, fans: 1 },
    "2026-10-31": { plays: 5, fans: 0 },
    "2026-11-01": { fans: 0 },
  });
  assert.deepStrictEqual(
    rows.map((r) => r.date),
    ["2026-10-31", "2026-11-01", "2026-11-02"],
    "dailyToRows 必须按日期升序"
  );
  assert.strictEqual(rows[0].label, "10-31", "label 取 MM-DD");
  console.log("✓ dailyToRows 升序与 label");
}

/* ---------- 2. isCollected ---------- */
{
  assert.strictEqual(isCollected({ plays: 12 }), true, "有播放=采过");
  assert.strictEqual(isCollected({ plays: 0, likes: 1 }), true, "有点赞=采过");
  assert.strictEqual(isCollected({ plays: 0, comments: 2 }), true, "有评论=采过");
  assert.strictEqual(isCollected({ fans: 3 }), false, "只有 fans 的残缺日=未采集");
  assert.strictEqual(isCollected({ plays: 0, fans: 0 }), false, "全 0=未采集");
  assert.strictEqual(isCollected(null), false);
  assert.strictEqual(isCollected(undefined), false);
  console.log("✓ isCollected 判据");
}

/* ---------- 3. pickDaily 缺日补齐 ---------- */
{
  const data = {
    "2026-11-01": { plays: 100, fans: 10, likes: 2, comments: 1 },
    // 11-02 未采集（真实缺日）
    "2026-11-03": { plays: 160, fans: 12, likes: 3, comments: 1 },
    "2026-11-04": { fans: 12 }, // 只有 fans 的残缺日（fans 历史回填产物）
    "2026-11-05": { plays: 220, fans: 14, likes: 4, comments: 2 },
  };
  const rows = pickDaily(dailyToRows(data), 5); // 11-01 .. 11-05
  assert.strictEqual(rows.length, 5, "日视图固定铺满 count 天");
  assert.deepStrictEqual(
    rows.map((r) => r.date),
    ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"],
    "日期必须连续（含缺日）"
  );

  // 11-02：无数据 → 继承 11-01
  assert.strictEqual(rows[1].__filled, true, "缺日标记 __filled");
  assert.strictEqual(rows[1].plays, 100, "缺日沿用前一日数值");
  assert.strictEqual(rows[1].fans, 10, "缺日沿用前一日粉丝数");
  assert.strictEqual(rows[1].label, "11-02", "缺日 label 是当天");

  // 11-04：只有 fans 的残缺日 → 也算未采集，继承 11-03
  assert.strictEqual(rows[3].__filled, true, "残缺日按缺日处理");
  assert.strictEqual(rows[3].plays, 160, "残缺日沿用前一日播放");

  // 真实采集日保持原样（不被打标记）
  assert.strictEqual(rows[0].__filled, undefined);
  assert.strictEqual(rows[2].plays, 160);
  assert.strictEqual(rows[4].plays, 220);

  // 连续两日缺失时，第二日应继承同一个最近已采集日（而不是前一个补值日）
  const rows2 = pickDaily(
    dailyToRows({
      "2026-11-01": { plays: 100, fans: 10 },
      "2026-11-04": { plays: 200, fans: 20 },
    }),
    4
  );
  assert.deepStrictEqual(
    rows2.map((r) => r.plays),
    [100, 100, 100, 200],
    "连续缺日都用最近一次真实采集值"
  );
  console.log("✓ pickDaily 缺日补齐");
}

/* ---------- 4. 窗口起点前无数据 → __missing ---------- */
{
  const rows = pickDaily(dailyToRows({ "2026-11-05": { plays: 10, fans: 1 } }), 3);
  assert.deepStrictEqual(
    rows.map((r) => r.date),
    ["2026-11-03", "2026-11-04", "2026-11-05"]
  );
  assert.strictEqual(rows[0].__missing, true, "起点前无前一天可补 → __missing");
  assert.strictEqual(rows[0].plays, undefined, "缺省日不给数值（不画 0）");
  assert.strictEqual(rows[1].__missing, true);
  assert.strictEqual(rows[2].plays, 10);
  console.log("✓ 起点前缺省日 __missing");
}

/* ---------- 5. 周/月视图优先真实采集日 ---------- */
{
  const rows = dailyToRows({
    "2026-11-02": { plays: 100, fans: 10 },
    "2026-11-06": { fans: 3 }, // 同周残缺日，不能顶掉 11-02 的整周取值
  });
  const week = pickWeekly(rows, 13);
  assert.strictEqual(week.length, 1);
  assert.strictEqual(week[0].plays, 100, "周视图取周内最后一个真实采集日");
  assert.ok(week[0].label.endsWith("周"));

  const month = pickMonthly(rows, 12);
  assert.strictEqual(month.length, 1);
  assert.strictEqual(month[0].plays, 100, "月视图同样优先真实采集日");

  // 整周都没有采集时，退回最后一条（不留空）
  const onlyPartial = pickWeekly(dailyToRows({ "2026-11-06": { fans: 3 } }), 13);
  assert.strictEqual(onlyPartial.length, 1);
  assert.strictEqual(onlyPartial[0].fans, 3, "整周无采集时保留原始行兜底");
  console.log("✓ 周/月视图优先真实采集日");
}

/* ---------- 6. 空输入 ---------- */
{
  assert.deepStrictEqual(pickDaily([], 30), [], "无数据返回空数组");
  assert.deepStrictEqual(pickDaily(null, 30), []);
  console.log("✓ 空输入");
}

console.log("\n全部通过：stats 趋势视图（缺日补齐 / 残缺日 / 起点缺省）");
