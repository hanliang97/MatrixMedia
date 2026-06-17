"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const sharedBundle = path.join(outDir, "accountProxy.cjs");
const proxyConfigBundle = path.join(outDir, "proxyConfig.cjs");

buildSync({
  entryPoints: [path.join(root, "src/shared/accountProxy.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: sharedBundle,
});

buildSync({
  entryPoints: [path.join(root, "src/main/services/proxyConfig.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: proxyConfigBundle,
  external: ["electron"],
});

const {
  parseProxyUrl,
  normalizeAccountProxy,
  isAccountProxyEnabled,
  getAccountProxyDisplay,
} = require(sharedBundle);

(() => {
  const r = parseProxyUrl("http://127.0.0.1:7890");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.host, "127.0.0.1");
  assert.strictEqual(r.value.port, "7890");
  assert.strictEqual(r.value.proxyRules, "http=127.0.0.1:7890;https=127.0.0.1:7890");
  assert.strictEqual(r.value.hasAuth, false);
})();

(() => {
  const r = parseProxyUrl("http://user:pass@proxy.example.com:8080");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.username, "user");
  assert.strictEqual(r.value.password, "pass");
  assert.strictEqual(r.value.hasAuth, true);
})();

(() => {
  const r = parseProxyUrl("socks5://127.0.0.1:1080");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.proxyRules, "socks5=127.0.0.1:1080");
})();

(() => {
  const r = parseProxyUrl("127.0.0.1:7890");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.scheme, "http");
})();

(() => {
  const r = parseProxyUrl("");
  assert.strictEqual(r.ok, false);
})();

(() => {
  const r = parseProxyUrl("ftp://127.0.0.1:21");
  assert.strictEqual(r.ok, false);
})();

(() => {
  const disabled = normalizeAccountProxy({ enabled: false, url: "" });
  assert.strictEqual(disabled.ok, true);
  assert.strictEqual(disabled.value.enabled, false);
})();

(() => {
  const enabledEmpty = normalizeAccountProxy({ enabled: true, url: "" });
  assert.strictEqual(enabledEmpty.ok, false);
})();

(() => {
  const enabled = normalizeAccountProxy({
    enabled: true,
    url: "http://127.0.0.1:7890",
  });
  assert.strictEqual(enabled.ok, true);
  assert.strictEqual(enabled.value.url, "http://127.0.0.1:7890");
})();

(() => {
  assert.strictEqual(isAccountProxyEnabled({ enabled: true, url: "http://a:1" }), true);
  assert.strictEqual(isAccountProxyEnabled({ enabled: false, url: "http://a:1" }), false);
})();

(() => {
  assert.strictEqual(
    getAccountProxyDisplay({ enabled: true, url: "http://127.0.0.1:7890" }),
    "127.0.0.1:7890"
  );
  assert.strictEqual(getAccountProxyDisplay({ enabled: false, url: "http://a:1" }), "");
})();

const { findAccountRecord } = require(proxyConfigBundle);
assert.strictEqual(typeof findAccountRecord, "function");

console.log("test-proxy-config: all assertions passed");
