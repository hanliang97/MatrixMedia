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

  const {
    findBlblCoverEntry,
    findBlblCoverEditorTrigger,
    pickBlblCoverPath,
    extractBlblCoverBgUrl,
    uploadBlblCustomCover,
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

  // 2. pickBlblCoverPath：优先横版封面 horizontalCoverPath，缺省回退 coverPath
  assert.strictEqual(
    pickBlblCoverPath({
      coverPath: "/tmp/3x4.png",
      horizontalCoverPath: "/tmp/4x3.png",
    }),
    "/tmp/4x3.png"
  );
  assert.strictEqual(
    pickBlblCoverPath({ coverPath: "/tmp/3x4.png", horizontalCoverPath: "" }),
    "/tmp/3x4.png"
  );
  assert.strictEqual(pickBlblCoverPath({}), "");

  // 3. extractBlblCoverBgUrl：提取 B 站 .cover-img 的 background-image URL
  assert.strictEqual(
    extractBlblCoverBgUrl(
      'url("https://archive.biliimg.com/bfs/archive/abc123.jpg")'
    ),
    "https://archive.biliimg.com/bfs/archive/abc123.jpg"
  );
  assert.strictEqual(extractBlblCoverBgUrl("none"), "");
  assert.strictEqual(extractBlblCoverBgUrl(""), "");

  // 4. findBlblCoverEditorTrigger：无 .cover-empty 时能命中已有封面的 .cover-img .edit-text
  {
    const editText = { tag: "edit-text" };
    const doc = {
      querySelector: (sel) =>
        sel === ".cover-main .cover-img .edit-text" ? editText : null,
    };
    assert.strictEqual(findBlblCoverEditorTrigger(doc), editText);
  }

  // 5. uploadBlblCustomCover：支持「确认同步」二次确认兜底并校验 background-image 变更
  {
    const tmpCover = path.join(outDir, "fake-blbl-cover.png");
    fs.writeFileSync(
      tmpCover,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    const uploadedFiles = [];
    let finishClicks = 0;
    let syncModalConfirmed = false;
    let editorOpen = false;
    let bg = 'url("https://archive.biliimg.com/bfs/archive/old_auto.jpg")';

    const fakeTrigger = {
      asElement() {
        return this;
      },
      async evaluate() {},
      async click() {
        editorOpen = true;
      },
      async dispose() {},
    };
    const fakeFileInput = {
      asElement() {
        return this;
      },
      async uploadFile(p) {
        uploadedFiles.push(p);
      },
      async dispose() {},
    };

    const customPage = {
      async waitForTimeout() {},
      async evaluate(fn) {
        const src = fn.toString();
        if (src.includes("activeElement")) return;
        if (
          src.includes(
            'main.querySelector(".cover-empty") || main.querySelector(".cover-img")'
          )
        ) {
          return true;
        }
        if (src.includes("cover-editor-panel-canvas-title")) {
          // 模拟未预勾选「双比例同步改动」，触发「确认同步」兜底路径
          return false;
        }
        if (src.includes(".button.submit")) {
          finishClicks += 1;
          if (finishClicks >= 2 && syncModalConfirmed) {
            editorOpen = false;
            bg =
              'url("https://archive.biliimg.com/bfs/archive/new_custom_4x3.jpg")';
          }
          return { closed: !editorOpen, clicked: true };
        }
        if (src.includes("videoup-confirm-modal")) {
          if (finishClicks === 1 && !syncModalConfirmed) {
            syncModalConfirmed = true;
            return { editorOpen: true, modalOpen: true, synced: true };
          }
          return { editorOpen, modalOpen: false, synced: false };
        }
        if (src.includes("const bg = img")) {
          return { editorOpen, bg };
        }
        if (src.includes(".cover-main .cover-img")) {
          return bg;
        }
        if (src.includes(".cover-editor.bcc-dialog__wrap")) {
          return editorOpen;
        }
        return false;
      },
      async evaluateHandle(fn) {
        const src = fn.toString();
        if (src.includes('input[type="file"]')) return fakeFileInput;
        return fakeTrigger;
      },
    };

    await uploadBlblCustomCover(customPage, tmpCover, {
      entryTimeoutMs: 50,
      dialogOpenTimeoutMs: 50,
      verifyTimeoutMs: 100,
      pollIntervalMs: 5,
      settleWaitMs: 0,
      normalizeCover: async (p) => p,
    });
    assert.strictEqual(uploadedFiles.length, 1);
    assert.strictEqual(path.resolve(uploadedFiles[0]), path.resolve(tmpCover));
    assert.strictEqual(
      syncModalConfirmed,
      true,
      "未预勾选同步时应触发确认同步兜底"
    );
    assert.strictEqual(finishClicks, 2, "确认同步后应再次点击完成");

    // 6. 封面文件不存在时直接抛错中止，不静默跳过
    await assert.rejects(
      () => uploadBlblCustomCover(customPage, path.join(outDir, "missing.png")),
      /封面文件不存在/
    );

    fs.unlinkSync(tmpCover);
  }

  // 7. CLI / HTTP 三链路参数解析：--horizontal-cover 与 horizontalCover/horizontalCoverPath
  {
    const parseBundle = path.join(outDir, "blbl-parse-args.cjs");
    await build({
      entryPoints: [path.join(root, "src/main/cli/parsePublishArgs.js")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: parseBundle,
    });
    const {
      parsePublishArgs,
      parsePublishRequest,
      publishHelpText,
    } = require(parseBundle);

    const cliRes = parsePublishArgs([
      "-p",
      "blbl",
      "--phone",
      "13800138000",
      "-f",
      "/tmp/demo.mp4",
      "-t",
      "B站测试标题",
      "--cover",
      "/tmp/3x4.jpg",
      "--horizontal-cover",
      "/tmp/4x3.jpg",
    ]);
    assert.strictEqual(cliRes.ok, true);
    assert.strictEqual(cliRes.value.cover, "/tmp/3x4.jpg");
    assert.strictEqual(cliRes.value.horizontalCover, "/tmp/4x3.jpg");

    const aliasRes = parsePublishArgs([
      "-p",
      "blbl",
      "--phone",
      "13800138000",
      "-f",
      "/tmp/demo.mp4",
      "-t",
      "B站测试标题",
      "--cover-horizontal",
      "/tmp/4x3-alias.jpg",
    ]);
    assert.strictEqual(aliasRes.ok, true);
    assert.strictEqual(aliasRes.value.horizontalCover, "/tmp/4x3-alias.jpg");

    const httpRes = parsePublishRequest({
      platform: "blbl",
      phone: "13800138000",
      file: "/tmp/demo.mp4",
      title: "B站测试标题",
      coverPath: "/tmp/3x4.jpg",
      horizontalCover: "/tmp/4x3.jpg",
    });
    assert.strictEqual(httpRes.ok, true);
    assert.strictEqual(httpRes.value.cover, "/tmp/3x4.jpg");
    assert.strictEqual(httpRes.value.horizontalCover, "/tmp/4x3.jpg");

    const httpPathAlias = parsePublishRequest({
      platform: "blbl",
      phone: "13800138000",
      file: "/tmp/demo.mp4",
      title: "B站测试标题",
      horizontalCoverPath: "/tmp/4x3-path.jpg",
    });
    assert.strictEqual(httpPathAlias.ok, true);
    assert.strictEqual(httpPathAlias.value.horizontalCover, "/tmp/4x3-path.jpg");

    const help = publishHelpText();
    assert.ok(help.includes("--horizontal-cover"), "help 必须包含 --horizontal-cover");
    assert.ok(help.includes("哔哩哔哩"), "help 封面说明应包含哔哩哔哩");
  }

  console.log("test-blbl-cover passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
