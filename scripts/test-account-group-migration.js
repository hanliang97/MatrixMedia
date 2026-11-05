"use strict";

/**
 * 账号迁移 + 检索（新分组模型）端到端冒烟：
 *   - ensureAccountRecordsMigrated 给存量记录补齐 group/accountName/accountKey
 *   - 迁移后 partition 与历史规则逐字节一致（登录态不迁移）
 *   - findAccountRecordFlexible 匹配优先级：partition > phone 全字 > phone 前缀
 *   - resolveTaskPartition 按 accountKey 重算 CLI 兜底 partition
 *
 * changeData 在非 Electron 环境回落到 bundle 目录下的 data/，
 * 这里用 test/.cache 隔离，跑完自动清理。
 * 运行：node scripts/test-account-group-migration.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache/account-group-migration");
fs.rmSync(cache, { recursive: true, force: true });
fs.mkdirSync(cache, { recursive: true });

// electron 标记 external：非 Electron 运行时 app 为空，changeData 落到 bundle 目录 data/
function bundle(rel, outfile) {
  buildSync({
    entryPoints: [path.join(root, rel)],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile,
  });
  return require(outfile);
}

const migration = bundle(
  "src/main/services/accountMigration.js",
  path.join(cache, "migration.js")
);
const lookup = bundle(
  "src/main/services/accountLookup.js",
  path.join(cache, "lookup.js")
);

// changeData 的非 Electron 数据目录 = bundle 文件所在目录的 data/
const dataDir = path.join(cache, "data", "account");
fs.mkdirSync(dataDir, { recursive: true });

// 存量数据：老式 phone（无新字段），跨日期文件，含同分组两条记录与带 "-" 备注的账号
fs.writeFileSync(
  path.join(dataDir, "2026-06-16.json"),
  JSON.stringify(
    [
      { phone: "宠物", pt: "抖音", id: "a1", createTime: 1 },
      { phone: "宠物", pt: "视频号", id: "a2", createTime: 2 },
      { phone: "主号组-皇汉科技AI", pt: "抖音", id: "a3", createTime: 3 },
    ],
    null,
    2
  )
);
fs.writeFileSync(
  path.join(dataDir, "2026-09-23.json"),
  JSON.stringify(
    [
      { phone: "宠物", pt: "哔哩哔哩", id: "b1", createTime: 9 },
      {
        phone: "宠物-旺财",
        pt: "抖音",
        id: "b2",
        createTime: 10,
        group: "宠物",
        accountName: "旺财",
        accountKey: "旺财", // 已是新模型（模拟新版本添加的账号）
      },
    ],
    null,
    2
  )
);

/* ── 1. 迁移 ── */
const res = migration.ensureAccountRecordsMigrated();
assert.strictEqual(res.changed, 4, "应给 4 条老记录补齐新字段");
// 幂等
assert.strictEqual(migration.ensureAccountRecordsMigrated().changed, 0);

const read = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
const day1 = read("2026-06-16.json");
const day2 = read("2026-09-23.json");
const byId = {};
[...day1, ...day2].forEach((r) => (byId[r.id] = r));

// 老记录：group/accountKey = phone 前缀 → partition 与历史规则逐字节一致
assert.strictEqual(byId.a1.group, "宠物");
assert.strictEqual(byId.a1.accountKey, "宠物");
assert.strictEqual(byId.a3.group, "主号组");
assert.strictEqual(byId.a3.accountName, "皇汉科技AI");
assert.strictEqual(byId.a3.accountKey, "主号组");
// 已是新模型的记录不被覆盖
assert.strictEqual(byId.b2.accountKey, "旺财");

/* ── 2. 检索优先级 ── */
// partition 精确匹配（新模型账号）
assert.strictEqual(
  lookup.findAccountRecordFlexible({
    partition: "persist:旺财抖音",
    pt: "抖音",
  }).id,
  "b2"
);
// phone 全字匹配（新模型账号）
assert.strictEqual(
  lookup.findAccountRecordFlexible({ phone: "宠物-旺财", pt: "抖音" }).id,
  "b2"
);
// 老记录 partition 匹配（迁移后 accountKey = 前缀，与历史规则拼出的分区一致）
assert.strictEqual(
  lookup.findAccountRecordFlexible({
    partition: "persist:主号组抖音",
    pt: "抖音",
  }).id,
  "a3"
);
// phone 前缀匹配兜底（老调用方式）
assert.strictEqual(
  lookup.findAccountRecordFlexible({ phone: "主号组-随便什么", pt: "抖音" })
    .id,
  "a3"
);
// 平台不匹配不命中
assert.strictEqual(
  lookup.findAccountRecordFlexible({ phone: "宠物-旺财", pt: "快手" }),
  null
);

/* ── 3. resolveTaskPartition：CLI 兜底 partition 重算 ── */
// CLI 传完整 phone（新模型账号）→ 按 accountKey 重算
assert.strictEqual(
  lookup.resolveTaskPartition({
    partition: "persist:宠物抖音", // 历史规则兜底值
    phone: "宠物-旺财",
    pt: "抖音",
  }),
  "persist:旺财抖音"
);
// 老账号重算结果不变
assert.strictEqual(
  lookup.resolveTaskPartition({ phone: "主号组-皇汉科技AI", pt: "抖音" }),
  "persist:主号组抖音"
);
// 未命中记录（账号不存在）→ 原样保留输入
assert.strictEqual(
  lookup.resolveTaskPartition({
    partition: "persist:外部账号抖音",
    pt: "抖音",
  }),
  "persist:外部账号抖音"
);

fs.rmSync(cache, { recursive: true, force: true });
console.log("test-account-group-migration: 全部通过");
