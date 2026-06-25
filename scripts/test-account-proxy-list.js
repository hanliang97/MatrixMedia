const assert = require("assert");
const {
  normalizeAccountProxy,
  isAccountProxyEnabled,
  getAccountProxyDisplay,
  getEnabledAccountProxies,
  pickActiveAccountProxy,
} = require("../src/shared/accountProxy.js");

const legacy = normalizeAccountProxy({
  enabled: true,
  url: "127.0.0.1:7890",
});
assert.strictEqual(legacy.ok, true);
assert.deepStrictEqual(legacy.value, {
  proxies: [{ enabled: true, url: "http://127.0.0.1:7890" }],
});

const list = normalizeAccountProxy({
  proxies: [
    { enabled: true, url: "http://127.0.0.1:7890" },
    { enabled: false, url: "http://127.0.0.1:7891" },
    { enabled: true, url: "socks5://127.0.0.1:1080" },
  ],
});
assert.strictEqual(list.ok, true);
assert.deepStrictEqual(getEnabledAccountProxies(list.value), [
  { enabled: true, url: "http://127.0.0.1:7890" },
  { enabled: true, url: "socks5://127.0.0.1:1080" },
]);
assert.strictEqual(isAccountProxyEnabled(list.value), true);
assert.strictEqual(getAccountProxyDisplay(list.value), "127.0.0.1:7890 等 2 个");
assert.deepStrictEqual(pickActiveAccountProxy(list.value), {
  enabled: true,
  url: "http://127.0.0.1:7890",
});

const secondDisabled = normalizeAccountProxy({
  proxies: [
    { enabled: false, url: "http://127.0.0.1:7890" },
    { enabled: true, url: "socks5://127.0.0.1:1080" },
  ],
});
assert.strictEqual(secondDisabled.ok, true);
assert.deepStrictEqual(pickActiveAccountProxy(secondDisabled.value), {
  enabled: true,
  url: "socks5://127.0.0.1:1080",
});

const disabledOnly = normalizeAccountProxy({
  proxies: [{ enabled: false, url: "http://127.0.0.1:7890" }],
});
assert.strictEqual(disabledOnly.ok, true);
assert.strictEqual(isAccountProxyEnabled(disabledOnly.value), false);
assert.strictEqual(pickActiveAccountProxy(disabledOnly.value), null);

console.log("accountProxy: ok");
