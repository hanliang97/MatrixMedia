"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { buildSync } = require("esbuild");
const outDir = path.join(__dirname, "../test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "publishHistoryCsv.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/shared/publishHistoryCsv.js")],
  bundle: true, platform: "node", format: "cjs", outfile });
const { buildPublishHistoryCsv } = require(outfile);
const { csv, recordCount } = buildPublishHistoryCsv({ "2026-10-02": [{
  showAlltype: [
    { bt: '标题,"中文"\n第二行', pt: "抖音", publishStatus: "success",
      publishSuccessCount: 1, lastPublishAt: 0, cookies: "DO_NOT_EXPORT",
      selectedFile: "PRIVATE_FILE_PATH" },
    { bt: " =HYPERLINK(\"evil\")", pt: "哔哩哔哩", publishStatus: "abnormal",
      publishAbnormalCount: 2, lastPublishAt: "bad" },
  ],
} ] });
assert.strictEqual(recordCount, 2);
assert.ok(csv.startsWith("\uFEFF"));
assert.ok(csv.includes('"标题,""中文""\n第二行"'));
assert.ok(csv.includes('"\' =HYPERLINK(""evil"")"'));
assert.ok(csv.includes('"发布异常"'));
assert.ok(!csv.includes("DO_NOT_EXPORT") && !csv.includes("PRIVATE_FILE_PATH"));
assert.ok(csv.endsWith("\r\n"));
assert.strictEqual(buildPublishHistoryCsv().recordCount, 0);
const single = buildPublishHistoryCsv({ "2026-10-01": [{ bt: "独立记录", pt: "抖音",
  publishAttemptCount: -1, lastPublishAt: 1 }] });
assert.strictEqual(single.recordCount, 1);
assert.ok(single.csv.includes("1970-01-01T00:00:00.001Z"));
for (const title of ["+SUM(1)", "-2+3", "@SUM(1)", "\tformula", "\rformula"]) {
  assert.ok(buildPublishHistoryCsv({ day: [{ bt: title }] }).csv.includes('"\'' + title + '"'));
}
console.log("test-publish-history-csv: 全部断言通过");
