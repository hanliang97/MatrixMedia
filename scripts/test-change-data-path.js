"use strict";

/**
 * 业务数据读写（POST /changeData → server/utils.changeData）入参校验回归测试。
 *
 * 背景（Issue #35「安全审计 · IPC / 本地 API 是否存在任意文件读写」）：
 * `changeData` 早期实现把调用方的 `fileName` 当数据文件夹名、`item.date` 当文件名，
 * 直接 `path.join(getDataDir(), ...)`。传入
 *
 *   { fileName: "../../../PWNED", type: "config", item: { action: "update", data: {...} } }
 *
 * 就能把 JSON 写到「文档/MatrixMedia/data」之外；`item.date` 同理可读写任意
 * `<name>.json`。这条路径除了渲染进程，`/changeData` 也对外暴露。
 *
 * 本测试锁住修复后的契约：
 *   1. 合法调用（account / pushData / config / 显式日期）行为不变；
 *   2. 穿越写法、非字符串、Windows 设备名、非法日历日期都被拒绝；
 *   3. 被拒绝的请求**零副作用**（不创建目录、不落盘）；
 *   4. 归一化后的名字与去重分支一致（'pushData ' 走真实 pushData 去重）；
 *   5. get / getDyData 只认 <YYYY-MM-DD>.json，且不跟随指向目录外的软链。
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundlePath = path.join(outDir, "serverUtils.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/server/utils.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
  external: ["electron"],
});

const { changeData } = require(bundlePath);

// 非 Electron 环境下 getDataDir() 回退到 <bundle 目录>/data
const dataDir = path.join(outDir, "data");
let outsideDir = "";
const today = new Date();
const pad = (n) => String(n).padStart(2, "0");
const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const cleanup = () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(path.join(root, "PWNED-ESCAPE"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "test/PWNED-ESCAPE"), { recursive: true, force: true });
  if (outsideDir) fs.rmSync(outsideDir, { recursive: true, force: true });
};

const run = () => {
  cleanup();
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-data-outside-"));

  /* ---------- 1. 合法读写仍然可用 ---------- */

  const added = changeData({
    fileName: "account",
    type: "add",
    item: { name: "测试账号", pt: "抖音" },
  });
  assert.strictEqual(added.success, true, "合法 add 失败: " + JSON.stringify(added));
  const dayFile = path.join(dataDir, "account", `${todayKey}.json`);
  assert.ok(fs.existsSync(dayFile), "合法 add 未写入当日文件");

  const read = changeData({ fileName: "account", type: "get", item: { pageSize: 10 } });
  assert.strictEqual(read.success, true);
  assert.ok(Array.isArray(read.data[todayKey]), "get 未返回当日数据");

  const cfg = changeData({
    fileName: "settings-test",
    type: "config",
    item: { action: "update", data: { theme: "dark" } },
  });
  assert.strictEqual(cfg.success, true);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(dataDir, "settings-test", "config.json"), "utf8")),
    { theme: "dark" }
  );

  // config 不消费日期：顺手带一个非法 date 也不该被牵连
  const cfgWithDate = changeData({
    fileName: "settings-test",
    type: "config",
    item: { action: "get", date: "../x" },
  });
  assert.strictEqual(cfgWithDate.success, true, "config 被无用的 date 误拒");

  // 显式合法日期照常落盘
  const dated = changeData({
    fileName: "account",
    type: "add",
    item: { id: "fixed", date: "2026-01-02" },
  });
  assert.strictEqual(dated.success, true);
  assert.ok(fs.existsSync(path.join(dataDir, "account", "2026-01-02.json")));

  /* ---------- 2. 非法 fileName：拒绝且零副作用 ---------- */

  const BAD_NAMES = [
    "../../../PWNED-ESCAPE",
    "../account",
    "..\\..\\PWNED-ESCAPE",
    "/tmp/PWNED-ESCAPE",
    "account/../../PWNED-ESCAPE",
    ".",
    "..",
    "",
    "   ",
    "a".repeat(80),
    "CON",
    "NUL",
    "con",
    "com1",
    "lpt9",
    123,
    true,
    null,
    undefined,
    {},
    ["account"],
  ];
  const before = fs.readdirSync(dataDir).sort();
  for (const fileName of BAD_NAMES) {
    const res = changeData({
      fileName,
      type: "config",
      item: { action: "update", data: { pwned: true } },
    });
    assert.strictEqual(res.success, false, `非法名称未被拒绝: ${JSON.stringify(fileName)}`);
    assert.ok(/非法/.test(res.message), `拒绝原因不明确: ${res.message}`);
  }
  assert.deepStrictEqual(fs.readdirSync(dataDir).sort(), before, "非法名称产生了目录副作用");
  assert.ok(!fs.existsSync(path.join(root, "PWNED-ESCAPE")), "fileName 穿越写出了文件");
  assert.ok(!fs.existsSync(path.join(root, "test/PWNED-ESCAPE")), "fileName 穿越写出了文件（test）");

  /* ---------- 3. 非法日期：拒绝且不创建目录 ---------- */

  const BAD_DATES = [
    "../../../x",
    "2026-1-1",
    "2026-01-01/../x",
    "2026-01-01.json",
    "2026-99-99",
    "2026-02-30",
    "0000-00-00",
    "2026-01-01\n",
    "２０２６-01-01",
    ["2026-01-02"],
    { toString: () => "2026-01-02" },
  ];
  BAD_DATES.forEach((date, index) => {
    const dirName = `date-guard-${index}`;
    const res = changeData({ fileName: dirName, type: "add", item: { id: "1", date } });
    assert.strictEqual(res.success, false, `非法日期未被拒绝: ${JSON.stringify(date)}`);
    assert.ok(/非法/.test(res.message), `拒绝原因不明确: ${res.message}`);
    assert.ok(
      !fs.existsSync(path.join(dataDir, dirName)),
      `非法日期仍然创建了目录: ${JSON.stringify(date)}`
    );
  });

  // update / delete 缺日期仍按原契约报「请指定日期」
  for (const type of ["update", "delete"]) {
    const res = changeData({ fileName: "account", type, item: { id: "1" } });
    assert.strictEqual(res.success, false);
    assert.ok(/请指定日期/.test(res.message), `${type} 缺日期提示变了: ${res.message}`);
  }

  /* ---------- 4. 归一化：'pushData ' 必须走真实 pushData 的去重分支 ---------- */

  const dupItem = {
    textOtherName: "同一集",
    pt: "抖音",
    textType: "local",
    selectedFile: "第01集.mp4",
  };
  const first = changeData({ fileName: "pushData", type: "add", item: { ...dupItem } });
  assert.strictEqual(first.success, true);
  const second = changeData({ fileName: "pushData ", type: "add", item: { ...dupItem } });
  assert.strictEqual(second.success, true);
  const pushDataList = JSON.parse(
    fs.readFileSync(path.join(dataDir, "pushData", `${todayKey}.json`), "utf8")
  );
  assert.strictEqual(
    pushDataList.length,
    1,
    `尾随空格绕过了去重：pushData 下有 ${pushDataList.length} 条`
  );
  assert.strictEqual(pushDataList[0].publishAttemptCount, 2, "去重合并未累加尝试次数");

  /* ---------- 5. 未知操作类型 ---------- */

  const bogus = changeData({ fileName: "account", type: "drop-database", item: {} });
  assert.strictEqual(bogus.success, false);
  assert.ok(/不支持的操作类型/.test(bogus.message));
  assert.ok(
    !fs.existsSync(path.join(dataDir, "drop-database")),
    "未知 type 产生了目录副作用"
  );

  /* ---------- 6. get / getDyData 不跟随目录外软链、只认日期文件 ---------- */

  const symDir = path.join(dataDir, "sym");
  fs.mkdirSync(symDir, { recursive: true });
  const outsideFile = path.join(outsideDir, "2026-01-01.json");
  fs.writeFileSync(outsideFile, JSON.stringify([{ id: "outside", name: "外部数据" }]));
  fs.symlinkSync(outsideFile, path.join(symDir, "2026-01-01.json"));
  fs.writeFileSync(path.join(symDir, "not-a-date.json"), JSON.stringify([{ id: "junk" }]));

  const symRead = changeData({ fileName: "sym", type: "get", item: { pageSize: 10 } });
  assert.strictEqual(symRead.success, true);
  assert.deepStrictEqual(symRead.data, {}, "get 跟随了目录外软链或读了非日期文件");
  assert.strictEqual(symRead.totalDays, 0);

  const symDy = changeData({
    fileName: "sym",
    type: "getDyData",
    item: { textOtherName: "外部数据" },
  });
  assert.strictEqual(symDy.success, false, "getDyData 读到了目录外软链内容");

  cleanup();
  console.log("test-change-data-path: 全部断言通过");
};

try {
  run();
} catch (err) {
  cleanup();
  throw err;
}
