"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { buildSync } = require("esbuild");
const root = path.join(__dirname, "..");
const cache = path.join(root, "test/.cache");
fs.mkdirSync(cache, { recursive: true });
const outfile = path.join(cache, "sph-cookie-session-test.cjs");
buildSync({ entryPoints: [path.join(root, "src/main/services/sphCookieSession.js")],
  bundle: true, platform: "node", format: "cjs", outfile });
const { reconcileSphCookies } = require(outfile);

const old = { name: "sessionid", value: "fixture-old", domain: ".channels.weixin.qq.com", path: "/", hostOnly: false, secure: true, expirationDate: 2000000000 };
const fresh = { name: "sessionid", value: "fixture-fresh", domain: "channels.weixin.qq.com", path: "/", hostOnly: true, secure: true, expirationDate: 2000001000 };
const unrelated = { name: "sessionid", value: "fixture-unrelated", domain: "other.example", path: "/", hostOnly: true };

function fixture(initial, failOnce = false) {
  const key = c => c.domain + "|" + c.path + "|" + c.name;
  const jar = new Map(initial.map(c => [key(c), { ...c }]));
  let writes = 0;
  let reject = failOnce;
  const ses = {
    cookies: {
      async get() { return Array.from(jar.values()); },
      async remove(url, name) {
        const u = new URL(url);
        for (const [k, c] of jar) {
          const domain = c.domain.replace(/^\./, "");
          if (c.name === name && (u.hostname === domain || u.hostname.endsWith("." + domain)) && u.pathname.startsWith(c.path)) jar.delete(k);
        }
      },
      async set(c) {
        writes++;
        if (reject) { reject = false; throw new Error("fixture-secret"); }
        const domain = c.domain || new URL(c.url).hostname;
        if (c.expirationDate > 0 && c.expirationDate * 1000 <= Date.now()) { jar.delete(domain + "|" + c.path + "|" + c.name); return; }
        const stored = { ...c, domain, hostOnly: !c.domain };
        delete stored.url;
        jar.set(key(stored), stored);
      },
      async flushStore() {},
    },
    async flushStorageData() {},
  };
  return { ses, jar, writes: () => writes };
}

