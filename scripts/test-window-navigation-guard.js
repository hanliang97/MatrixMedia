"use strict";

/**
 * 主窗口导航守卫回归测试（Issue #35「安全审计 · Electron 安全配置」）。
 *
 * 背景：主窗口 `webPreferences` 是 nodeIntegration:true + contextIsolation:false
 * （渲染进程直接用 ipcRenderer / fs，短期不可能改成隔离模式）。而
 * webPreferences 跟随窗口、不跟随 URL —— 窗口一旦被导航到远端页面，
 * 远端脚本就继承了 Node 能力（Electron 24 实测：`location.href = 'http://…'`
 * 之后 `require('fs')` 仍可调用）。
 *
 * 本测试锁住评审后收敛过的边界：
 *   1. `file:` 只允许 appRoot 下的页面，带 host 的 file URL（Windows UNC）拒绝；
 *   2. http(s) 只允许显式传入的 dev origin，打包模式（devOrigins 为空）不再
 *      放行任意 localhost 端口；
 *   3. `will-navigate` 与 `will-redirect` 都装（302 不触发 will-navigate）；
 *   4. window.open 一律 deny，只有 http(s)/mailto 交系统浏览器，且
 *      openExternal 同步抛错 / reject 都不产生未处理异常；
 *   5. windowManager 里守卫确实在 loadURL 之前安装（两处窗口）。
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

function build(entry, name) {
  const outfile = path.join(outDir, name);
  buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    external: ["electron"],
  });
  return outfile;
}

const policy = require(build("src/shared/navigationGuard.js", "navigationGuard.cjs"));
const guardModule = require(
  build("src/main/services/windowNavigationGuard.js", "windowNavigationGuard.cjs")
);

const { isInternalAppUrl, isExternalOpenableUrl } = policy;
const { installWindowNavigationGuard, loadUrlWithGuard } = guardModule;

const APP_ROOT = path.join(root, "dist");
const DEV_ORIGIN = "http://localhost:9080";

/* ---------- 1. 纯策略：打包模式（只有 appRoot，没有 dev origin） ---------- */

const INTERNAL = [
  `file://${APP_ROOT}/index.html`,
  `file://${APP_ROOT}/index.html#/accountManager`,
  `file://${APP_ROOT}/static/loader.html`,
];
const NOT_INTERNAL = [
  // 任意本地文件（拖拽 .html 进窗口、用户内容里的 file: 链接）
  "file:///Users/x/Downloads/evil.html",
  "file:///etc/passwd",
  // Windows UNC：file://host/share 会触发 SMB 连接
  "file://attacker.example/share/x.html",
  "file:////evil.example/x.html",
  // 编码穿越
  `file://${APP_ROOT}/../../../etc/passwd`,
  // 打包模式不放行任何 http(s)（包括本机任意端口）
  "http://localhost:9080/#/home",
  "http://127.0.0.1:30088/stats",
  "https://github.com/hanliang97/MatrixMedia",
  "http://localhost.evil.com/",
  "javascript:alert(document.cookie)",
  "data:text/html,<script>require('fs')</script>",
  "chrome://settings",
  "about:blank",
  "not a url",
  "",
];
for (const url of INTERNAL) {
  assert.strictEqual(
    isInternalAppUrl(url, { appRoot: APP_ROOT }),
    true,
    `应判为内部地址: ${url}`
  );
}
for (const url of NOT_INTERNAL) {
  assert.strictEqual(
    isInternalAppUrl(url, { appRoot: APP_ROOT }),
    false,
    `不应判为内部地址: ${url}`
  );
}

// 没有 appRoot 时 file: 一律不算内部（fail-closed）
assert.strictEqual(isInternalAppUrl(`file://${APP_ROOT}/index.html`), false);

/* ---------- 2. dev 模式：只认显式传入的 origin ---------- */

