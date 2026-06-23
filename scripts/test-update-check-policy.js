const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { buildSync } = require("esbuild");

const bundlePath = path.join(__dirname, ".tmp-update-check-policy.cjs");
buildSync({
  entryPoints: [path.join(__dirname, "../src/renderer/components/title/updateCheckPolicy.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
});

const {
  UPDATE_CHECK_DATE_KEY,
  getUpdateCheckDate,
  shouldRunDailyUpdateCheck,
} = require(bundlePath);

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    data,
  };
}

try {
  assert.strictEqual(getUpdateCheckDate(new Date("2026-06-23T01:02:03")), "2026-06-23");

  const storage = createStorage();
  assert.strictEqual(
    shouldRunDailyUpdateCheck({
      storage,
      now: new Date("2026-06-23T08:00:00"),
    }),
    true
  );
  assert.strictEqual(storage.data[UPDATE_CHECK_DATE_KEY], "2026-06-23");
  assert.strictEqual(
    shouldRunDailyUpdateCheck({
      storage,
      now: new Date("2026-06-23T20:00:00"),
    }),
    false
  );
  assert.strictEqual(
    shouldRunDailyUpdateCheck({
      storage,
      now: new Date("2026-06-24T08:00:00"),
    }),
    true
  );
  assert.strictEqual(storage.data[UPDATE_CHECK_DATE_KEY], "2026-06-24");

  const brokenStorage = {
    getItem() {
      throw new Error("localStorage disabled");
    },
  };
  assert.strictEqual(
    shouldRunDailyUpdateCheck({
      storage: brokenStorage,
      now: new Date("2026-06-23T08:00:00"),
    }),
    true
  );

  console.log("test-update-check-policy: all assertions passed");
} finally {
  fs.rmSync(bundlePath, { force: true });
}
