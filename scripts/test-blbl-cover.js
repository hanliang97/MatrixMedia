"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");

function createFakePage({
  states = [],
  onClickAttempt = null,
  sliderOk = true,
  closeOnWait = false,
} = {}) {
  let evalIndex = 0;
  let clickCount = 0;
  let domClickCount = 0;
  let sliderMoved = false;
  const warnings = [];

  const getState = () =>
    states[Math.min(evalIndex, states.length - 1)] || {
      autoCover: false,
      entry: false,
      dialogOpen: false,
    };

  const fakeElement = {
    asElement() {
      return this;
    },
    async evaluate(fn) {
      const src = fn.toString();
      if (src.includes("scrollIntoView")) return;
      if (src.includes("el.click")) {
        domClickCount += 1;
        if (onClickAttempt) onClickAttempt(clickCount + domClickCount, "dom");
      }
    },
    async click() {
      clickCount += 1;
      if (onClickAttempt) onClickAttempt(clickCount + domClickCount, "puppeteer");
    },
    async dispose() {},
  };

  const page = {
    mouse: {
      async move() {
        sliderMoved = true;
      },
      async down() {},
      async up() {},
    },
    async waitForTimeout() {},
    async evaluate(fn) {
      if (closeOnWait) {
        throw new Error(
          "Protocol error (Runtime.callFunctionOn): Target closed"
        );
      }
      const src = fn.toString();
      if (src.includes("activeElement")) return;
      if (src.includes(".button.submit")) return true;
      const st = getState();
      evalIndex += 1;
      if (src.includes("dialogOpen")) {
        return { dialogOpen: !!st.dialogOpen, autoCover: !!st.autoCover };
      }
      if (src.includes("entry")) {
        return { autoCover: !!st.autoCover, entry: !!st.entry };
      }
      return !!st.autoCover;
    },
    async evaluateHandle() {
      const st = getState();
      return st.entry ? fakeElement : { asElement: () => null, dispose: async () => {} };
    },
    async waitForSelector(sel) {
      if (sel === ".vue-slider-dot-handle" && sliderOk) {
        return {
          async boundingBox() {
            return { x: 100, y: 100, width: 20, height: 20 };
          },
        };
      }
      throw new Error(`Waiting for selector \`${sel}\` failed`);
    },
    stats: () => ({ clickCount, domClickCount, sliderMoved, warnings }),
  };

  return page;
}

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

  const {
    findBlblCoverEntry,
    hasBlblAutoCover,
    handleBlblCover,
    BLBL_COVER_ENTRY_TIMEOUT_MS,
    BLBL_COVER_DIALOG_OPEN_TIMEOUT_MS,
    BLBL_COVER_SLIDER_TIMEOUT_MS,
  } = require(bundlePath);

  // 1. 兼容原有入口选择器测试
  const newCoverEntry = { textContent: "" };
  const fakeDocument = {
    querySelector(selector) {
      assert.strictEqual(selector, ".cover-empty");
      return newCoverEntry;
    },
  };
  assert.strictEqual(findBlblCoverEntry(fakeDocument), newCoverEntry);

  // 2. 封面超时上限必须短于 30s，绝不再出现 5 分钟假死
  assert.ok(BLBL_COVER_ENTRY_TIMEOUT_MS <= 20000);
  assert.ok(BLBL_COVER_DIALOG_OPEN_TIMEOUT_MS <= 10000);
  assert.ok(BLBL_COVER_SLIDER_TIMEOUT_MS <= 15000);

  // 3. hasBlblAutoCover 判断：有 .cover-img 且无 .cover-empty 才算已自动生成
  assert.strictEqual(
    hasBlblAutoCover({
      querySelector: (s) =>
        s === ".cover-main"
          ? { querySelector: (c) => (c === ".cover-img" ? {} : null) }
          : null,
    }),
    true
  );
  assert.strictEqual(
    hasBlblAutoCover({
      querySelector: (s) =>
        s === ".cover-main"
          ? { querySelector: () => ({}) }
          : null,
    }),
    false
  );

  // 4. B 站已自动生成封面时立刻返回，不点 .cover-empty 也不干等
  {
    const page = createFakePage({
      states: [{ autoCover: true, entry: false, dialogOpen: false }],
    });
    await handleBlblCover(page, {
      entryTimeoutMs: 50,
      dialogOpenTimeoutMs: 30,
      pollIntervalMs: 5,
    });
    assert.strictEqual(page.stats().clickCount, 0);
    assert.strictEqual(page.stats().domClickCount, 0);
  }

  // 5. 复现今日卡死场景：第 1 次点击落空、第 2 次 DOM click 弹开窗口并完成滑块
  {
    let dialogOpen = false;
    const states = [
      { autoCover: false, entry: true, dialogOpen: false },
    ];
    const page = createFakePage({
      states,
      onClickAttempt(n, mode) {
        if (n === 2 && mode === "dom") {
          dialogOpen = true;
          states.push({ autoCover: false, entry: true, dialogOpen: true });
        }
      },
    });
    const origEval = page.evaluate.bind(page);
    page.evaluate = async (fn) => {
      const res = await origEval(fn);
      if (res && typeof res === "object" && "dialogOpen" in res) {
        return { ...res, dialogOpen };
      }
      return res;
    };
    await handleBlblCover(page, {
      entryTimeoutMs: 50,
      dialogOpenTimeoutMs: 20,
      openAttempts: 2,
      sliderTimeoutMs: 50,
      pollIntervalMs: 5,
    });
    assert.strictEqual(page.stats().clickCount, 1);
    assert.strictEqual(page.stats().domClickCount, 1);
    assert.strictEqual(page.stats().sliderMoved, true);
  }

  // 6. 两次点击都未弹出编辑框时，快速跳过不抛错、不卡死（继续走发布按钮）
  {
    const page = createFakePage({
      states: [{ autoCover: false, entry: true, dialogOpen: false }],
    });
    const started = Date.now();
    await handleBlblCover(page, {
      entryTimeoutMs: 50,
      dialogOpenTimeoutMs: 25,
      openAttempts: 2,
      pollIntervalMs: 5,
    });
    assert.ok(Date.now() - started < 1000, "弹窗未出现时必须快速跳过");
    assert.strictEqual(page.stats().clickCount, 1);
    assert.strictEqual(page.stats().domClickCount, 1);
  }

  // 7. 用户关窗（Target closed）必须向上抛出，绝不吞掉后继续点发布报错
  {
    const page = createFakePage({ closeOnWait: true });
    await assert.rejects(
      () =>
        handleBlblCover(page, {
          entryTimeoutMs: 50,
          dialogOpenTimeoutMs: 20,
          pollIntervalMs: 5,
        }),
      /Target closed/
    );
  }

  console.log("test-blbl-cover passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