const devPolicy = { appRoot: APP_ROOT, devOrigins: [DEV_ORIGIN] };
assert.strictEqual(isInternalAppUrl(`${DEV_ORIGIN}/#/home`, devPolicy), true);
assert.strictEqual(isInternalAppUrl("http://127.0.0.1:30088/stats", devPolicy), false);
assert.strictEqual(isInternalAppUrl("http://localhost:9999/", devPolicy), false);
assert.strictEqual(isInternalAppUrl("http://localhost.evil.com/", devPolicy), false);
assert.strictEqual(isInternalAppUrl(`file://${APP_ROOT}/index.html`, devPolicy), true);

/* ---------- 3. 外链白名单 ---------- */

const EXTERNAL_OK = [
  "https://github.com/hanliang97/MatrixMedia",
  "http://127.0.0.1:1234/report",
  "mailto:support@example.com",
];
const EXTERNAL_NO = [
  "file:///etc/passwd",
  "javascript:alert(1)",
  "data:text/html,x",
  "vbscript:msgbox(1)",
  "chrome://settings",
  "not a url",
  "",
];
for (const url of EXTERNAL_OK) {
  assert.strictEqual(isExternalOpenableUrl(url), true, `应允许外链: ${url}`);
}
for (const url of EXTERNAL_NO) {
  assert.strictEqual(isExternalOpenableUrl(url), false, `不应允许外链: ${url}`);
}

/* ---------- 4. 守卫接线（假窗口） ---------- */

function makeFakeWindow() {
  const listeners = {};
  return {
    listeners,
    webContents: {
      setWindowOpenHandler(handler) {
        this.windowOpenHandler = handler;
      },
      on(event, handler) {
        (listeners[event] = listeners[event] || []).push(handler);
      },
    },
    isDestroyed: () => false,
  };
}

const openedUrls = [];
const win = makeFakeWindow();
const installed = installWindowNavigationGuard(win, {
  openExternal: (url) => openedUrls.push(url),
  appRoot: APP_ROOT,
  devOrigins: [DEV_ORIGIN],
});
assert.strictEqual(installed, true, "守卫安装失败");
assert.strictEqual(typeof win.webContents.windowOpenHandler, "function");
for (const event of ["will-navigate", "will-redirect"]) {
  assert.strictEqual(
    Array.isArray(win.listeners[event]) && win.listeners[event].length,
    1,
    `未安装 ${event} 监听`
  );
}

// window.open：无论什么地址都不在应用内开窗，只有 http(s)/mailto 转系统浏览器
for (const url of [
  "https://github.com/x",
  "javascript:alert(1)",
  "file:///etc/passwd",
  "mailto:a@b.com",
]) {
  const result = win.webContents.windowOpenHandler({ url });
  assert.deepStrictEqual(result, { action: "deny" }, `window.open 未拒绝: ${url}`);
}
assert.deepStrictEqual(
  openedUrls,
  ["https://github.com/x", "mailto:a@b.com"],
  "只有 http(s)/mailto 才应交系统浏览器打开"
);

const fire = (event, url) => {
  let prevented = false;
  for (const handler of win.listeners[event]) {
    handler({ preventDefault: () => (prevented = true) }, url);
  }
  return prevented;
};

// will-navigate：内部放行，远端 / 本地任意文件拦下
for (const event of ["will-navigate", "will-redirect"]) {
  assert.strictEqual(
    fire(event, `file://${APP_ROOT}/index.html#/home`),
    false,
    `${event}: 应用自己的页面被误拦`
  );
  assert.strictEqual(
    fire(event, `${DEV_ORIGIN}/#/home`),
    false,
    `${event}: dev 本地页被误拦`
  );
  assert.strictEqual(
    fire(event, "https://github.com/hanliang97/MatrixMedia"),
    true,
    `${event}: 远端导航未被拦截`
  );
  // 302 到本地任意文件同样要拦（拖拽 .html 的落点）
  assert.strictEqual(
    fire(event, "file:///Users/x/Downloads/evil.html"),
    true,
    `${event}: 本地任意文件导航未被拦截`
  );
  assert.strictEqual(fire(event, "javascript:alert(1)"), true, `${event}: javascript: 未拦`);
}
assert.ok(
  openedUrls.includes("https://github.com/hanliang97/MatrixMedia"),
  "远端导航未转交系统浏览器"
);
assert.ok(
  !openedUrls.some((u) => u.startsWith("file:")),
  "file: 地址不该交给系统浏览器"
);

