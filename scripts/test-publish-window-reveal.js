"use strict";

/**
 * 验证后台发布窗口实时唤起能力：
 * 1. matchPublishWindowEntry 按 recordId / taskId / 平台+账号+文件 优先级精准匹配
 * 2. 同进程 registerPublishWindow → listActivePublishWindows（不泄漏 token）→ showPublishWindow
 * 3. 跨进程（模拟 CLI/MCP 独立子进程）写入 active-publish-windows.json，主进程通过回环端口唤起远端窗口
 * 4. 子进程退出后的陈旧条目自动清理，窗口注销后返回 not_found
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { spawn } = require("child_process");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const matchBundle = path.join(outDir, "publishWindowMatch.cjs");
const registryBundle = path.join(outDir, "publishWindowRegistry.cjs");

buildSync({
  entryPoints: [path.join(root, "src/shared/publishWindowMatch.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: matchBundle,
});
buildSync({
  entryPoints: [path.join(root, "src/main/services/publishWindowRegistry.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: registryBundle,
});

const {
  matchPublishWindowEntry,
  buildPublishWindowQuery,
} = require(matchBundle);
const {
  registerPublishWindow,
  listActivePublishWindows,
  showPublishWindow,
} = require(registryBundle);

function createMockWin({ initiallyShown = false, minimized = false } = {}) {
  const calls = [];
  let destroyed = false;
  return {
    _mmInitiallyShown: initiallyShown,
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => {
      minimized = false;
      calls.push("restore");
    },
    show: () => calls.push("show"),
    moveTop: () => calls.push("moveTop"),
    focus: () => calls.push("focus"),
    destroyNow: () => {
      destroyed = true;
    },
  };
}

async function run() {
  // 1. 纯匹配算法校验
  {
    const entries = [
      {
        key: "k1",
        recordId: "rec-1",
        taskId: "t-1",
        pt: "抖音",
        partition: "persist:账号A抖音",
        phone: "账号A",
        selectedFile: "demo1.mp4",
        title: "视频1",
      },
      {
        key: "k2",
        recordId: "rec-2",
        taskId: "t-2",
        pt: "快手",
        partition: "persist:账号A快手",
        phone: "账号A",
        selectedFile: "demo1.mp4",
        title: "视频1",
      },
    ];
    assert.strictEqual(
      matchPublishWindowEntry(entries, { recordId: "rec-2", pt: "抖音" }).key,
      "k2",
      "recordId 精确匹配优先级应最高"
    );
    assert.strictEqual(
      matchPublishWindowEntry(entries, {
        pt: "抖音",
        partition: "persist:账号A抖音",
        selectedFile: "demo1.mp4",
      }).key,
      "k1",
      "无 recordId 时应通过 平台+账号+文件 精准匹配"
    );
    assert.strictEqual(
      matchPublishWindowEntry(entries, {
        pt: "视频号",
        partition: "persist:账号B视频号",
        selectedFile: "other.mp4",
      }),
      null,
      "不同平台与内容不应误匹配"
    );
    const q = buildPublishWindowQuery(
      { id: "r0", bt: "标题X", selectedFile: "a.mp4", phone: "组1" },
      { id: "r1", pt: "抖音", partition: "persist:组1抖音" }
    );
    assert.strictEqual(q.recordId, "r1");
    assert.strictEqual(q.pt, "抖音");
    assert.strictEqual(q.selectedFile, "a.mp4");
  }

  // 2. 同进程注册、列表脱敏、唤起、注销
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-pubwin-"));
  try {
    const win = createMockWin({ initiallyShown: false, minimized: true });
    const appCalls = [];
    const mockApp = {
      dock: { show: () => appCalls.push("dock.show") },
      focus: (opts) => appCalls.push(`focus:${Boolean(opts && opts.steal)}`),
    };
    const unregister = registerPublishWindow(
      win,
      {
        recordId: "rec-local-1",
        taskId: 1001,
        pt: "抖音",
        partition: "persist:测试抖音",
        phone: "测试",
        selectedFile: "v.mp4",
        title: "本地视频",
      },
      { userDataDir: tmpDir, appRef: mockApp }
    );

    const listed = listActivePublishWindows({ userDataDir: tmpDir });
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].recordId, "rec-local-1");
    assert.strictEqual(
      listed[0].token,
      undefined,
      "对外暴露的活跃窗口列表不得包含控制 token"
    );

    const res = await showPublishWindow(
      { recordId: "rec-local-1", pt: "抖音" },
      { userDataDir: tmpDir, appRef: mockApp }
    );
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.mode, "local");
    assert.strictEqual(win._mmRevealedFromBackground, true);
    assert.deepStrictEqual(win.calls, ["restore", "show", "moveTop", "focus"]);

    unregister();
    assert.strictEqual(
      listActivePublishWindows({ userDataDir: tmpDir }).length,
      0,
      "注销后活跃窗口应清空"
    );
    const afterRes = await showPublishWindow(
      { recordId: "rec-local-1", pt: "抖音" },
      { userDataDir: tmpDir }
    );
    assert.strictEqual(afterRes.ok, false);
    assert.strictEqual(afterRes.reason, "not_found");

    // 3. 跨进程（CLI/MCP 子进程）通过回环控制端口唤起远端窗口
    const markerFile = path.join(tmpDir, "remote-shown.json");
    const childScript = `
      const fs = require('fs');
      const { registerPublishWindow } = require(${JSON.stringify(registryBundle)});
      const calls = [];
      const win = {
        _mmInitiallyShown: false,
        isDestroyed: () => false,
        isMinimized: () => false,
        show: () => {
          calls.push('show');
          fs.writeFileSync(${JSON.stringify(markerFile)}, JSON.stringify({ calls, revealed: Boolean(win._mmRevealedFromBackground) }));
        },
        moveTop: () => calls.push('moveTop'),
        focus: () => calls.push('focus'),
      };
      registerPublishWindow(
        win,
        {
          recordId: 'rec-remote-99',
          taskId: 9999,
          pt: '抖音',
          partition: 'persist:远端账号抖音',
          phone: '远端账号',
          selectedFile: 'remote.mp4',
          title: 'CLI 发布任务',
        },
        { userDataDir: ${JSON.stringify(tmpDir)} }
      );
      setTimeout(() => process.stdout.write('READY\\n'), 120);
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["-e", childScript], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("子进程启动超时")), 5000);
      child.stdout.on("data", (buf) => {
        if (buf.toString().includes("READY")) {
          clearTimeout(t);
          resolve();
        }
      });
      child.on("exit", (code) => {
        clearTimeout(t);
        reject(new Error(`子进程提前退出: ${code}`));
      });
    });

    try {
      const remoteList = listActivePublishWindows({ userDataDir: tmpDir });
      assert.strictEqual(remoteList.length, 1, "主进程应能看到 CLI 子进程活跃窗口");
      assert.strictEqual(remoteList[0].recordId, "rec-remote-99");
      assert.strictEqual(remoteList[0].pid, child.pid);

      const remoteRes = await showPublishWindow(
        { recordId: "rec-remote-99", pt: "抖音" },
        { userDataDir: tmpDir }
      );
      assert.strictEqual(remoteRes.ok, true, "应通过回环端口成功唤起远端窗口");
      assert.strictEqual(remoteRes.mode, "remote");
      assert.ok(fs.existsSync(markerFile), "远端窗口的 show() 必须实际被调用");
      const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
      assert.strictEqual(marker.revealed, true);
      assert.ok(marker.calls.includes("show"));
    } finally {
      child.kill("SIGKILL");
      await new Promise((r) => child.on("exit", r));
    }

    // 4. 子进程异常强杀退出后，陈旧索引应被自动清理
    const afterKill = listActivePublishWindows({ userDataDir: tmpDir });
    assert.strictEqual(
      afterKill.length,
      0,
      "子进程退出后应自动剔除失效 PID 条目"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("test-publish-window-reveal: 全部断言通过");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
