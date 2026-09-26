"use strict";

/**
 * 验证「登录失效」分支同时回执 puppeteer-noLogin 与 puppeteerFile-done。
 *
 * 背景：GUI 发布记录只由 puppeteerFile-done 驱动（videoManager/index.vue）。
 * 若登录失效时只发 puppeteer-noLogin，记录会永远停在初始的
 * publishStatus="drafting"（界面显示「保存草稿中」），用户看不到失败。
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(
  path.join(root, "src/main/services/puppeteerFile.js"),
  "utf8"
);

/* 1) 定位登录失效分支 */
const loginBranchIdx = src.indexOf("if (isPlatformLoginUrl(data.pt, currentUrl))");
assert.ok(loginBranchIdx > 0, "应能找到 isPlatformLoginUrl 分支");

/* 取该分支的代码块（到下一个 return 后的收尾大括号为止） */
const branchEnd = src.indexOf("if (isXhsTask)", loginBranchIdx);
assert.ok(branchEnd > loginBranchIdx, "应能找到分支结束位置");
const branch = src.slice(loginBranchIdx, branchEnd);

/* 2) 分支内必须同时回执两个事件 */
assert.ok(
  branch.includes('safeReply("puppeteer-noLogin"'),
  "登录失效分支应回执 puppeteer-noLogin"
);
assert.ok(
  branch.includes('safeReply("puppeteerFile-done"'),
  "登录失效分支必须同时回执 puppeteerFile-done，否则 GUI 记录永远停在「保存草稿中」"
);

/* 3) puppeteerFile-done 必须是失败状态，且带上可读原因 */
const doneIdx = branch.indexOf('safeReply("puppeteerFile-done"');
const doneCall = branch.slice(doneIdx, doneIdx + 260);
assert.ok(
  /status:\s*false/.test(doneCall),
  "puppeteerFile-done 应带 status:false（失败），避免被当作成功"
);
assert.ok(
  /message/.test(doneCall),
  "puppeteerFile-done 应带 message，界面才能显示失败原因"
);

/* 4) 三处 puppeteer-noLogin 都应成对发出 puppeteerFile-done */
const noLoginCount = (src.match(/safeReply\("puppeteer-noLogin"/g) || []).length;
assert.strictEqual(noLoginCount, 3, `应有 3 处 puppeteer-noLogin，实际 ${noLoginCount}`);

/* 逐处检查：每处 noLogin 之后 600 字符内应出现 puppeteerFile-done 或 replyFailureWithShot */
let cursor = 0;
for (let i = 0; i < noLoginCount; i++) {
  const idx = src.indexOf('safeReply("puppeteer-noLogin"', cursor);
  const after = src.slice(idx, idx + 700);
  const paired =
    after.includes('safeReply("puppeteerFile-done"') ||
    after.includes("replyFailureWithShot");
  assert.ok(
    paired,
    `第 ${i + 1} 处 puppeteer-noLogin 缺少配对的 puppeteerFile-done / replyFailureWithShot`
  );
  cursor = idx + 1;
}

console.log("test-puppeteer-nologin-pairing passed");