/* ---------- 5. openExternal 异常不影响拦截、不产生未处理 rejection ---------- */

const unhandled = [];
const onUnhandled = (reason) => unhandled.push(reason);
process.on("unhandledRejection", onUnhandled);

const throwingWin = makeFakeWindow();
installWindowNavigationGuard(throwingWin, {
  openExternal: () => {
    throw new Error("boom-sync");
  },
  appRoot: APP_ROOT,
});
const fireOn = (winObj, event, url) => {
  let prevented = false;
  for (const handler of winObj.listeners[event]) {
    handler({ preventDefault: () => (prevented = true) }, url);
  }
  return prevented;
};
assert.strictEqual(
  fireOn(throwingWin, "will-navigate", "https://evil.example/x"),
  true,
  "openExternal 抛错后导航仍应被拦截"
);

const rejectingWin = makeFakeWindow();
installWindowNavigationGuard(rejectingWin, {
  openExternal: () => Promise.reject(new Error("boom-async")),
  appRoot: APP_ROOT,
});
assert.strictEqual(
  fireOn(rejectingWin, "will-redirect", "https://evil.example/x"),
  true,
  "openExternal reject 后导航仍应被拦截"
);

setTimeout(() => {
  process.removeListener("unhandledRejection", onUnhandled);
  assert.deepStrictEqual(unhandled, [], "出现未处理的 rejection");

  // 已销毁的窗口不应抛错
  assert.strictEqual(
    installWindowNavigationGuard({ webContents: null, isDestroyed: () => true }),
    false
  );

  /* ---------- 6. windowManager 接线：守卫必须在 loadURL 之前 ---------- */

  // 顺序由 loadUrlWithGuard 保证：用记录调用顺序的假窗口锁住「先守卫、后 loadURL」
  const order = [];
  const orderedWin = {
    webContents: {
      setWindowOpenHandler() {
        order.push("setWindowOpenHandler");
      },
      on(event) {
        order.push(`on:${event}`);
      },
    },
    loadURL(url) {
      order.push(`loadURL:${url}`);
    },
    isDestroyed: () => false,
  };
  loadUrlWithGuard(orderedWin, `file://${APP_ROOT}/index.html`, {
    appRoot: APP_ROOT,
    openExternal: () => {},
  });
  const loadIndex = order.findIndex((entry) => entry.startsWith("loadURL:"));
  assert.ok(loadIndex > 0, "loadUrlWithGuard 没有调用 loadURL");
  assert.deepStrictEqual(
    order.slice(loadIndex + 1),
    [],
    "loadURL 之后又安装了守卫（顺序错误）"
  );
  assert.deepStrictEqual(order.slice(0, loadIndex), [
    "setWindowOpenHandler",
    "on:will-navigate",
    "on:will-redirect",
  ]);

  // windowManager 两个窗口都必须走 loadUrlWithGuard（否则守卫顺序可能被写回旧样子）
  const wm = fs.readFileSync(
    path.join(root, "src/main/services/windowManager.js"),
    "utf8"
  );
  assert.ok(/loadUrlWithGuard\(mainWindow, winURL/.test(wm), "主窗口未走 loadUrlWithGuard");
  assert.ok(/loadUrlWithGuard\(loadWindow, loadingURL/.test(wm), "加载窗未走 loadUrlWithGuard");
  assert.ok(/...navigationPolicy\(\)/.test(wm), "守卫没有传入 appRoot / devOrigins 策略");

  console.log("test-window-navigation-guard: 全部断言通过");
}, 50);
