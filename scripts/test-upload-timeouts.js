"use strict";

const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache");
fs.mkdirSync(cache, { recursive: true });
const bundlePath = path.join(cache, "uploadTimeouts.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/upLoad/uploadTimeouts.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
});

const {
  PageClosedError,
  isPageClosed,
  isPageClosedError,
  assertPageOpen,
  pollPageUntil,
} = require(bundlePath);

async function main() {
  // 1) Truthy object return pass-through
  {
    let n = 0;
    const page = {
      isClosed: () => false,
      browser: () => ({ isConnected: () => true }),
      evaluate: async () => (++n >= 2 ? { ok: true, id: 42 } : false),
      waitForTimeout: async () => {},
    };
    const res = await pollPageUntil(page, () => {}, 5000, 1);
    assert.deepEqual(res, { ok: true, id: 42 });
    assert.equal(n, 2);
  }

  // 2) Immediate PageClosedError on page.isClosed() === true
  {
    const page = {
      isClosed: () => true,
      evaluate: async () => {
        throw new Error("should not evaluate");
      },
      waitForTimeout: async () => {},
    };
    assert.equal(isPageClosed(page), true);
    assert.throws(() => assertPageOpen(page), PageClosedError);
    await assert.rejects(
      pollPageUntil(page, () => true, 60000, 10),
      (err) => isPageClosedError(err) && err instanceof PageClosedError
    );
  }

  // 3) Immediate PageClosedError on browser.isConnected() === false
  {
    const page = {
      isClosed: () => false,
      browser: () => ({ isConnected: () => false }),
      evaluate: async () => true,
      waitForTimeout: async () => {},
    };
    await assert.rejects(
      pollPageUntil(page, () => true, 60000, 10),
      (err) => isPageClosedError(err)
    );
  }

  // 4) Fatal evaluate errors (Target closed / Session closed / Page crashed) abort immediately
  for (const msg of [
    "Protocol error (Runtime.callFunctionOn): Target closed.",
    "Session closed. Most likely the page has been closed.",
    "Page crashed!",
    "Connection closed",
  ]) {
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls++;
        throw new Error(msg);
      },
      waitForTimeout: async () => {},
    };
    await assert.rejects(
      pollPageUntil(page, () => true, 60000, 50),
      (err) => isPageClosedError(err)
    );
    assert.equal(calls, 1, `fatal error should not retry: ${msg}`);
  }

  // 5) Transient SPA context destroyed error continues polling and succeeds
  {
    let calls = 0;
    const page = {
      isClosed: () => false,
      evaluate: async () => {
        calls++;
        if (calls === 1) {
          throw new Error(
            "Execution context was destroyed, most likely because of a navigation."
          );
        }
        if (calls === 2) {
          throw new Error("Cannot find context with specified id");
        }
        return "ready";
      },
      waitForTimeout: async () => {},
    };
    const res = await pollPageUntil(page, () => {}, 5000, 1);
    assert.equal(res, "ready");
    assert.equal(calls, 3);
  }

  // 6) Early wake-up on page 'close' event during stepMs sleep without listener leak
  {
    const emitter = new EventEmitter();
    let closed = false;
    const page = {
      isClosed: () => closed,
      once: emitter.once.bind(emitter),
      off: emitter.off.bind(emitter),
      evaluate: async () => false,
      waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    const start = Date.now();
    setTimeout(() => {
      closed = true;
      emitter.emit("close");
    }, 30);
    await assert.rejects(
      pollPageUntil(page, () => false, 60000, 5000),
      (err) => isPageClosedError(err)
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `expected early wake-up, took ${elapsed}ms`);
    assert.equal(emitter.listenerCount("close"), 0, "close listener must be cleaned up");
  }

  // 7) String pageFn evaluated with zero extra args (xhs.js compatibility)
  {
    let receivedArgs = null;
    const page = {
      evaluate: async (...args) => {
        receivedArgs = args;
        return true;
      },
      waitForTimeout: async () => {},
    };
    await pollPageUntil(page, "(function(){return true;})()", 5000, 1);
    assert.equal(receivedArgs.length, 1);
    assert.equal(typeof receivedArgs[0], "string");
  }

  // 8) Minimal mock without isClosed / browser / once still works
  {
    let count = 0;
    const page = {
      evaluate: async () => ++count >= 2,
      waitForTimeout: async () => {},
    };
    const res = await pollPageUntil(page, () => {}, 5000, 1);
    assert.equal(res, true);
  }

  console.log("test-upload-timeouts: 全部断言通过");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
