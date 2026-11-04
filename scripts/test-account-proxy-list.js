const assert = require("assert");
const {
  normalizeAccountProxy,
  isAccountProxyEnabled,
  getAccountProxyDisplay,
  getEnabledAccountProxies,
  pickActiveAccountProxy,
  parseProxyUrl,
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

// 凭据里畸形的百分号编码：应返回 { ok: false, error }，而不是抛 URIError（#44）
for (const bad of [
  "http://user%:pass@proxy.invalid:8080",
  "http://user:pass%FF@proxy.invalid:8080",
  "http://%ZZ@proxy.invalid:8080",
  "http://user%2@proxy.invalid:8080",
  "http://%E4%BD@proxy.invalid:8080",
]) {
  const r = parseProxyUrl(bad);
  assert.strictEqual(r.ok, false, `${bad} 应校验失败`);
  assert.strictEqual(typeof r.error, "string", `${bad} 应带中文错误信息`);
  assert.ok(!r.error.includes("URI"), `${bad} 错误信息不应暴露内部异常`);
}
// 合法转义与中文凭据不受影响
for (const good of [
  "http://user%40x:p%23ss@proxy.invalid:8080",
  "http://%E4%B8%AD%E6%96%87:%E5%AF%86%E7%A0%81@proxy.invalid:8080",
]) {
  const r = parseProxyUrl(good);
  assert.strictEqual(r.ok, true, `${good} 应校验通过`);
  assert.ok(r.value.hasAuth);
}
// normalizeAccountProxy 链路同样不再抛异常
assert.strictEqual(
  normalizeAccountProxy({ enabled: true, url: "http://user%:pass@proxy.invalid:8080" }).ok,
  false
);

console.log("accountProxy: ok");

// 回归：socks5://user:pass@host:port 必须能解析出 host/凭据。
// Chromium 的 new URL() 对 socks5: 这类非特殊协议不做 authority 解析
// （hostname/username 全空），曾在渲染进程保存代理时误报「缺少 host」。
const socksAuth = parseProxyUrl("socks5://pvb4ya1:yxz02n@124.236.71.226:17701");
assert.strictEqual(socksAuth.ok, true, "socks5 带认证应解析成功: " + JSON.stringify(socksAuth));
assert.strictEqual(socksAuth.value.host, "124.236.71.226");
assert.strictEqual(socksAuth.value.port, "17701");
assert.strictEqual(socksAuth.value.username, "pvb4ya1");
assert.strictEqual(socksAuth.value.password, "yxz02n");
assert.strictEqual(socksAuth.value.hasAuth, true);
assert.strictEqual(socksAuth.value.proxyRules, "socks5=124.236.71.226:17701");

const socksNoPort = parseProxyUrl("socks5://u:p@proxy.example.com");
assert.strictEqual(socksNoPort.ok, true);
assert.strictEqual(socksNoPort.value.host, "proxy.example.com");
assert.strictEqual(socksNoPort.value.port, "1080");

const socksIpv6 = parseProxyUrl("socks5://u:p@[2001:db8::1]:1080");
assert.strictEqual(socksIpv6.ok, true, JSON.stringify(socksIpv6));
assert.strictEqual(socksIpv6.value.host, "2001:db8::1");
assert.strictEqual(socksIpv6.value.port, "1080");

const httpWithAuth = parseProxyUrl("http://pvb4ya1:yxz02n@124.236.71.226:17701");
assert.strictEqual(httpWithAuth.ok, true);
assert.strictEqual(httpWithAuth.value.host, "124.236.71.226");
assert.strictEqual(httpWithAuth.value.proxyRules, "http=124.236.71.226:17701;https=124.236.71.226:17701");

const bareHostPort = parseProxyUrl("124.236.71.226:17701");
assert.strictEqual(bareHostPort.ok, true);
assert.strictEqual(bareHostPort.value.scheme, "http");
assert.strictEqual(bareHostPort.value.url, "http://124.236.71.226:17701");

const missingHost = parseProxyUrl("socks5://");
assert.strictEqual(missingHost.ok, false);
assert.ok(missingHost.error.includes("缺少 host"), missingHost.error);

const badPort = parseProxyUrl("http://host:notaport");
assert.strictEqual(badPort.ok, false);
assert.ok(badPort.error.includes("端口无效"), badPort.error);

const unsupported = parseProxyUrl("ftp://1.2.3.4:21");
assert.strictEqual(unsupported.ok, false);
assert.ok(unsupported.error.includes("不支持的代理协议"), unsupported.error);

console.log("socks5/http 解析回归: ok");

// 回归：悟空代理复制的「host|端口|账号|密码」格式自动转换为 http 带认证代理
const wukong = parseProxyUrl("183.131.35.19|21203|f9hm4uc1|yk0yi9k");
assert.strictEqual(wukong.ok, true, "悟空格式应解析成功: " + JSON.stringify(wukong));
assert.strictEqual(wukong.value.scheme, "http");
assert.strictEqual(wukong.value.host, "183.131.35.19");
assert.strictEqual(wukong.value.port, "21203");
assert.strictEqual(wukong.value.username, "f9hm4uc1");
assert.strictEqual(wukong.value.password, "yk0yi9k");
assert.strictEqual(wukong.value.hasAuth, true);
assert.strictEqual(
  wukong.value.url,
  "http://f9hm4uc1:yk0yi9k@183.131.35.19:21203"
);
assert.strictEqual(
  wukong.value.proxyRules,
  "http=183.131.35.19:21203;https=183.131.35.19:21203"
);

// 悟空格式带首尾空白/换行也应能解析
const wukongSpaced = parseProxyUrl("  183.131.35.19|21203|f9hm4uc1|yk0yi9k\n");
assert.strictEqual(wukongSpaced.ok, true);
assert.strictEqual(wukongSpaced.value.host, "183.131.35.19");

// 域名形式的悟空格式同样支持
const wukongDomain = parseProxyUrl("tunnel.wukongdaili.com|21203|u1|p1");
assert.strictEqual(wukongDomain.ok, true);
assert.strictEqual(wukongDomain.value.host, "tunnel.wukongdaili.com");

// 非四段的竖线格式不应误判（比如普通 URL 里带竖线的场景）
const notPipe = parseProxyUrl("http://host:1|2|3");
assert.strictEqual(notPipe.ok, false);

console.log("悟空代理格式回归: ok");