(async () => {
  const f = fixture([old, fresh, unrelated, { ...old, path: "/cgi-bin" }]);
  const result = await reconcileSphCookies(f.ses, async () => ({ ok: true, loggedIn: true }));
  assert.strictEqual(result.changed, true);
  const remaining = Array.from(f.jar.values());
  assert.deepStrictEqual(remaining.filter(c => c.name === "sessionid").map(c => [c.domain, c.path, c.value]).sort(),
    [["channels.weixin.qq.com", "/", "fixture-fresh"], ["other.example", "/", "fixture-unrelated"]].sort());
  const rootCookie = remaining.find(c => c.domain === "channels.weixin.qq.com");
  assert.strictEqual(rootCookie.hostOnly, true);
  assert.strictEqual(rootCookie.expirationDate, 2000001000);
  assert.strictEqual((await reconcileSphCookies(f.ses, async () => ({ ok: true, loggedIn: true }))).changed, false);

  const revoked = fixture([old, fresh]);
  const rejected = await reconcileSphCookies(revoked.ses, async () => ({ ok: true, loggedIn: false }));
  assert.strictEqual(rejected.changed, false, "未过期并不代表服务端接受，不得销毁另一份可能有效的会话");
  assert.strictEqual(revoked.writes(), 0);
  const unknown = fixture([old, fresh]);
  assert.strictEqual((await reconcileSphCookies(unknown.ses, async () => ({ ok: false }))).changed, false);
  assert.strictEqual(unknown.writes(), 0);
  const ancestor = { ...old, domain: ".qq.com", value: "fixture-ancestor" };
  const parent = fixture([old, fresh, ancestor]);
  await reconcileSphCookies(parent.ses, async () => ({ ok: true, loggedIn: true }));
  assert.strictEqual(Array.from(parent.jar.values()).find(c => c.domain === ".qq.com").value, "fixture-ancestor");

  for (const initial of [[old], [fresh], [{ ...old, expirationDate: 1 }, { ...fresh, expirationDate: 1 }]]) {
    const untouched = fixture(initial);
    assert.strictEqual((await reconcileSphCookies(untouched.ses, async () => ({ ok: true, loggedIn: true }))).changed, false);
    assert.strictEqual(untouched.writes(), 0, "没有有效规范会话时不得猜测并删除凭据");
  }
  const readOnly = fixture([old, fresh]);
  assert.strictEqual((await reconcileSphCookies(readOnly.ses)).changed, false);
  assert.strictEqual(readOnly.writes(), 0);
  const validDomain = fixture([old, fresh]);
  const domainResult = await reconcileSphCookies(validDomain.ses, async cookies => ({
    ok: true, loggedIn: !cookies || cookies.find(c => c.name === "sessionid").value === "fixture-old",
  }));
  assert.strictEqual(domainResult.changed, true);
  assert.strictEqual(Array.from(validDomain.jar.values()).find(c => c.name === "sessionid").value, "fixture-old", "被撤销的 host-only 会话不能销毁仍有效的域会话");

  const rollback = fixture([old, fresh, unrelated], true);
  await assert.rejects(reconcileSphCookies(rollback.ses, async () => ({ ok: true, loggedIn: true })), /已恢复原会话/);
  assert.deepStrictEqual(Array.from(rollback.jar.values()).map(c => [c.name, c.domain, c.path, c.value]).sort(),
    [old, fresh, unrelated].map(c => [c.name, c.domain, c.path, c.value]).sort());

  const concurrent = fixture([old, fresh]);
  const verify = async () => ({ ok: true, loggedIn: true });
  const reconciled = await Promise.all([reconcileSphCookies(concurrent.ses, verify), reconcileSphCookies(concurrent.ses, verify)]);
  assert.strictEqual(reconciled.filter(r => r.changed).length, 1);

  // 通过真实登录准备/鉴权代码模拟服务端选中 Cookie 头的第一份 sessionid。
  const consumer = fixture([old, fresh]);
  const consumerFile = path.join(cache, "sph-session-consumer.cjs");
  buildSync({ entryPoints: [path.join(root, "src/main/services/sphLoginSession.js")],
    bundle: true, platform: "node", format: "cjs", external: ["electron"], outfile: consumerFile });
  const load = Module._load;
  let prepareSphAccountLoginSession;
  let proxyApplied = false;
  consumer.ses.on = () => {};
  consumer.ses.setProxy = async () => { proxyApplied = true; };
  const { EventEmitter } = require("events");
  let requests = 0;
  Module._load = function(name, ...args) {
    if (name === "electron") return {
      app: { getPath: () => path.join(cache, "sph-proxy-fixture") },
      session: { fromPartition: () => consumer.ses },
      net: { request(options) {
        assert.strictEqual(proxyApplied, true, "GUI/CLI 共享入口必须先应用账号代理再鉴权");
        requests++;
        const req = new EventEmitter();
        req.abort = () => {};
        req.write = body => assert.strictEqual(body, "{}");
        req.end = () => queueMicrotask(() => {
          const header = options.useSessionCookies ? Array.from(consumer.jar.values()).filter(c => c.name === "sessionid").map(c => "sessionid=" + c.value).join("; ") : options.headers.Cookie;
          const first = header.split("; ")[0];
          const response = new EventEmitter();response.headers = { "content-type": "application/json" };response.statusCode = 200;
          req.emit("response", response);
          response.emit("data", JSON.stringify({ errCode: first === "sessionid=fixture-fresh" ? 0 : 300334 }));
          response.emit("end");
        });
        return req;
      } },
    };
    return load.call(this, name, ...args);
  };
  try { ({ prepareSphAccountLoginSession } = require(consumerFile)); }
  finally { Module._load = load; }
  assert.strictEqual((await prepareSphAccountLoginSession({ partition: "persist:测试视频号", phone: "fixture" })).verified, true);
  assert.strictEqual(Array.from(consumer.jar.values()).find(c => c.name === "sessionid").value, "fixture-fresh");
  assert.strictEqual(requests, 2, "候选头和替换后的原生请求都必须被验证");
  console.log("test-sph-cookie-session passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
