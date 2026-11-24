"use strict";

/**
 * 验证抖音双封面（3:4 竖封面 + 4:3 横封面）槽位精准定位算法：
 * 1. 同槽嵌套 div > span 去重（不会把 1 个槽位算成 2 个）
 * 2. 竖封面上传后变为「编辑封面」，横封面变为无静态按钮文字的 4:3 img 预览盒时仍能命中横槽
 * 3. 显式排除竖封面中心坐标后绝不回点首槽（修复复现用例）
 * 4. 左右顺序反转（横封面在左、竖封面在右）也能按标签和纵横比选对
 * 5. 仅单槽存在时，带 excludeCenter 的横封面查询安全返回 null（绝不覆写竖槽）
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "dyCoverSlot.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/upLoad/dyCoverSlot.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const { pickDyCoverSlotCandidate } = require(bundle);

// 1. 复现今日真实场景：左侧竖槽（div+span 嵌套，上传后变为「编辑封面」）+ 右侧横槽（4:3 预览盒）
{
  const cands = [
    { id: 0, text: "编辑封面", localCtx: "竖封面3:4编辑封面", x: 120, y: 400, width: 108, height: 144, hasImg: true, isCoverBox: true },
    { id: 1, text: "编辑封面", localCtx: "编辑封面", x: 130, y: 460, width: 88, height: 24, hasImg: false, isCoverBox: false },
    { id: 2, text: "", localCtx: "横封面4:3", x: 260, y: 412, width: 160, height: 120, hasImg: true, isCoverBox: true },
  ];
  const p = pickDyCoverSlotCandidate(cands, "portrait");
  assert.ok(p, "应命中竖版槽位");
  assert.strictEqual(p.slotCount, 2, "嵌套元素应去重为 2 个槽位");
  assert.strictEqual(p.id, 0);

  const h = pickDyCoverSlotCandidate(cands, "horizontal", { x: p.cx, y: p.cy });
  assert.ok(h, "应命中右侧横版槽位");
  assert.strictEqual(h.id, 2, "横版槽位绝不能回点左侧竖版槽位");
  assert.ok(h.ratio > 1.2, `横版纵横比应 > 1.2，实得 ${h.ratio}`);
}

// 2. 即使两个槽位都丢了「竖封面/横封面」文字标签，仅靠 3:4 vs 4:3 几何比例也能精准分辨
{
  const cands = [
    { id: 10, text: "选择封面", localCtx: "封面", x: 100, y: 300, width: 180, height: 135, hasImg: false, isCoverBox: true }, // 左：4:3 横槽
    { id: 11, text: "选择封面", localCtx: "封面", x: 320, y: 290, width: 108, height: 144, hasImg: false, isCoverBox: true }, // 右：3:4 竖槽
  ];
  const p = pickDyCoverSlotCandidate(cands, "portrait");
  assert.strictEqual(p.id, 11, "顺序反转时竖版应按 3:4 比例命中 id=11");

  const h = pickDyCoverSlotCandidate(cands, "horizontal", { x: p.cx, y: p.cy });
  assert.strictEqual(h.id, 10, "顺序反转时横版应按 4:3 比例命中 id=10");
}

// 3. 页面真的只有一个封面槽位（无横槽）时，传 excludeCenter 必须返回 null，绝不覆写竖槽
{
  const cands = [
    { id: 0, text: "编辑封面", localCtx: "编辑封面", x: 120, y: 400, width: 108, height: 144, hasImg: true, isCoverBox: true },
    { id: 1, text: "编辑封面", localCtx: "编辑封面", x: 124, y: 460, width: 100, height: 24, hasImg: false, isCoverBox: false },
  ];
  const p = pickDyCoverSlotCandidate(cands, "portrait");
  assert.ok(p);
  const h = pickDyCoverSlotCandidate(cands, "horizontal", { x: p.cx, y: p.cy });
  assert.strictEqual(h, null, "仅有单槽位时必须返回 null，禁止覆写竖封面槽位");
}

console.log("test-dy-dual-cover-slot: 全部断言通过");
