"use strict";

/**
 * 账号身份（新分组模型）纯函数回归：
 *   - 老数据（phone 字符串 / 缺新字段的记录）分区与登录 flag 名必须与历史规则逐字节一致
 *   - 新字段（group / accountName / accountKey）取值与清洗规则
 *   - 迁移补字段幂等，且不改变存量 partition
 *   - 分组排序键按 group 聚合（同一分组多账号归同一键）
 * 运行：node scripts/test-account-identity.js
 */

const assert = require("assert");
const {
  legacyPhoneGroup,
  sanitizeAccountKey,
  deriveAccountKeyFromName,
  recordGroupOf,
  recordAccountNameOf,
  recordAccountKeyOf,
  buildAccountPartitionOf,
  accountLoginFlagNameOf,
  buildCompatPhone,
  normalizeAccountRecordFields,
} = require("../src/shared/accountIdentity.js");
const {
  buildGroupOrderMap,
} = require("../src/shared/accountGroupOrder.js");

/* ── 老数据兼容：分区必须与历史规则一致 ── */
assert.strictEqual(buildAccountPartitionOf("宠物", "抖音"), "persist:宠物抖音");
assert.strictEqual(
  buildAccountPartitionOf({ phone: "主号组-皇汉科技AI" }, "抖音"),
  "persist:主号组抖音"
);
assert.strictEqual(
  accountLoginFlagNameOf({ phone: "主号组-皇汉科技AI" }, "视频号"),
  "主号组视频号登录"
);
assert.strictEqual(accountLoginFlagNameOf("宠物", "哔哩哔哩"), "宠物哔哩哔哩登录");

/* ── 新字段取值 ── */
const rec = {
  phone: "宠物-旺财",
  group: "宠物",
  accountName: "旺财",
  accountKey: "旺财",
};
assert.strictEqual(recordGroupOf(rec), "宠物");
assert.strictEqual(recordAccountNameOf(rec), "旺财");
assert.strictEqual(recordAccountKeyOf(rec), "旺财");
assert.strictEqual(buildAccountPartitionOf(rec, "抖音"), "persist:旺财抖音");
assert.strictEqual(buildCompatPhone(rec), "宠物-旺财");
// 账号名与分组同名时 phone 不带后缀（与历史形态一致）
assert.strictEqual(
  buildCompatPhone({ group: "宠物", accountName: "宠物" }),
  "宠物"
);

/* ── 键清洗：partition 键不允许出现 "-" 与空白 ── */
assert.strictEqual(sanitizeAccountKey("旺 财-B"), "旺财B");
assert.strictEqual(deriveAccountKeyFromName("a-b c"), "abc");
assert.strictEqual(sanitizeAccountKey(""), "");

/* ── 迁移：补齐新字段，partition 不变，幂等 ── */
const legacyRow = { phone: "主号组-皇汉科技AI", pt: "抖音", id: "1" };
assert.strictEqual(normalizeAccountRecordFields(legacyRow), true);
assert.deepStrictEqual(
  {
    group: legacyRow.group,
    accountName: legacyRow.accountName,
    accountKey: legacyRow.accountKey,
  },
  { group: "主号组", accountName: "皇汉科技AI", accountKey: "主号组" }
);
// 关键约束：迁移后分区与迁移前历史规则完全一致（登录态不迁移）
assert.strictEqual(
  buildAccountPartitionOf(legacyRow, "抖音"),
  "persist:主号组抖音"
);
const before = JSON.stringify(legacyRow);
assert.strictEqual(normalizeAccountRecordFields(legacyRow), false);
assert.strictEqual(JSON.stringify(legacyRow), before);

const plainRow = { phone: "宠物", pt: "视频号", id: "2" };
normalizeAccountRecordFields(plainRow);
assert.strictEqual(plainRow.group, "宠物");
assert.strictEqual(plainRow.accountName, "宠物");
assert.strictEqual(plainRow.accountKey, "宠物");
assert.strictEqual(
  buildAccountPartitionOf(plainRow, "视频号"),
  "persist:宠物视频号"
);

/* ── 分组排序键：同一分组的所有账号（含同平台多账号）归同一键 ── */
const rawAccountData = {
  "2026-06-16": [
    { phone: "宠物-旺财", group: "宠物", accountKey: "旺财", groupOrder: 0 },
    { phone: "宠物-旺财2", group: "宠物", accountKey: "旺财2", groupOrder: 0 },
    { phone: "喵呼", group: "喵呼", accountKey: "喵呼", groupOrder: 1 },
  ],
};
const orderMap = buildGroupOrderMap(rawAccountData);
assert.deepStrictEqual(orderMap, { 宠物: 0, 喵呼: 1 });

/* ── 缺 phone 的记录安全返回空 ── */
assert.strictEqual(recordGroupOf(null), "");
assert.strictEqual(recordAccountKeyOf(undefined), "");
assert.strictEqual(buildAccountPartitionOf({}, "抖音"), "persist:抖音");

console.log("test-account-identity: 全部通过");
