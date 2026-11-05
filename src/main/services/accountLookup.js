"use strict";

import { changeData } from "../server/utils.js";
import {
  buildAccountPartitionOf,
  legacyPhoneGroup,
  recordAccountKeyOf,
} from "../../shared/accountIdentity.js";

/**
 * 账号记录检索（新分组模型兼容层）。
 *
 * 匹配优先级（pt 必须一致）：
 *   1. phone 全字匹配：record.phone === phone
 *      —— CLI --phone 传完整 phone（如 "主号组-旺财"）时命中新账号，
 *         全字匹配无歧义，必须最先做（同一分组下老账号与新账号的
 *         历史规则兜底 partition 可能相同，partition 先行会命中错记录）；
 *   2. partition 精确匹配：buildAccountPartitionOf(record, pt) === partition
 *      —— GUI 发布/登录任务的 partition 由 accountKey 拼出，最可靠；
 *   3. phone "-" 前缀匹配：历史行为兜底（旧数据 / 旧调用方零迁移可用）。
 *
 * GUI 老数据迁移（accountMigration）后所有记录都带 accountKey，
 * 1/2 条即可命中；第 3 条保证未迁移数据与旧版调用方式继续工作。
 */

/**
 * 拉取全部账号记录（按日期文件聚合）。
 * @returns {Array<object>}
 */
export function listAllAccountRecords() {
  const result = changeData({
    fileName: "account",
    type: "get",
    item: { page: 1, pageSize: 9999 },
  });
  const data = (result && result.data) || {};
  const rows = [];
  // 日期文件按新到旧排序（changeData get 的文件序），同名记录取最新的
  const seen = new Map();
  for (const dateKey of Object.keys(data)) {
    for (const row of data[dateKey] || []) {
      if (!row || !row.phone || !row.pt) continue;
      const key = `${row.phone}__${row.pt}`;
      const prev = seen.get(key);
      if (!prev || (row.createTime || 0) > (prev.createTime || 0)) {
        seen.set(key, row);
      }
    }
  }
  seen.forEach((row) => rows.push(row));
  return rows;
}

/**
 * 查找账号记录。
 * @param {{ phone?: string, pt?: string, partition?: string }} query
 * @returns {object | null}
 */
export function findAccountRecordFlexible({ phone, pt, partition } = {}) {
  const platform = String(pt || "").trim();
  if (!platform) return null;
  const phoneStr = String(phone || "").trim();
  const partitionStr = String(partition || "").trim();
  if (!phoneStr && !partitionStr) return null;

  const rows = listAllAccountRecords();

  if (phoneStr) {
    for (const row of rows) {
      if (String(row.pt || "").trim() !== platform) continue;
      if (String(row.phone || "").trim() === phoneStr) return row;
    }
  }
  if (partitionStr) {
    for (const row of rows) {
      if (String(row.pt || "").trim() !== platform) continue;
      if (buildAccountPartitionOf(row, platform) === partitionStr) return row;
    }
  }
  if (phoneStr) {
    const key = legacyPhoneGroup(phoneStr);
    if (key) {
      for (const row of rows) {
        if (String(row.pt || "").trim() !== platform) continue;
        if (recordAccountKeyOf(row) === key) return row;
      }
    }
  }
  return null;
}

/**
 * 把任务携带的 partition / phone 规整为新模型下的标准 partition。
 * 命中账号记录时按记录的 accountKey 重算；未命中（新账号尚未添加、
 * 纯外部 partition 直传）时原样返回输入值。
 * @param {{ partition?: string, phone?: string, pt?: string }} task
 * @returns {string}
 */
export function resolveTaskPartition({ partition, phone, pt } = {}) {
  const platform = String(pt || "").trim();
  const record = findAccountRecordFlexible({ partition, phone, pt: platform });
  if (record) return buildAccountPartitionOf(record, platform);
  // 回退：历史规则（phone "-" 前缀 + 平台），保持老行为不变
  const input = String(partition || "").trim();
  if (input) return input;
  if (phone && platform) return "persist:" + legacyPhoneGroup(phone) + platform;
  return "";
}
