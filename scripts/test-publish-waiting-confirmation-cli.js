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
const allTasks = [];
const pendingCalls = [];
global.__waitingCli = { temp, tasks, allTasks };
const bundle = build({ entryPoints: [path.join(root, "src/main/cli/index.js")], bundle: true,
  platform: "node", format: "cjs", packages: "external", outfile: path.join(cache, "cli.cjs"),
  plugins: [{ name: "external-runtime", setup(build) {
    build.onResolve({ filter: /^electron$/ }, args => ({ path: args.path, namespace: "runtime" }));
    build.onLoad({ filter: /.*/, namespace: "runtime" }, () => ({ contents:
      `exports.app=Object.assign(new (require('events').EventEmitter)(),{getPath:name=>require('path').join(global.__waitingCli.temp,name)});
       exports.ipcMain={on(){}};` }));
    build.onResolve({ filter: /puppeteerFile$/ }, () => ({ path: "browser", namespace: "browser" }));
    build.onLoad({ filter: /.*/, namespace: "browser" }, () => ({ contents:
      "exports.runPuppeteerTask=(task,transport)=>{const item={task,transport};global.__waitingCli.tasks.push(item);global.__waitingCli.allTasks.push(item);};" }));
  } }] });
let runCliMain;
const logs = [];
const originalLog = console.log;
const argv = (...args) => ["electron", ".", "cli", ...args];
function publish(...args) {
  const promise = runCliMain(argv("publish", ...args));
  pendingCalls.push(promise);
  return promise;
}
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
    const pending = publish("-p", "dy", "--phone", "fixture", "-f", single, "-t", "即时等待")
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

    const attemptA = publish("-p", "dy", "--phone", "fixture", "-f", single, "-t", "并发A");
    const oldTask = await nextTask();
    const attemptB = publish("-p", "dy", "--phone", "fixture", "-f", single, "-t", "并发B");
    const currentTask = await nextTask();
    oldTask.transport.reply("puppeteerFile-progress", { ...oldTask.task, phase: "waiting_confirmation" });
    assert.equal((await history()).find(row => row.title === "并发B").status, "publishing", "旧任务进度不能覆盖重新登记的任务");
    oldTask.transport.reply("puppeteerFile-done", { ...oldTask.task, status: true });
    assert.equal(await attemptA, 0);
    assert.equal((await history()).find(row => row.title === "并发B").status, "publishing", "旧任务完成不能终结新任务");
    currentTask.transport.reply("puppeteerFile-done", { ...currentTask.task, status: true, outcome: "waiting_confirmation" });
    assert.equal(await attemptB, 4);

    const draftFile = path.join(temp, "draft.mp4");
    fs.writeFileSync(draftFile, "synthetic-video-fixture");
    const draftWait = publish("-p", "dy", "--phone", "fixture", "-f", draftFile, "-t", "草稿等待", "--draft");
    const draftTask = await nextTask();
    draftTask.transport.reply("puppeteerFile-done", { ...draftTask.task, status: true, outcome: "waiting_confirmation" });
    assert.equal(await draftWait, 4);
    const draftReceipt = JSON.parse(logs.filter(line => line.startsWith('{"channel"')).at(-1));
    assert.equal(draftReceipt.publishMode, "draft", "草稿等待不能丢失原保存意图");

    const batchDir = path.join(temp, "videos");
    fs.mkdirSync(batchDir);
    fs.writeFileSync(path.join(batchDir, "batch.mp4"), "synthetic-video-fixture");
    const config = path.join(temp, "batch.xlsx");
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([{ filename: "batch.mp4", title: "目录等待" }]), "任务");
    xlsx.writeFile(workbook, config);
    const batch = publish("-p", "dy", "--phone", "fixture", "--dir", batchDir, "--config", config);
    const next = await nextTask();
    next.transport.reply("puppeteerFile-progress", { ...next.task, phase: "waiting_confirmation" });
    next.transport.reply("puppeteerFile-done", { ...next.task, status: true, outcome: "waiting_confirmation" });
    assert.equal(await batch, 4, "目录任务等待确认也必须退出4，不能报成功");
    const summary = JSON.parse(logs.filter(line => line.startsWith('{"summary"')).at(-1));
    assert.equal(summary.succeeded, 0);
    assert.equal(summary.needsAttention, 1);
    assert.equal(summary.results[0].status, "needs_attention");
    const rows = await history();
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.status === "waiting_confirmation" && row.successCount === 0));
    fs.writeFileSync(path.join(batchDir, "draft-batch.mp4"), "synthetic-video-fixture");
    const draftBook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(draftBook, xlsx.utils.json_to_sheet([{ filename: "draft-batch.mp4", title: "目录草稿" }]), "任务");
    xlsx.writeFile(draftBook, config);
    const draftBatch = publish("-p", "dy", "--phone", "fixture", "--dir", batchDir, "--config", config, "--draft");
    const draftNext = await nextTask();
    draftNext.transport.reply("puppeteerFile-done", { ...draftNext.task, status: true, draftVerified: true });
    assert.equal(await draftBatch, 0);
    const draftRow = (await history()).find(row => row.title === "目录草稿");
    assert.equal(draftRow.status, "draft");
    assert.equal(draftRow.successCount, 1, "目录草稿与即时/定时的保存成功计数必须一致");
    fs.writeFileSync(path.join(cache, "cli-result.json"), JSON.stringify({ single: receipt, batch: summary, history: rows }, null, 2));
  } finally {
    for (const { task, transport } of allTasks) transport.reply("puppeteerFile-done", { ...task, skipped: true });
    await Promise.allSettled(pendingCalls);
    console.log = originalLog;
    fs.rmSync(temp, { recursive: true, force: true });
    delete global.__waitingCli;
  }
  console.log("CLI single/batch waiting_confirmation / exit4 / real history: passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
