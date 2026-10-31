"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
  // Node 20 的 require() 不支持 ESM 源码：显式补 preset-env(commonjs)，
  // .babelrc 只在 BABEL_ENV=renderer/web 下配置且 modules:false，默认不转模块
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});

/**
 * cli history 运行层回归（#47 / #49）：
 * 1. draft / drafting / abnormal / skipped 原样保留，不被成功计数兜底成 success
 * 2. 未知/缺失状态仍按计数兜底
 * 3. --status 新状态筛选、-p xhs / 小红书 平台筛选
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache");
fs.mkdirSync(cache, { recursive: true });
const outfile = path.join(cache, "history-status-test.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/cli/runHistoryCli.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile,
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-history-status-"));
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: { getPath: () => tmp } };
  return origLoad.call(this, request, ...rest);
};

const { runHistoryCli, normalizeStatus } = require(outfile);
const { parseHistoryArgs } = require("../src/main/cli/parseHistoryArgs.js");

function run(argv) {
  const parsed = parseHistoryArgs([...argv, "--json"]);
  assert.strictEqual(parsed.ok, true, `${argv.join(" ")}: ${parsed.error}`);
  const logs = [];
  const origLog = console.log;
  console.log = (t) => logs.push(t);
  try {
    assert.strictEqual(runHistoryCli(parsed.value), 0);
  } finally {
    console.log = origLog;
  }
  return JSON.parse(logs[0]);
}

try {
  const dir = path.join(tmp, "MatrixMedia/data/pushData");
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  fs.writeFileSync(
    path.join(dir, `${date}.json`),
    JSON.stringify([
      { id: "draft", pt: "抖音", publishStatus: "draft", publishSuccessCount: 1 },
      { id: "drafting", pt: "抖音", publishStatus: "drafting" },
      { id: "abnormal", pt: "快手", publishStatus: "abnormal", publishSuccessCount: 1 },
      { id: "skipped", pt: "快手", publishStatus: "skipped", publishSuccessCount: 1 },
      { id: "ok", pt: "小红书", publishStatus: "success", publishSuccessCount: 1 },
      { id: "legacy", pt: "小红书", publishSuccessCount: 1 },
    ])
  );

  const byId = Object.fromEntries(run([]).map((r) => [r.id, r.status]));
  assert.deepStrictEqual(byId, {
    draft: "draft",
    drafting: "drafting",
    abnormal: "abnormal",
    skipped: "skipped",
    ok: "success",
    legacy: "success",
  });

  // 草稿不能出现在 success 筛选里
  assert.deepStrictEqual(run(["-s", "success"]).map((r) => r.id).sort(), ["legacy", "ok"]);
  assert.deepStrictEqual(run(["-s", "draft"]).map((r) => r.id), ["draft"]);
  assert.deepStrictEqual(run(["-s", "发布异常"]).map((r) => r.id), ["abnormal"]);

  for (const p of ["xhs", "XHS", "小红书"]) {
    assert.deepStrictEqual(run(["-p", p]).map((r) => r.id).sort(), ["legacy", "ok"], p);
  }

  assert.strictEqual(normalizeStatus({ publishStatus: "fail" }), "failed");
  assert.strictEqual(normalizeStatus({ publishFailCount: 1 }), "failed");
  assert.strictEqual(normalizeStatus({}), "publishing");
} finally {
  Module._load = origLoad;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("history-status: ok");
