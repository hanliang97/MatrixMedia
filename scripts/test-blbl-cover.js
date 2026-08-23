"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");

async function main() {
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "test/.cache");
  const bundlePath = path.join(outDir, "blbl-cover.cjs");
  fs.mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, "src/main/services/upLoad/blbl.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundlePath,
  });

  const { findBlblCoverEntry } = require(bundlePath);
  const newCoverEntry = { textContent: "" };
  const fakeDocument = {
    querySelector(selector) {
      assert.strictEqual(selector, ".cover-empty");
      return newCoverEntry;
    },
  };

  assert.strictEqual(findBlblCoverEntry(fakeDocument), newCoverEntry);
  console.log("test-blbl-cover passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
