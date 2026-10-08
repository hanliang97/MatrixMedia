"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache");
fs.mkdirSync(cache, { recursive: true });
function load(relative) {
  const outfile = path.join(cache, path.basename(relative) + ".cjs");
  buildSync({ entryPoints: [path.join(root, relative)], bundle: true,
    platform: "node", format: "cjs", outfile });
  delete require.cache[outfile];
  return require(outfile);
}

const { parseLoginArgs } = load("src/main/cli/parseLoginArgs.js");
const chrome = parseLoginArgs(["-p", "sph", "--phone", "测试", "--browser", "chrome"]);
assert.strictEqual(chrome.ok, true);
assert.strictEqual(chrome.value.browser, "chrome", "系统 Chrome 选择不能被静默忽略");
assert.strictEqual(chrome.value.show, true);
assert.strictEqual(chrome.value.terminalQr, false);
assert.strictEqual(parseLoginArgs(["-p", "dy", "--phone", "测试", "--browser", "chrome"]).ok, false);
assert.strictEqual(parseLoginArgs(["-p", "sph", "--phone", "测试", "--browser", "invalid"]).ok, false);
assert.strictEqual(parseLoginArgs(["-p", "sph", "--phone", "测试", "--browser"]).ok, false);
assert.strictEqual(parseLoginArgs(["-p", "sph", "--phone", "测试", "--browser", "chrome", "--puppeteer-headless"]).ok, false);
assert.strictEqual(parseLoginArgs(["-p", "sph", "--phone", "测试"]).value.browser, "electron");

const serviceFile = "src/main/services/cliLogin/sphChromeLoginHandler.js";
const service = fs.existsSync(path.join(root, serviceFile)) ? load(serviceFile) : {};
assert.strictEqual(typeof service.createSphChromeLoginHandler, "function", "应有可验证的 Chrome 登录回退流程");
const { createSphChromeLoginHandler } = service;
const PARTITION = "persist:测试视频号";
const ORIGIN = "https://channels.weixin.qq.com";
const SECRET = "fixture-secret-not-for-logs";

