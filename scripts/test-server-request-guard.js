"use strict";

/**
 * 内置 HTTP 服务（127.0.0.1:30088）访问守卫回归测试。
 *
 * 背景：服务端对所有响应发了 `Access-Control-Allow-Origin: *`，
 * 因此「谁算可信来源」是唯一一道门。历史上这道门只对 Origin 做了
 * 前缀匹配（`^(https?://localhost)`），于是：
 *
 *   1. 外部页面 http://localhost.evil.com 携带的 Origin 会被判为可信，
 *      配合 `*` 的 CORS 头，任意网站都能跨源读写本机 API；
 *   2. `/publish` 是全项目唯一一个漏加守卫的写接口，且它接受 http(s)
 *      远程视频 URL（会先下载再发布到已登录账号）。
 *
 * 本测试锁住两件事：origin 必须按 hostname 精确比对；每个写接口都必须带守卫。
 */

const assert = require("assert");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const {
  isTrustedLocalRequest,
  isTrustedOrigin,
} = require(path.join(root, "src/main/server/requestGuard.js"));

const reqWithOrigin = (origin) => ({ headers: { origin } });
const trusted = (origin) => isTrustedLocalRequest(reqWithOrigin(origin));
const refererTrusted = (referer) =>
  isTrustedLocalRequest({ headers: { referer } });

/* ---------- 1. 可信来源：必须是本机页面 ---------- */

const TRUSTED = [
  "http://localhost:9080",
  "http://localhost",
  "https://localhost:9080",
  "http://127.0.0.1:30088",
  "https://127.0.0.1",
  "http://[::1]:9080",
];
for (const origin of TRUSTED) {
  assert.strictEqual(trusted(origin), true, `应放行本机来源: ${origin}`);
}

/* ---------- 2. 前缀撞名：外部域名不得借 localhost 前缀蒙混 ---------- */

const UNTRUSTED = [
  // 早期正则的真实漏点
  "http://localhost.evil.com",
  "https://localhost.attacker.net:9080",
  "http://127.0.0.1.nip.io:30088",
  "https://127.0.0.1.example.com",
  // 同形/相似前缀
  "http://localhost-evil.com",
  "http://localhostx",
  "http://127.0.0.10",
  "http://0.0.0.0:30088",
  // A local file URL alone does not prove this request came from the app;
  // packaged requests must use the private token.
  "file://",
  "file:///C:/app/dist/electron/index.html",
  "file:///C:/Users/Public/Downloads/untrusted.html",
  // 任意外站
  "https://evil.com",
  "http://192.168.1.10:9080",
  // 沙箱/不透明来源
  "null",
  "",
];
for (const origin of UNTRUSTED) {
  assert.strictEqual(trusted(origin), false, `应拒绝外部来源: ${origin}`);
}

/* ---------- 3. 解析异常不抛错 ---------- */

for (const broken of ["http://", "::::", "//localhost", "http://[::1"]) {
  assert.doesNotThrow(() => trusted(broken), `畸形 Origin 不应抛错: ${broken}`);
  assert.strictEqual(trusted(broken), false, `畸形 Origin 应拒绝: ${broken}`);
}

/* ---------- 4. Referer 走同一套判定 ---------- */

assert.strictEqual(refererTrusted("http://localhost:9080/index.html"), true);
assert.strictEqual(refererTrusted("http://localhost.evil.com/x.html"), false);

/* ---------- 5. 令牌仍然无条件放行（file:// 页面靠它） ---------- */

const { SERVER_REQUEST_TOKEN } = require(path.join(
  root,
  "src/main/server/requestGuard.js"
));
assert.strictEqual(
  isTrustedLocalRequest({
    headers: { "x-matrix-token": SERVER_REQUEST_TOKEN, origin: "https://evil.com" },
  }),
  true,
  "持有效令牌的请求必须放行（打包后 file:// 页面不发 Origin）"
);

/* ---------- 5b. 打包页令牌只发给应用页面，renderer API 请求必须带令牌 ---------- */

const ipcSource = fs.readFileSync(
  path.join(root, "src/main/services/ipcMain.js"),
  "utf8"
);
assert.ok(
  /isInternalAppUrl\(frameUrl/.test(ipcSource),
  "server token IPC 必须用应用导航策略校验请求页面"
);
assert.ok(
  /appRoot:\s*electronApp\.getAppPath\(\)/.test(ipcSource),
  "server token IPC 必须限制在应用安装目录"
);
const rendererRequestSource = fs.readFileSync(
  path.join(root, "src/renderer/utils/request.js"),
  "utf8"
);
assert.ok(
  /getServerToken\(\)/.test(rendererRequestSource) &&
    /X-Matrix-Token/.test(rendererRequestSource),
  "renderer API 请求必须携带主进程签发的令牌"
);
assert.ok(
  /target\.origin === ['"]http:\/\/127\.0\.0\.1:30088['"]/.test(
    rendererRequestSource
  ),
  "renderer API 令牌不得附加到其他 origin"
);

/* ---------- 6. 每个写接口都必须带守卫 ---------- */

const routeSource = fs.readFileSync(
  path.join(root, "src/main/server/routes/index.js"),
  "utf8"
);
const writeRouteRe = /router\.(post|put|patch|delete)\(\s*["']([^"']+)["']/g;
const starts = [];
let match;
while ((match = writeRouteRe.exec(routeSource)) !== null) {
  starts.push({ index: match.index, method: match[1].toUpperCase(), path: match[2] });
}
assert.ok(starts.length >= 3, "应至少识别出 3 个写接口，路由正则可能已失效");

const unguarded = [];
starts.forEach((route, i) => {
  const end = i + 1 < starts.length ? starts[i + 1].index : routeSource.length;
  const body = routeSource.slice(route.index, end);
  if (!body.includes("isTrustedLocalRequest")) {
    unguarded.push(`${route.method} ${route.path}`);
  }
});
assert.deepStrictEqual(
  unguarded,
  [],
  `以下写接口缺少访问守卫: ${unguarded.join(", ")}`
);

/* ---------- 7. CORS 通配符必须与守卫共存 ---------- */

const serverSource = fs.readFileSync(
  path.join(root, "src/main/server/server.js"),
  "utf8"
);
if (/Access-Control-Allow-Origin"\s*,\s*"\*"/.test(serverSource)) {
  assert.ok(
    starts.length > 0 && unguarded.length === 0,
    "响应带 Access-Control-Allow-Origin: * 时，所有写接口必须有守卫"
  );
}

console.log("test-server-request-guard: 全部断言通过");
