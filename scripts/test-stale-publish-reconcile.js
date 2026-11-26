"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache");
fs.mkdirSync(cache, { recursive: true });

const reconcile = require(path.join(root, "src/main/services/publishReconcile.js"));
const shutdownBundle = path.join(cache, "cliShutdownGuard.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/cliShutdownGuard.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: shutdownBundle,
});

const registryBundle = path.join(cache, "publishWindowRegistry-reconcile.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/publishWindowRegistry.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: registryBundle,
});
const {
  listActivePublishWindows,
  cleanupCurrentProcessRegistry,
  registerPublishWindow,
} = require(registryBundle);

function formatDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-reconcile-"));
  const userDataDir = path.join(tmp, "userData");
  const pushDataDir = path.join(tmp, "docs/MatrixMedia/data/pushData");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(pushDataDir, { recursive: true });

  const now = Date.now();
  const today = formatDate(now);
  const yesterday = formatDate(now - 24 * 60 * 60 * 1000);
  const deadPid = 999999; // non-existent PID

  try {
    // 1) Dead PID reconciles matching publishing record, skips retried newer record & alive record,
    //    and resolves midnight-crossing entry without recordDate.
    fs.writeFileSync(
      path.join(pushDataDir, `${today}.json`),
      JSON.stringify([
        {
          id: "rec-dead",
          pt: "抖音",
          publishStatus: "publishing",
          publishFailCount: 0,
          lastPublishAt: now - 60000,
        },
        {
          id: "rec-retried",
          pt: "抖音",
          publishStatus: "publishing",
          publishFailCount: 0,
          // Newer retry started 60s after dead entry's startedAt -> must NOT be clobbered
          lastPublishAt: now - 5000,
        },
        {
          id: "rec-alive",
          pt: "抖音",
          publishStatus: "publishing",
          publishFailCount: 0,
          lastPublishAt: now - 60000,
        },
        {
          id: "rec-orphan-old",
          pt: "快手",
          publishStatus: "publishing",
          publishFailCount: 0,
          lastPublishAt: now - 5 * 60 * 60 * 1000,
        },
        {
          id: "rec-fresh",
          pt: "快手",
          publishStatus: "publishing",
          publishFailCount: 0,
          lastPublishAt: now - 10 * 60 * 1000,
        },
        {
          // Matches test-history-status.js timestamp-less fixture -> must stay drafting
          id: "rec-no-ts",
          pt: "抖音",
          publishStatus: "drafting",
        },
      ])
    );

    fs.writeFileSync(
      path.join(pushDataDir, `${yesterday}.json`),
      JSON.stringify([
        {
          id: "rec-midnight",
          pt: "抖音",
          publishStatus: "publishing",
          publishFailCount: 0,
          lastPublishAt: now - 23 * 60 * 60 * 1000,
        },
      ])
    );

    fs.writeFileSync(
      path.join(userDataDir, "active-publish-windows.json"),
      JSON.stringify([
        {
          key: "dead-1",
          pid: deadPid,
          recordId: "rec-dead",
          recordDate: today,
          startedAt: now - 60000,
        },
        {
          key: "dead-retried",
          pid: deadPid,
          recordId: "rec-retried",
          recordDate: today,
          startedAt: now - 120000,
        },
        {
          key: "dead-alive-id",
          pid: deadPid,
          recordId: "rec-alive",
          recordDate: today,
          startedAt: now - 60000,
        },
        {
          key: "alive-owner",
          pid: process.pid,
          recordId: "rec-alive",
          recordDate: today,
          startedAt: now - 30000,
        },
        {
          key: "dead-midnight",
          pid: deadPid,
          recordId: "rec-midnight",
          // No recordDate -> should search startedAt +/- 1 day
          startedAt: now - 20 * 60 * 60 * 1000,
        },
      ])
    );

    const res = reconcile.reconcileStalePushData({
      userDataDir,
      pushDataDir,
      nowMs: now,
    });
    assert.equal(res.deadReconciled, 2, "rec-dead and rec-midnight should reconcile");
    assert.equal(res.orphanReconciled, 1, "rec-orphan-old should reconcile");
    assert.equal(res.prunedRegistry, 4, "all 4 dead PID entries pruned");

    const todayList = JSON.parse(
      fs.readFileSync(path.join(pushDataDir, `${today}.json`), "utf8")
    );
    const byId = Object.fromEntries(todayList.map((r) => [r.id, r]));
    assert.equal(byId["rec-dead"].publishStatus, "failed");
    assert.equal(byId["rec-dead"].publishFailCount, 1);
    assert.match(byId["rec-dead"].lastPublishMessage, /异常退出/);
    assert.equal(byId["rec-retried"].publishStatus, "publishing");
    assert.equal(byId["rec-alive"].publishStatus, "publishing");
    assert.equal(byId["rec-orphan-old"].publishStatus, "failed");
    assert.equal(byId["rec-fresh"].publishStatus, "publishing");
    assert.equal(byId["rec-no-ts"].publishStatus, "drafting");

    const yList = JSON.parse(
      fs.readFileSync(path.join(pushDataDir, `${yesterday}.json`), "utf8")
    );
    assert.equal(yList[0].publishStatus, "failed");

    const regAfter = JSON.parse(
      fs.readFileSync(path.join(userDataDir, "active-publish-windows.json"), "utf8")
    );
    assert.equal(regAfter.length, 1);
    assert.equal(regAfter[0].key, "alive-owner");

    // 2) publishWindowRegistry listActivePublishWindows reconciles dead PID before pruning
    fs.writeFileSync(
      path.join(pushDataDir, `${today}.json`),
      JSON.stringify([
        {
          id: "rec-gui-poll",
          pt: "抖音",
          publishStatus: "publishing",
          publishFailCount: 0,
          lastPublishAt: now - 10000,
        },
      ])
    );
    fs.writeFileSync(
      path.join(userDataDir, "active-publish-windows.json"),
      JSON.stringify([
        {
          key: "dead-gui",
          pid: deadPid,
          recordId: "rec-gui-poll",
          recordDate: today,
          startedAt: now - 10000,
        },
      ])
    );
    const activeList = listActivePublishWindows({ userDataDir, pushDataDir });
    assert.equal(activeList.length, 0);
    const afterPoll = JSON.parse(
      fs.readFileSync(path.join(pushDataDir, `${today}.json`), "utf8")
    );
    assert.equal(afterPoll[0].publishStatus, "failed");

    // 3) registerPublishWindow persists recordDate and cleanupCurrentProcessRegistry removes PID
    const unregister = registerPublishWindow(
      { isDestroyed: () => false },
      { recordId: "rec-self", recordDate: today, taskId: "t-self", pt: "抖音" },
      { userDataDir, pushDataDir }
    );
    await new Promise((r) => setTimeout(r, 80));
    const regSelf = JSON.parse(
      fs.readFileSync(path.join(userDataDir, "active-publish-windows.json"), "utf8")
    );
    assert.equal(regSelf.length, 1);
    assert.equal(regSelf[0].recordDate, today);
    cleanupCurrentProcessRegistry(userDataDir);
    const regCleared = JSON.parse(
      fs.readFileSync(path.join(userDataDir, "active-publish-windows.json"), "utf8")
    );
    assert.equal(regCleared.length, 0);
    unregister();

    // 4) Subprocess SIGTERM triggers cooperative CLI publish shutdown guard synchronously
    const markerFile = path.join(tmp, "sigterm-marker.txt");
    const childCode = `
      const fs = require("fs");
      const { registerCliPublishShutdown } = require(${JSON.stringify(shutdownBundle)});
      registerCliPublishShutdown((reason, sig) => {
        fs.writeFileSync(${JSON.stringify(markerFile)}, sig + ":" + reason, "utf8");
      });
      console.log("READY");
      setInterval(() => {}, 1000);
    `;
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", childCode], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("READY")) {
          child.kill("SIGTERM");
        }
      });
      child.on("error", reject);
      child.on("close", (code) => resolve(code));
    });
    assert.equal(exitCode, 143);
    assert.ok(fs.existsSync(markerFile), "SIGTERM cleanup hook must execute synchronously");
    assert.match(fs.readFileSync(markerFile, "utf8"), /^SIGTERM:/);

    console.log("test-stale-publish-reconcile: 全部断言通过");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
