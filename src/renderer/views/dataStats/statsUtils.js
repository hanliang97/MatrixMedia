/**
 * 数据统计页的纯函数工具：daily 对象 → 视图行（日/周/月聚合）。
 */

const DAY_MS = 86400000;

/** daily 对象 { "YYYY-MM-DD": {...} } → 按日期升序数组 [{ date, label, ... }] */
export function dailyToRows(daily) {
  return Object.keys(daily || {})
    .sort()
    .map((date) => ({ ...daily[date], date, label: date.slice(5) }));
}

/**
 * 该日是否真的采集过。
 * daily 快照只在采集当天与 fans 历史回填时写入；主进程 readOverview 会把缺的指标补 0，
 * 所以「有行」不等于「采过」——只有 fans 的残缺日（如 2026-11-06 视频号单点）必须当成未采集，
 * 否则折线会被画成归零、卡片 delta 会把缺日差值当成一天的增长。
 */
export function isCollected(row) {
  return !!row && (row.plays > 0 || row.likes > 0 || row.comments > 0);
}

/**
 * 日视图：以最后一条数据为终点，铺满 count 个自然日。
 * 未采集的那天用**前一个已采集日的数值补齐**（打 __filled 标记，图上画空心点 + tooltip 前缀 ≈），
 * 保证折线连续、趋势可读；daily.json 本身不动，补值只存在于视图层。
 * 窗口起点之前没有任何采集数据时仍留 __missing（不给值，不画 0）。
 */
export function pickDaily(rows, count = 30) {
  const list = rows || [];
  if (!list.length) return [];
  const byDate = new Map(list.map((r) => [r.date, r]));
  const end = new Date(list[list.length - 1].date + "T00:00:00");
  const start = new Date(end.getTime() - (count - 1) * DAY_MS);
  const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(
    start.getDate()
  ).padStart(2, "0")}`;
  let carry = null;
  list.forEach((r) => {
    if (r.date < startKey && isCollected(r)) carry = r;
  });
  const out = [];
  for (let k = count - 1; k >= 0; k--) {
    const d = new Date(end.getTime() - k * DAY_MS);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    const row = byDate.get(key);
    if (isCollected(row)) {
      carry = row;
      out.push(row);
    } else if (carry) {
      out.push({ ...carry, date: key, label: key.slice(5), __filled: true });
    } else {
      out.push({ date: key, label: key.slice(5), __missing: true });
    }
  }
  return out;
}

/** 周视图：按周（周一起）聚合取周末值，最近 weeks 周（约一个季度） */
export function pickWeekly(rows, weeks = 13) {
  const byWeek = new Map();
  rows.forEach((r) => {
    const d = new Date(r.date + "T00:00:00");
    const offset = (d.getDay() + 6) % 7; // 周一=0
    const monday = new Date(d.getTime() - offset * DAY_MS);
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, "0");
    const day = String(monday.getDate()).padStart(2, "0");
    // 周期取值优先真实采集日：缺日/残缺日只在整周都没有采集时兜底
    const wk = `${y}-${m}-${day}`;
    const cur = byWeek.get(wk);
    if (!cur || isCollected(r) || !isCollected(cur)) byWeek.set(wk, r);
  });
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-weeks)
    .map(([monday, r]) => ({ ...r, label: monday.slice(5) + " 周" }));
}

/** 月视图：按月聚合取月末值，最近 months 个月 */
export function pickMonthly(rows, months = 12) {
  const byMonth = new Map();
  rows.forEach((r) => {
    const mo = r.date.slice(0, 7);
    const cur = byMonth.get(mo);
    if (!cur || isCollected(r) || !isCollected(cur)) byMonth.set(mo, r);
  });
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-months)
    .map(([month, r]) => ({ ...r, label: month }));
}

/** 统计指标定义（卡片、折线图、柱状图共用） */
export const STATS_METRICS = [
  { key: "fans", label: "粉丝总数", color: "#409EFF" },
  { key: "likes", label: "点赞总数", color: "#F56C6C" },
  { key: "comments", label: "评论总数", color: "#E6A23C" },
  { key: "favorites", label: "收藏总数", color: "#67C23A" },
];