function fixture(options = {}) {
  let tick = 0;
  const events = [];
  const imported = [];
  const jar = new Map((options.existingCookies || []).map(cookie =>
    [cookie.domain + cookie.path + cookie.name, { ...cookie }]
  ));
  let connected = true;
  const cookies = options.cookies || [
    { name: "sessionid", value: SECRET, domain: "channels.weixin.qq.com", path: "/", expires: -1, httpOnly: true, secure: true },
    { name: "wxuin", value: "fixture-uin", domain: "channels.weixin.qq.com", path: "/", expires: 2000000000, secure: true },
    { name: "other", value: "other", domain: "unrelated.example", path: "/", expires: -1 },
  ];
  const page = {
    url: () => ORIGIN + "/platform",
    isClosed: () => !connected,
    async goto(url) { events.push(["goto", url]); },
    async bringToFront() { events.push(["focus"]); },
    async authenticate(auth) { events.push(["proxy-auth", auth]); },
    async cookies(url) { assert.strictEqual(url, ORIGIN); return cookies; },
    async evaluate(fn, arg) {
      return vm.runInNewContext("(" + fn.toString() + ")(arg)", {
        arg, AbortController, setTimeout, clearTimeout,
        fetch: async (url, request) => {
          events.push(["chrome-probe"]);
          assert.strictEqual(url, ORIGIN + "/cgi-bin/mmfinderassistant-bin/auth/auth_data");
          assert.strictEqual(request.method, "POST");
          assert.strictEqual(request.credentials, "include");
          return { ok: true, json: async () => options.payload || { errCode: 0 } };
        },
      });
    },
  };
  const browser = {
    isConnected: () => connected,
    async pages() { return [page]; },
    async userAgent() { return "fixture Chrome/152.0.0.0"; },
    async close() { events.push(["close"]); connected = false; },
  };
  const target = {
    cookies: { async set(cookie) { events.push(["set-cookie"]); imported.push(cookie);
      if (options.failSync) throw new Error(SECRET);
      const domain = cookie.domain || new URL(cookie.url).hostname;
      if (cookie.expirationDate > 0 && cookie.expirationDate * 1000 <= Date.now()) { jar.delete(domain + cookie.path + cookie.name); return; }
      jar.set(domain + cookie.path + cookie.name, { ...cookie, domain, hostOnly: !domain.startsWith(".") }); },
      async get() { return Array.from(jar.values()); },
      async remove(url, name) {
        const parsed = new URL(url);
        for (const [key, cookie] of jar) {
          const domain = cookie.domain.replace(/^\./, "");
          if (cookie.name === name && (parsed.hostname === domain || parsed.hostname.endsWith("." + domain)) && parsed.pathname.startsWith(cookie.path)) jar.delete(key);
        }
      },
      async flushStore() { events.push(["flush-cookies"]); } },
    getUserAgent: () => "fixture previous UA",
    setUserAgent(ua) { events.push(["native-ua", ua]); },
    async flushStorageData() { events.push(["flush-storage"]); },
  };
  const deps = {
    resolveChromePath: () => options.missingChrome ? null : "/fixture/chrome",
    getProfileRoot: () => "/fixture/app-data",
    async launchBrowser(launch) { events.push(["launch", launch]); return browser; },
    getTargetSession(partition) { assert.strictEqual(partition, PARTITION); return target; },
    async probeImportedSession(partition) {
      assert.strictEqual(partition, PARTITION);
      assert.ok(events.some(e => e[0] === "flush-cookies"));
      events.push(["native-probe"]);
      if (options.requireSingleSession && Array.from(jar.values()).filter(c => c.name === "sessionid").length !== 1) return { ok: true, loggedIn: false };
      return options.nativeProbe || { ok: true, loggedIn: true };
    },
    async getProxyOptions() { return options.proxy || {}; },
    now: () => tick,
    async sleep(ms) { tick += ms; if (options.cancel) connected = false; },
  };
  return { handler: createSphChromeLoginHandler(deps), events, imported, browser, target, jar };
}

