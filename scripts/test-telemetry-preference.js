"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSync } = require("esbuild");
const outDir = path.join(__dirname, "../test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "telemetryPreference.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../src/main/services/telemetryPreference.js")],
  bundle: true, platform: "node", format: "cjs", outfile });
const { getTelemetryPreference, setTelemetryEnabled } = require(outfile);
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-telemetry-test-"));
const options = { configDir, env: {} };
try {
  assert.deepStrictEqual(getTelemetryPreference(options), { enabled: false, enforcedByEnvironment: false });
  assert.strictEqual(setTelemetryEnabled(false, options).enabled, false);
  const marker = path.join(configDir, "no-telemetry");
  fs.writeFileSync(marker, "用户内容");
  setTelemetryEnabled(false, options);
  assert.strictEqual(fs.readFileSync(marker, "utf8"), "用户内容");
  assert.strictEqual(setTelemetryEnabled(true, options).enabled, true);
  assert.ok(!fs.existsSync(marker));
  assert.ok(fs.existsSync(path.join(configDir, "telemetry-enabled")));
  setTelemetryEnabled(true, options);
  // 新进程读取相同配置目录时保留显式同意；旧禁用标记仍有最高优先级。
  assert.strictEqual(getTelemetryPreference({ configDir, env: {} }).enabled, true);
  fs.writeFileSync(marker, "用户禁用");
  assert.strictEqual(getTelemetryPreference(options).enabled, false);
  setTelemetryEnabled(false, options);
  assert.ok(!fs.existsSync(path.join(configDir, "telemetry-enabled")));
  assert.strictEqual(fs.readFileSync(marker, "utf8"), "用户禁用");
  setTelemetryEnabled(true, options);
  // 禁用标记即使是失效的符号链接也不能被当作“不存在”。
  if (process.platform !== "win32") {
    fs.symlinkSync(marker, marker);
    assert.strictEqual(getTelemetryPreference(options).enabled, false);
    fs.unlinkSync(marker);
  }
  const forced = { configDir, env: { MATRIXMEDIA_DISABLE_TELEMETRY: "1" } };
  assert.deepStrictEqual(getTelemetryPreference(forced), { enabled: false, enforcedByEnvironment: true });
  assert.throws(() => setTelemetryEnabled(true, forced), /环境变量/);
  assert.strictEqual(setTelemetryEnabled(false, forced).enabled, false);
  for (const invalid of ["false", 0, null, undefined]) {
    assert.throws(() => setTelemetryEnabled(invalid, options), /布尔值/);
  }
  assert.strictEqual(getTelemetryPreference({ configDir, env: { MATRIXMEDIA_DISABLE_TELEMETRY: " " } }).enforcedByEnvironment, false);
  console.log("test-telemetry-preference: 全部断言通过");
} finally {
  // 仅清理本测试创建的临时文件和空目录。
  for (const name of ["no-telemetry", "telemetry-enabled"]) {
    fs.rmSync(path.join(configDir, name), { force: true });
  }
  fs.rmdirSync(configDir);
}
