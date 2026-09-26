"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  LOGIN_COOKIE_RULE,
  SPH_AUTH_PROBE,
  evaluateLoginCookies,
  getCookieExpireMs,
  isSphLoginUrl,
  isSphSessionInvalid,
  isSphSessionValid,
  sphInvalidReason,
} = require("../src/shared/loginState");

const NOW = 1_800_000_000_000; // 固定"当前时间"，让过期判定可复现
const FUTURE = Math.floor((NOW + 86400_000) / 1000); // 未来 1 天
const PAST = Math.floor((NOW - 86400_000) / 1000); // 已过期 1 天

/* 1) 规则表覆盖所有需要登录的平台，且一律返回 boolean */
for (const pt of [
  "抖音",
  "百家号",
  "头条",
  "视频号",
  "番茄视频",
  "哔哩哔哩",
  "快手",
  "掘金",
]) {
  assert.strictEqual(typeof LOGIN_COOKIE_RULE[pt], "function", `${pt} 应有登录规则`);
}
/* 命中与未命中都必须返回 boolean（原先头条返回的是 string，与 JSDoc 不符） */
for (const pt of ["头条", "掘金"]) {
  const rule = LOGIN_COOKIE_RULE[pt];
  const hit = pt === "头条"
    ? rule({ name: "odin_tt", value: "x".repeat(66) })
    : rule({ name: "passport_csrf_token", value: "x".repeat(11) });
  const miss = rule({ name: "nothing", value: "x".repeat(66) });
  assert.strictEqual(typeof hit, "boolean", `${pt} 命中应返回 boolean`);
  assert.strictEqual(typeof miss, "boolean", `${pt} 未命中应返回 boolean`);
  assert.strictEqual(hit, true);
  assert.strictEqual(miss, false);
}

/* 2) 视频号：sessionid 存在且未过期 → 已登录 */
assert.deepStrictEqual(
  evaluateLoginCookies(
    "视频号",
    [{ name: "sessionid", value: "abc", expirationDate: FUTURE }],
    NOW
  ),
  { loggedIn: true, reason: "", expireMs: FUTURE * 1000 }
);

/* 3) 视频号：无 sessionid → 未登录 */
{
  const r = evaluateLoginCookies("视频号", [{ name: "wxuin", value: "1" }], NOW);
  assert.strictEqual(r.loggedIn, false);
  assert.strictEqual(r.reason, "无登录 cookie");
}

/* 4) 视频号：sessionid 为空值 → 未登录 */
assert.strictEqual(
  evaluateLoginCookies(
    "视频号",
    [{ name: "sessionid", value: "", expirationDate: FUTURE }],
    NOW
  ).loggedIn,
  false
);

/* 5) 视频号：sessionid 已过期（cookie 还在 jar 里）→ 未登录 */
{
  const r = evaluateLoginCookies(
    "视频号",
    [{ name: "sessionid", value: "abc", expirationDate: PAST }],
    NOW
  );
  assert.strictEqual(r.loggedIn, false);
  assert.strictEqual(r.reason, "cookie 已过期");
}

/* 6) 会话 cookie（无 expirationDate）视为未过期，交由真实探测判定 */
assert.strictEqual(
  evaluateLoginCookies("视频号", [{ name: "sessionid", value: "abc" }], NOW)
    .loggedIn,
  true
);

/* 7) 头条需要 odin_tt 长度 > 65 */
assert.strictEqual(
  evaluateLoginCookies(
    "头条",
    [{ name: "odin_tt", value: "x".repeat(66), expirationDate: FUTURE }],
    NOW
  ).loggedIn,
  true
);
assert.strictEqual(
  evaluateLoginCookies(
    "头条",
    [{ name: "odin_tt", value: "x".repeat(65), expirationDate: FUTURE }],
    NOW
  ).loggedIn,
  false
);

/* 8) 掘金需要 passport_csrf_token 长度 > 10 */
assert.strictEqual(
  evaluateLoginCookies(
    "掘金",
    [{ name: "passport_csrf_token", value: "x".repeat(11), expirationDate: FUTURE }],
    NOW
  ).loggedIn,
  true
);
assert.strictEqual(
  evaluateLoginCookies(
    "掘金",
    [{ name: "passport_csrf_token", value: "x".repeat(10), expirationDate: FUTURE }],
    NOW
  ).loggedIn,
  false
);

/* 9) 小红书：四个 cookie 齐全才算登录，有效期取最小值 */
{
  const names = [
    "access-token-creator.xiaohongshu.com",
    "customer-sso-sid",
    "galaxy_creator_session_id",
    "x-user-id-creator.xiaohongshu.com",
  ];
  const full = names.map((n, i) => ({
    name: n,
    value: "v",
    expirationDate: FUTURE + i,
  }));
  const r = evaluateLoginCookies("小红书", full, NOW);
  assert.strictEqual(r.loggedIn, true);
  assert.strictEqual(r.expireMs, FUTURE * 1000, "应取最早过期时间");

  const missing = full.slice(0, 3);
  assert.strictEqual(evaluateLoginCookies("小红书", missing, NOW).loggedIn, false);
}

