"use strict";

/**
 * 账号身份与分组：新「分组」模型的核心字段约定。
 *
 * 背景：历史上账号用 phone 字段承载分组语义（"分组名" 或 "分组名-备注"），
 * 登录态 partition = persist:<phone "-" 前缀><平台>，即「一个分组 × 平台只有
 * 一份登录态」。分组概念重写后：
 *
 *   - 分组（group）只是账号的组织容器，可改名，与登录态无关；
 *   - 登录态（partition / 登录 flag）按「平台账号身份」accountKey 键控：
 *     同一个平台账号挂在多个分组下也只共享一份登录态、一个出口 IP，
 *     不会再互相挤掉线；同一分组也能放多个同平台账号（各自独立分区）。
 *
 * 字段约定（账号记录 / 账号树 meta 通用）：
 *   phone        保留字段，继续写入（兼容旧版本 / CLI / 回滚），
 *                值 = accountName 与分组同名时的 "分组名"，否则 "分组名-账号名"
 *   group        分组名（新概念，支持改名）
 *   accountName  平台账号显示名；同一平台账号跨分组必须同名（登录态共享的依据）
 *   accountKey   登录主键（partition 键）。不得包含 "-"（历史 partition 规则
 *                按 "-" 裁剪，见 accountPartition.js）。老数据迁移时取
 *                phone "-" 前缀，保证存量登录态逐字节不变。
 *
 * 兼容规则：所有取值函数对「缺新字段的记录 / 纯 phone 字符串」回退到历史
 * phone "-" 前缀行为，因此旧数据与旧调用方零迁移即可正确工作。
 */

import { accountSessionKey } from "./accountPartition.js";

/**
 * 历史 phone 规则的登录主键（"-" 前缀）。
 * @param {string} phoneOrKey 账号 phone 或已是主键的字符串
 * @returns {string}
 */
export function legacyPhoneGroup(phoneOrKey) {
  return accountSessionKey(phoneOrKey).trim();
}

/**
 * 清洗出可安全用作 partition 键的账号标识。
 * partition 历史上按 "-" 裁剪（见 accountPartition.js），因此键内不允许出现
 * "-"；空白字符同样去掉，避免不同输入拼出同一 partition 却难以排查。
 * @param {string} name
 * @returns {string}
 */
export function sanitizeAccountKey(name) {
  return String(name || "")
    .replace(/[\s\-－—–]+/g, "")
    .trim();
}

/** 由账号显示名派生新账号的登录主键。派生失败（空）返回空串。 */
export function deriveAccountKeyFromName(accountName) {
  return sanitizeAccountKey(accountName);
}

/**
 * 取账号所属分组名。记录缺 group 字段时回退 phone "-" 前缀（历史行为）。
 * @param {object|string} recordOrPhone 账号记录（含新字段）或 phone 字符串
 * @returns {string}
 */
export function recordGroupOf(recordOrPhone) {
  if (!recordOrPhone) return "";
  if (typeof recordOrPhone !== "object") return legacyPhoneGroup(recordOrPhone);
  const group = String(recordOrPhone.group || "").trim();
  if (group) return group;
  return legacyPhoneGroup(recordOrPhone.phone);
}

/**
 * 取账号显示名。优先 accountName，其次 phone "-" 后缀（历史备注），最后分组名。
 * @param {object|string} recordOrPhone
 * @returns {string}
 */
export function recordAccountNameOf(recordOrPhone) {
  if (!recordOrPhone) return "";
  if (typeof recordOrPhone !== "object") return legacyPhoneGroup(recordOrPhone);
  const name = String(recordOrPhone.accountName || "").trim();
  if (name) return name;
  const phone = String(recordOrPhone.phone || "");
  const idx = phone.indexOf("-");
  if (idx > 0) {
    const suffix = phone.slice(idx + 1).trim();
    if (suffix) return suffix;
  }
  return recordGroupOf(recordOrPhone);
}

/**
 * 取账号登录主键（partition 键）。
 * 记录缺 accountKey 时回退 phone "-" 前缀 —— 与历史 partition 规则一致，
 * 保证未迁移记录的登录态不迁移、不丢。
 * @param {object|string} recordOrPhone
 * @returns {string}
 */
export function recordAccountKeyOf(recordOrPhone) {
  if (!recordOrPhone) return "";
  if (typeof recordOrPhone !== "object") return legacyPhoneGroup(recordOrPhone);
  const key = sanitizeAccountKey(recordOrPhone.accountKey);
  if (key) return key;
  return legacyPhoneGroup(recordOrPhone.phone);
}

/**
 * 按新模型拼账号在某平台的 session partition。
 * 与 buildAccountPartition（phone 字符串版）并存：本函数面向「账号记录」，
 * 有 accountKey 用 accountKey，否则回退历史 phone 前缀。
 * @param {object|string} recordOrPhone
 * @param {string} pt 平台名（如 抖音 / 视频号）
 * @returns {string} 如 "persist:旺财抖音"
 */
export function buildAccountPartitionOf(recordOrPhone, pt) {
  const key =
    typeof recordOrPhone === "object"
      ? recordAccountKeyOf(recordOrPhone)
      : legacyPhoneGroup(recordOrPhone);
  return "persist:" + key + String(pt || "");
}

/**
 * 账号在某平台的登录状态 flag 名（localStorage / document.cookie 共用）。
 * @param {object|string} recordOrPhone
 * @param {string} pt
 * @returns {string} 如 "旺财抖音登录"
 */
export function accountLoginFlagNameOf(recordOrPhone, pt) {
  const key =
    typeof recordOrPhone === "object"
      ? recordAccountKeyOf(recordOrPhone)
      : legacyPhoneGroup(recordOrPhone);
  return `${key}${String(pt || "")}登录`;
}

/**
 * 按新字段重建兼容 phone 值（旧版本程序 / CLI 仍按 phone 读写）。
 * 账号名与分组同名时不带后缀，保持与历史 "宠物" 形态一致。
 * @param {object} record
 * @returns {string}
 */
export function buildCompatPhone(record) {
  const group = recordGroupOf(record);
  if (!group) return "";
  const name = String(
    (record && typeof record === "object" && record.accountName) || ""
  ).trim();
  return name && name !== group ? `${group}-${name}` : group;
}

/**
 * 就地补齐账号记录的新字段（group / accountName / accountKey）。
 * 已有字段不覆盖；phone 不改写（迁移不改变任何存量值）。
 * 迁移派生规则：
 *   group       = phone "-" 前缀
 *   accountName = phone "-" 后缀（无后缀时 = 分组名）
 *   accountKey  = phone "-" 前缀   ← 关键：保证存量 partition 逐字节不变
 * @param {object} record
 * @returns {boolean} 是否有改动
 */
export function normalizeAccountRecordFields(record) {
  if (!record || typeof record !== "object") return false;
  let changed = false;
  if (!String(record.group || "").trim()) {
    record.group = legacyPhoneGroup(record.phone);
    changed = true;
  }
  if (!String(record.accountName || "").trim()) {
    record.accountName = recordAccountNameOf({
      ...record,
      accountName: "",
    });
    changed = true;
  }
  if (!sanitizeAccountKey(record.accountKey)) {
    record.accountKey = legacyPhoneGroup(record.phone);
    changed = true;
  }
  return changed;
}
