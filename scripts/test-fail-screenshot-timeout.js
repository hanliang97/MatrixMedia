"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSync } = require("esbuild");
const outDir = path.join(__dirname, "../test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "failureScreenshotTimeout.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/main/services/upLoad/failureScreenshot.js")],
  bundle: true, platform: "node", format: "cjs", outfile, external: ["electron"] });
const { withScreenshotTimeout, capturePublishFailureScreenshot } = require(outfile);

async function main() {
  assert.strictEqual(await withScreenshotTimeout(async () => "ready", 20), "ready");
  await assert.rejects(withScreenshotTimeout(() => { throw new Error("closed"); }, 20), /closed/);
  await assert.rejects(withScreenshotTimeout(() => new Promise(() => {}), 20), /截图超时/);
  let resolveLate;
  let writes = 0;
  const pending = new Promise((resolve) => { resolveLate = resolve; });
  const result = await capturePublishFailureScreenshot({ screenshot: () => pending }, {}, {
    dir: outDir, timeoutMs: 20,
    fs: { mkdirSync() {}, writeFileSync() { writes++; } },
  });
  assert.strictEqual(result, "", "截图卡住时应返回空路径，让失败回执继续");
  resolveLate(Buffer.from("late image"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(writes, 0, "已超时的截图即使晚到也不能写入文件");
  let rejectLate;
  const lateRejection = new Promise((_, reject) => { rejectLate = reject; });
  await assert.rejects(withScreenshotTimeout(() => lateRejection, 20), /截图超时/);
  rejectLate(new Error("CDP disconnected"));
  await new Promise((resolve) => setImmediate(resolve));
  console.log("test-fail-screenshot-timeout: 全部断言通过");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
