"use strict";

// CLI 对外入口 + 真实临时 JSON 存储；仅替代 Electron 和外部发布浏览器边界。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const xlsx = require("xlsx");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-waiting-cli-"));
const cache = path.join(root, "test/.cache/waiting-confirmation");
fs.mkdirSync(cache, { recursive: true });
const tasks = [];
global.__waitingCli = { temp, tasks };
const bundle = build({ entryPoints: [path.join(root, "src/main/cli/index.js")], bundle: true,
  platform: "node", format: "cjs", packages: "external", outfile: path.join(cache, "cli.cjs"),
  plugins: [{ name: "external-runtime", setup(build) {
    build.onResolve({ filter: /^electron$/ }, args => ({ path: args.path, namespace: "runtime" }));
    build.onLoad({ filter: /.*/, namespace: "runtime" }, () => ({ contents:
      `exports.app=Object.assign(new (require('events').EventEmitter)(),{getPath:name=>require('path').join(global.__waitingCli.temp,name)});
       exports.ipcMain={on(){}};` }));
    build.onResolve({ filter: /puppeteerFile$/ }, () => ({ path: "browser", namespace: "browser" }));
    build.onLoad({ filter: /.*/, namespace: "browser" }, () => ({ contents:
      "exports.runPuppeteerTask=(task,transport)=>global.__waitingCli.tasks.push({task,transport});" }));
  } }] });
let runCliMain;
const logs = [];
const originalLog = console.log;
const argv = (...args) => ["electron", ".", "cli", ...args];
async function history() {
  const start = logs.length;
  assert.equal(await runCliMain(argv("history", "--all", "--json")), 0);
  return JSON.parse(logs.slice(start).find(line => line.startsWith("[")));
}
async function nextTask() {
  for (let i = 0; i < 100 && !tasks.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(tasks.length, "CLI 应提交一个发布浏览器任务");
  return tasks.shift();
}
async function main() {
  console.log = value => logs.push(String(value));
  try {
    await bundle;
    ({ runCliMain } = require(path.join(cache, "cli.cjs")));
    const single = path.join(temp, "single.mp4");
    fs.writeFileSync(single, "synthetic-video-fixture");
    let finished = false;
    const pending = runCliMain(argv("publish", "-p", "dy", "--phone", "fixture", "-f", single, "-t", "即时等待"))
      .then(code => { finished = true; return code; });
    const { task, transport } = await nextTask();
    transport.reply("puppeteerFile-progress", { ...task, phase: "waiting_confirmation" });
    assert.equal(finished, false);
    assert.equal((await history())[0].status, "waiting_confirmation");
    transport.reply("puppeteerFile-done", { ...task, status: true, outcome: "waiting_confirmation" });
    assert.equal(await pending, 4);
    const receipt = JSON.parse(logs.filter(line => line.startsWith('{"channel"')).at(-1));
    assert.equal(receipt.resultStatus, "needs_attention");
    assert.equal(receipt.publishMode, "publish");
    assert.equal(receipt.outcome, "waiting_confirmation");
    transport.reply("puppeteerFile-done", { ...task, status: true });
    assert.equal((await history())[0].status, "waiting_confirmation", "重复终结回执不能覆盖原结果");

    const batchDir = path.join(temp, "videos");
    fs.mkdirSync(batchDir);
    fs.writeFileSync(path.join(batchDir, "batch.mp4"), "synthetic-video-fixture");
    const config = path.join(temp, "batch.xlsx");
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([{ filename: "batch.mp4", title: "目录等待" }]), "任务");
    xlsx.writeFile(workbook, config);
    const batch = runCliMain(argv("publish", "-p", "dy", "--phone", "fixture", "--dir", batchDir, "--config", config));
    const next = await nextTask();
    next.transport.reply("puppeteerFile-progress", { ...next.task, phase: "waiting_confirmation" });
    next.transport.reply("puppeteerFile-done", { ...next.task, status: true, outcome: "waiting_confirmation" });
    assert.equal(await batch, 4, "目录任务等待确认也必须退出4，不能报成功");
    const summary = JSON.parse(logs.filter(line => line.startsWith('{"summary"')).at(-1));
    assert.equal(summary.succeeded, 0);
    assert.equal(summary.needsAttention, 1);
    assert.equal(summary.results[0].status, "needs_attention");
    const rows = await history();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.status === "waiting_confirmation" && row.successCount === 0));
    fs.writeFileSync(path.join(cache, "cli-result.json"), JSON.stringify({ single: receipt, batch: summary, history: rows }, null, 2));
  } finally {
    console.log = originalLog;
    fs.rmSync(temp, { recursive: true, force: true });
    delete global.__waitingCli;
  }
  console.log("CLI single/batch waiting_confirmation / exit4 / real history: passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