/* 10) 未知平台 / 空输入不炸 */
assert.strictEqual(evaluateLoginCookies("未知平台", [], NOW).loggedIn, false);
assert.strictEqual(evaluateLoginCookies("视频号", null, NOW).loggedIn, false);
assert.strictEqual(evaluateLoginCookies("视频号", undefined, NOW).loggedIn, false);

/* 11) getCookieExpireMs 边界 */
assert.strictEqual(getCookieExpireMs(null), null);
assert.strictEqual(getCookieExpireMs({}), null);
assert.strictEqual(getCookieExpireMs({ expirationDate: NaN }), null);
assert.strictEqual(getCookieExpireMs({ expirationDate: 1000 }), 1000_000);

/* 12) 视频号鉴权探测：errCode 判定 */
assert.ok(SPH_AUTH_PROBE.url.endsWith("/auth/auth_data"));
assert.deepStrictEqual(SPH_AUTH_PROBE.invalidErrCodes, [300330, 300334]);

// 实测：300330 = 凭据无效；300334 = 会话被服务端作废（两者都会跳登录页）
assert.strictEqual(isSphSessionInvalid({ errCode: 300330 }), true);
assert.strictEqual(isSphSessionInvalid({ errCode: 300334 }), true);
assert.strictEqual(isSphSessionInvalid({ errcode: 300334 }), true);
assert.strictEqual(isSphSessionInvalid({ errCode: 0 }), false);
assert.strictEqual(isSphSessionInvalid({ errCode: 300004 }), false);
assert.strictEqual(isSphSessionInvalid(null), false);
assert.strictEqual(isSphSessionInvalid(undefined), false);
assert.strictEqual(isSphSessionInvalid({}), false);

// 只有 errCode=0 才算明确「有效」
assert.strictEqual(isSphSessionValid({ errCode: 0 }), true);
assert.strictEqual(isSphSessionValid({ errcode: 0 }), true);
assert.strictEqual(isSphSessionValid({ errCode: 300330 }), false);
assert.strictEqual(isSphSessionValid({ errCode: 300334 }), false);
assert.strictEqual(isSphSessionValid(null), false);

/* 13) 失效原因文案：两个错误码应给出不同提示 */
{
  const r330 = sphInvalidReason(300330);
  const r334 = sphInvalidReason(300334);
  assert.ok(r330 && r334, "两个失效码都应有文案");
  assert.notStrictEqual(r330, r334, "300330 / 300334 文案应可区分");
  assert.ok(r330.includes("重新登录"), "文案应提示重新登录");
  assert.ok(r334.includes("重新登录"), "文案应提示重新登录");
  // 未知码要有兜底
  assert.ok(sphInvalidReason(999999).length > 0, "未知码应有兜底文案");
  assert.ok(sphInvalidReason(undefined).length > 0, "空值应有兜底文案");
}

/* 14) 登录页 URL 识别（用于 302 判定） */
assert.strictEqual(
  isSphLoginUrl("https://channels.weixin.qq.com/login.html"),
  true
);
assert.strictEqual(
  isSphLoginUrl("https://channels.weixin.qq.com/login/xxx"),
  true
);
assert.strictEqual(
  isSphLoginUrl("https://channels.weixin.qq.com/login.html?from=abc"),
  true
);
assert.strictEqual(
  isSphLoginUrl("https://channels.weixin.qq.com/platform/post/list"),
  false
);
assert.strictEqual(
  isSphLoginUrl("https://channels.weixin.qq.com/platform/post/create"),
  false
);
assert.strictEqual(isSphLoginUrl("https://other.com/login.html"), false);
assert.strictEqual(isSphLoginUrl(""), false);
assert.strictEqual(isSphLoginUrl(null), false);
assert.strictEqual(isSphLoginUrl(undefined), false);

/* 15) partition 不得被 split("-") 裁剪（探测与 cookie 判定必须同一会话） */
{
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  const probeSrc = fs.readFileSync(
    path.join(root, "src/main/services/sphAuthProbe.js"),
    "utf8"
  );
  assert.ok(
    !/session\.fromPartition\([^)]*\.split\("-"\)/.test(probeSrc),
    "sphAuthProbe 不应裁剪 partition：含 `-` 时会打到空 session，把正常账号误判成未登录"
  );
  const cliSrc = fs.readFileSync(
    path.join(root, "src/main/cli/runAccountsCli.js"),
    "utf8"
  );
  assert.ok(
    !/session\.fromPartition\([^)]*\.split\("-"\)/.test(cliSrc),
    "runAccountsCli 不应裁剪 partition"
  );
}

console.log("test-login-state passed");
