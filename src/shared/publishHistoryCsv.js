"use strict";

const HEADERS = ["日期", "标题", "平台", "发布分组", "发布状态", "尝试次数",
  "重发次数", "成功次数", "失败次数", "异常次数", "最后消息", "最后更新时间"];
const STATUS_TEXT = {
  success: "成功", failed: "失败", fail: "失败", abnormal: "发布异常",
  publishing: "发布中", drafting: "保存草稿中", draft: "已保存草稿",
  scheduled: "等待定时发布", expired: "任务过期", skipped: "已跳过",
};

function csvCell(value) {
  let text = value == null ? "" : String(value);
  // 标题等用户输入不能被 Excel 当成公式执行，引用符不能防止公式注入。
  if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function timestamp(value) {
  if (!value) return "";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** 导出当前加载的发布历史，一个平台一行，仅包含可见业务字段。 */
export function buildPublishHistoryCsv(dataList = {}) {
  const lines = [HEADERS.map(csvCell).join(",")];
  let recordCount = 0;
  for (const [date, rows] of Object.entries(dataList)) {
    for (const row of rows || []) {
      for (const item of row.showAlltype || [row]) {
        const values = [date, item.bt || item.title || item.textOtherName || "",
          item.pt, item.phone, STATUS_TEXT[item.publishStatus] || item.publishStatus || "未知",
          count(item.publishAttemptCount), count(item.republishCount),
          count(item.publishSuccessCount), count(item.publishFailCount),
          count(item.publishAbnormalCount), item.lastPublishMessage,
          timestamp(item.lastPublishAt)];
        lines.push(values.map(csvCell).join(","));
        recordCount++;
      }
    }
  }
  // UTF-8 BOM 保证 Windows Excel 正确显示中文。
  return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", recordCount };
}
