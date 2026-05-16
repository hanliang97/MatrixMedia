"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const logFileBundle = path.join(outDir, "mainProcessLogFile.cjs");

buildSync({
  entryPoints: [path.join(root, "src/main/services/mainProcessLogFile.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: logFileBundle,
});

const {
  clearMainProcessLogFile,
  getMainProcessLogDir,
  getMainProcessLogFilePath,
} = require(logFileBundle);

function todayLogName() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}.log`;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "matrixmedia-log-test-"));
const app = {
  getPath(name) {
    assert.strictEqual(name, "logs");
    return tempDir;
  },
};

try {
  assert.strictEqual(getMainProcessLogDir(app), tempDir);
  assert.strictEqual(
    getMainProcessLogFilePath(app),
    path.join(tempDir, todayLogName())
  );

  fs.writeFileSync(path.join(tempDir, "2026-05-15.log"), "old");
  fs.writeFileSync(path.join(tempDir, todayLogName()), "today");
  fs.writeFileSync(path.join(tempDir, "keep.txt"), "keep");

  clearMainProcessLogFile(app);

  assert.strictEqual(fs.existsSync(path.join(tempDir, "2026-05-15.log")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, todayLogName())), false);
  assert.strictEqual(fs.readFileSync(path.join(tempDir, "keep.txt"), "utf8"), "keep");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("test:main-process-log-file 全部通过");
