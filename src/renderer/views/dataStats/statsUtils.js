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

/** 日视图：最近 count 天 */
export function pickDaily(rows, count = 30) {
  return rows.slice(-count);
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
    byWeek.set(`${y}-${m}-${day}`, r); // 后写覆盖 → 周内最后一天
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
    byMonth.set(r.date.slice(0, 7), r); // 月内最后一天
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
