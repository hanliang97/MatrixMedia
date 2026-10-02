"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSync } = require("esbuild");
const outDir = path.join(__dirname, "../test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "telemetryPreferenceIpc.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/main/services/telemetryPreferenceIpc.js")],
  bundle: true, platform: "node", format: "cjs", outfile });
const { registerTelemetryPreferenceIpc } = require(outfile);
const handlers = new Map();
let writes = 0;
registerTelemetryPreferenceIpc({ handle: (name, handler) => handlers.set(name, handler) }, {
  getPreference: () => ({ enabled: false, enforcedByEnvironment: false }),
  setEnabled: (enabled) => {
    if (typeof enabled !== "boolean") throw new Error("布尔值");
    writes++;
    return { enabled, enforcedByEnvironment: false };
  },
});
const get = handlers.get("telemetry:get-preference");
const set = handlers.get("telemetry:set-enabled");
for (const url of ["file:///app/index.html", "http://localhost:9080/", "http://127.0.0.1:9080/"]) {
  const event = { senderFrame: { url } };
  assert.strictEqual(get(event).ok, true);
  assert.strictEqual(set(event, false).enabled, false);
  assert.strictEqual(set(event, "false").ok, false);
}
const previousWrites = writes;
for (const url of ["https://creator.douyin.com/", "http://localhost.evil/", "file://remote/app", "", "bad"]) {
  const event = { senderFrame: { url } };
  assert.strictEqual(get(event).ok, false);
  assert.strictEqual(set(event, true).ok, false);
}
assert.strictEqual(get({}).ok, false);
assert.strictEqual(writes, previousWrites);
console.log("test-telemetry-preference-ipc: 全部断言通过");
