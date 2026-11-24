/**
 * 抖音发布页双封面槽位（竖封面 3:4 / 横封面 4:3）精准定位纯算法。
 *
 * 解决三个真实 DOM 陷阱：
 * 1. 单个槽位内嵌套 div > span 文本相同，直接 filter 会把同一槽位计成 2 个元素；
 * 2. 向上爬 5 层父节点会爬入同时包含「竖封面」与「横封面」的共享容器，导致两槽标签互相污染；
 * 3. 竖封面上传完成后，横封面槽位可能已被自动生成预览图，不再显示「选择封面」静态文案，
 *    必须结合槽位自身纵横比（竖 w/h <= 0.92、横 w/h >= 1.08）以及排除已点击的竖封面坐标来定位。
 */

const PORTRAIT_TEXT_RE = /^(?:选择封面|编辑封面|修改封面|更换封面|设置竖封面|选择竖封面|上传竖封面)$/;
const HORIZONTAL_TEXT_RE = /^(?:选择封面|编辑封面|修改封面|更换封面|设置横封面|选择横封面|上传横封面|添加横封面|编辑横封面)$/;

function normText(t) {
  return String(t || "").replace(/\s+/g, "").trim();
}

/**
 * 从候选槽位列表中按坐标去重（中心点距离 < 35px 视为同一槽位，保留面积更贴合卡片者）
 * 并选出目标槽位（portrait 或 horizontal）。
 *
 * @param {Array<{
 *   id: number,
 *   text: string,
 *   localCtx: string,
 *   x: number,
 *   y: number,
 *   width: number,
 *   height: number,
 *   hasImg?: boolean,
 *   isCoverBox?: boolean,
 * }>} rawCandidates
 * @param {"portrait"|"horizontal"} targetKind
 * @param {{ x: number, y: number } | null} [excludeCenter]
 */
export function pickDyCoverSlotCandidate(
  rawCandidates,
  targetKind,
  excludeCenter = null
) {
  const valid = (rawCandidates || []).filter(
    (c) => c && c.width >= 30 && c.height >= 20 && c.width <= 460 && c.height <= 460
  );
  if (!valid.length) return null;

  // 1) 坐标去重：中心点在 35px 内归并为一个槽位；优先保留带明确局部标签或纵横比特征的节点
  const clusters = [];
  for (const c of valid) {
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    const ratio = c.height > 0 ? c.width / c.height : 1;
    const ctx = normText(c.localCtx);
    const txt = normText(c.text);
    const isHLabel =
      (ctx.includes("横封面") && !ctx.includes("竖封面")) ||
      txt.includes("横封面");
    const isVLabel =
      (ctx.includes("竖封面") && !ctx.includes("横封面")) ||
      txt.includes("竖封面");
    const isHShape = ratio >= 1.08 && c.width >= 60 && c.height >= 45;
    const isVShape = ratio <= 0.92 && c.width >= 45 && c.height >= 60;
    const item = {
      ...c,
      cx,
      cy,
      ratio: Number(ratio.toFixed(2)),
      txt,
      isHLabel,
      isVLabel,
      isHShape,
      isVShape,
    };

    const existing = clusters.find(
      (g) => Math.hypot(g.cx - cx, g.cy - cy) < 35
    );
    if (!existing) {
      clusters.push(item);
    } else {
      // 同一槽位保留更有区分度（带封面盒形状/局部标签/更大可点击区）的候选
      const score = (x) =>
        (x.isHLabel || x.isVLabel ? 4 : 0) +
        (x.isHShape || x.isVShape ? 3 : 0) +
        (x.isCoverBox ? 2 : 0) +
        (x.hasImg ? 1 : 0);
      if (score(item) > score(existing)) {
        Object.assign(existing, item);
      } else {
        // 合并互补信号（内层按钮有文字、外层封面盒有纵横比）
        existing.isHLabel = existing.isHLabel || item.isHLabel;
        existing.isVLabel = existing.isVLabel || item.isVLabel;
        existing.isHShape = existing.isHShape || item.isHShape;
        existing.isVShape = existing.isVShape || item.isVShape;
        if (item.isCoverBox && (item.isHShape || item.isVShape)) {
          existing.ratio = item.ratio;
          existing.width = item.width;
          existing.height = item.height;
        }
      }
    }
  }

  // 按页面从左到右、从上到下排序，保证兜底顺序确定
  clusters.sort((a, b) => (Math.abs(a.cy - b.cy) > 60 ? a.cy - b.cy : a.cx - b.cx));

  // 2) 若指定了已点击坐标（例如第一步已点竖封面），排除 35px 内的同一槽位，杜绝覆写首槽
  const pool = excludeCenter
    ? clusters.filter(
        (c) => Math.hypot(c.cx - excludeCenter.x, c.cy - excludeCenter.y) >= 35
      )
    : clusters;

  if (!pool.length) return null;

  if (targetKind === "horizontal") {
    const pick =
      pool.find((c) => c.isHLabel && c.isHShape) ||
      pool.find((c) => c.isHLabel) ||
      pool.find((c) => c.isHShape && !c.isVLabel) ||
      pool.find((c) => HORIZONTAL_TEXT_RE.test(c.txt) && !c.isVLabel) ||
      (excludeCenter ? pool[0] : pool.length >= 2 ? pool[1] : null);
    return pick
      ? {
          ...pick,
          slotCount: clusters.length,
          matchedBy: pick.isHLabel
            ? "label:横封面"
            : pick.isHShape
              ? `ratio:${pick.ratio}`
              : "distinct-second-slot",
        }
      : null;
  }

  const pick =
    pool.find((c) => c.isVLabel && c.isVShape) ||
    pool.find((c) => c.isVLabel) ||
    pool.find((c) => c.isVShape && !c.isHLabel) ||
    pool.find((c) => PORTRAIT_TEXT_RE.test(c.txt) && !c.isHLabel) ||
    pool[0];
  return pick
    ? {
        ...pick,
        slotCount: clusters.length,
        matchedBy: pick.isVLabel
          ? "label:竖封面"
          : pick.isVShape
            ? `ratio:${pick.ratio}`
            : "first-slot",
      }
    : null;
}