(async () => {
  // 应先验证 Chrome 会话，再导入同一完整 partition，保留 session cookie 语义。
  const f = fixture();
  const r = await f.handler({ partition: PARTITION, timeoutMs: 5000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(f.imported.length, 2, "不得同步无关域名凭据");
  assert.strictEqual(f.imported[0].value, SECRET);
  assert.ok(!Object.hasOwn(f.imported[0], "expirationDate"), "不能伪造 session cookie 的有效期");
  assert.strictEqual(f.imported[1].expirationDate, 2000000000);
  assert.ok(f.events.findIndex(e => e[0] === "chrome-probe") < f.events.findIndex(e => e[0] === "set-cookie"));
  assert.ok(f.events.some(e => e[0] === "native-probe"));
  assert.strictEqual(f.events.at(-1)[0], "close");
  const launch = f.events.find(e => e[0] === "launch")[1];
  assert.strictEqual(launch.headless, false);
  assert.ok(launch.userDataDir.startsWith("/fixture/app-data/chrome-sph-login/"));
  assert.ok(!launch.userDataDir.includes("water-drop"), "凭据目录不得直接拼用户输入");
  assert.ok(!JSON.stringify(r).includes(SECRET));

  // 仅出现 sessionid、但服务端拒绝鉴权时，不得导入或报告成功。
  const rejected = fixture({ payload: { errCode: 300334 } });
  const failed = await rejected.handler({ partition: PARTITION, timeoutMs: 5000 });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.exitCode, 3);
  assert.strictEqual(rejected.imported.length, 0);

  // 真实 Chromium 的 Cookie identity 包含 domain/path；旧域 Cookie 会遮蔽新 host-only Cookie。
  const old = { name: "sessionid", value: "fixture-old", domain: ".channels.weixin.qq.com", path: "/", secure: true, expirationDate: 2000000000, hostOnly: false };
  const overlap = fixture({ existingCookies: [old], requireSingleSession: true });
  assert.strictEqual((await overlap.handler({ partition: PARTITION })).ok, true, "导入前必须清理旧作用域，不得叠加同名会话");
  assert.strictEqual(Array.from(overlap.jar.values()).filter(c => c.name === "sessionid").length, 1);
  const ancestor = { ...old, domain: ".qq.com", value: "fixture-ancestor" };
  const parent = fixture({ existingCookies: [old, ancestor] });
  assert.strictEqual((await parent.handler({ partition: PARTITION })).ok, true);
  assert.strictEqual(Array.from(parent.jar.values()).find(c => c.domain === ".qq.com").value, "fixture-ancestor", "删除视频号 Cookie 不得连带删除父域同名 Cookie");
  const rollback = fixture({ existingCookies: [old], nativeProbe: { ok: true, loggedIn: false } });
  assert.strictEqual((await rollback.handler({ partition: PARTITION })).ok, false);
  assert.deepStrictEqual(Array.from(rollback.jar.values()).map(c => [c.name, c.domain, c.value]), [["sessionid", ".channels.weixin.qq.com", "fixture-old"]], "应用鉴权失败必须恢复原会话");
  const malformed = fixture({ payload: { errcode: null } });
  assert.strictEqual((await malformed.handler({ partition: PARTITION, timeoutMs: 5000 })).ok, false);
  assert.strictEqual(malformed.imported.length, 0, "空错误码不能按 Number(null) 判成成功");

  // 原生会话仍不被服务器接受时，明确保留失败状态。
  const nativeRejected = fixture({ nativeProbe: { ok: true, loggedIn: false } });
  assert.strictEqual((await nativeRejected.handler({ partition: PARTITION })).ok, false);

  const missing = fixture({ missingChrome: true });
  assert.strictEqual((await missing.handler({ partition: PARTITION })).exitCode, 1);
  assert.strictEqual(missing.events.length, 0);

  const cancelled = fixture({ cookies: [], cancel: true });
  assert.strictEqual((await cancelled.handler({ partition: PARTITION, timeoutMs: 5000 })).exitCode, 3);
  assert.strictEqual(cancelled.imported.length, 0);

  const unsafe = fixture({ failSync: true });
  const unsafeResult = await unsafe.handler({ partition: PARTITION });
  assert.strictEqual(unsafeResult.ok, false);
  assert.ok(!JSON.stringify(unsafeResult).includes(SECRET), "异常消息不得泄漏 Cookie 值");

  const proxy = fixture({ proxy: { server: "http://proxy.example:8080", authentication: { username: "fixture", password: "fixture-password" } } });
  await proxy.handler({ partition: PARTITION });
  assert.ok(proxy.events.find(e => e[0] === "launch")[1].args.includes("--proxy-server=http://proxy.example:8080"));
  assert.ok(proxy.events.findIndex(e => e[0] === "proxy-auth") < proxy.events.findIndex(e => e[0] === "goto"));

  const duplicate = fixture();
  const results = await Promise.all([
    duplicate.handler({ partition: PARTITION }), duplicate.handler({ partition: PARTITION }),
  ]);
  assert.ok(results.every(result => result.ok));
  assert.strictEqual(duplicate.events.filter(e => e[0] === "launch").length, 1, "同账号并发登录不能争用 Chrome profile");
  const invalid = fixture();
  assert.strictEqual((await invalid.handler({ partition: "persist:测试抖音" })).exitCode, 2);
  assert.strictEqual(invalid.events.length, 0);
  assert.strictEqual((await invalid.handler({ partition: "persist:water-drop视频号" })).exitCode, 2, "发布端尚不支持的分区不能报告登录成功");
  console.log("test-sph-chrome-login passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
