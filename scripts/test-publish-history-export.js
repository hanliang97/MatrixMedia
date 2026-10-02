"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSync } = require("esbuild");
const outDir = path.join(__dirname, "../test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "publishHistoryExport.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/main/services/publishHistoryExport.js")],
  bundle: true, platform: "node", format: "cjs", outfile });
const { createPublishHistoryExportHandler } = require(outfile);

async function main() {
  const writes = [];
  let dialogs = 0;
  let canceled = false;
  let fail = false;
  const handler = createPublishHistoryExportHandler({
    BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => "documents" },
    dialog: { showSaveDialog: async () => { dialogs++; return { canceled, filePath: "chosen.csv" }; } },
    fileSystem: { promises: { writeFile: async (...args) => {
      if (fail) throw new Error("disk full");
      writes.push(args);
    } } },
  });
  const event = { sender: {}, senderFrame: { url: "file:///app/index.html" } };
  const csv = "\uFEFF标题\r\n";
  assert.deepStrictEqual(await handler(event, { csv }), { ok: true });
  assert.deepStrictEqual(writes, [["chosen.csv", csv, "utf8"]]);
  canceled = true;
  assert.deepStrictEqual(await handler(event, { csv }), { ok: false, canceled: true });
  assert.strictEqual(writes.length, 1);
  canceled = false;
  fail = true;
  assert.strictEqual((await handler(event, { csv })).message, "disk full");
  for (const args of [null, {}, { csv: 42 }, { csv: "x".repeat(20 * 1024 * 1024 + 1) }]) {
    assert.strictEqual((await handler(event, args)).ok, false);
  }
  const previousDialogs = dialogs;
  for (const url of ["https://creator.douyin.com", "http://localhost.evil/", "file://remote/app.html", ""]) {
    assert.strictEqual((await handler({ senderFrame: { url } }, { csv })).ok, false);
  }
  assert.strictEqual(dialogs, previousDialogs, "外部页面及无效请求不应弹出保存窗口");
  console.log("test-publish-history-export: 全部断言通过");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
