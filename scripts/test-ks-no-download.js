/**
 * 快手禁下载参数单元测试（不依赖 Electron / 平台页面）：
 * 1. CLI：--no-download → noDownload=true，缺省 false
 * 2. HTTP body / MCP：noDownload:true → 产出 --no-download argv（且被识别为合法字段）
 * 3. help 文案包含 --no-download
 *
 * 背景：快手发布页「允许下载此作品」默认勾选，素材可被下载搬运。
 * 需要「宁可不发，不可发出可下载的作品」——参数漏传会静默降级，故用测试锁住三入口的解析面。
 *
 * 运行：yarn test:ks-no-download
 */

"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});

const assert = require("assert");
const {
  parsePublishArgs,
  parsePublishRequest,
  parseMultiPublishRequest,
  publishBodyToArgv,
  publishHelpText,
} = require("../src/main/cli/parsePublishArgs");

function baseArgv() {
  return ["-p", "ks", "--phone", "字探", "-f", "./v.mp4", "-t", "标题"];
}

/* ---------- 1. CLI 参数 ---------- */
{
  const off = parsePublishArgs(baseArgv());
  assert.strictEqual(off.ok, true);
  assert.strictEqual(off.value.noDownload, false, "缺省必须是关闭（不影响其它平台）");

  const on = parsePublishArgs([...baseArgv(), "--no-download"]);
  assert.strictEqual(on.ok, true);
  assert.strictEqual(on.value.noDownload, true, "--no-download 应置 noDownload=true");
  console.log("✓ CLI --no-download");
}

/* ---------- 2. HTTP body / MCP argv ---------- */
{
  assert.ok(publishBodyToArgv({ noDownload: true }).includes("--no-download"));
  assert.ok(
    publishBodyToArgv({ "no-download": true }).includes("--no-download"),
    "短横线写法也应识别"
  );
  assert.ok(
    !publishBodyToArgv({ noDownload: false }).includes("--no-download"),
    "false 不应产出参数"
  );

  const r = parsePublishRequest({
    platform: "ks",
    phone: "字探",
    file: "./v.mp4",
    title: "标题",
    noDownload: true,
  });
  assert.strictEqual(r.ok, true, `noDownload 必须是合法 body 字段: ${r.error || ""}`);
  assert.strictEqual(r.value.noDownload, true);
  assert.strictEqual(r.value.platform, "快手");

  // 多平台请求里共享字段也要透传到每个平台
  const multi = parseMultiPublishRequest({
    phone: "字探",
    file: "./v.mp4",
    title: "标题",
    noDownload: true,
    platforms: ["ks", "dy"],
  });
  assert.strictEqual(multi.ok, true, multi.error);
  const ksItem = multi.value.find((item) => item.platform === "快手");
  const dyItem = multi.value.find((item) => item.platform === "抖音");
  assert.strictEqual(ksItem.noDownload, true, "多平台共享字段透传（ks）");
  assert.strictEqual(dyItem.noDownload, true, "共享字段对所有目标一致（dy 侧忽略执行）");
  console.log("✓ HTTP/MCP noDownload 透传");
}

/* ---------- 3. help 文案 ---------- */
{
  const help = publishHelpText();
  assert.ok(help.includes("--no-download"), "help 必须列出该参数");
  assert.ok(help.includes("允许下载此作品"), "help 应说明作用对象");
  console.log("✓ help 文案");
}

console.log("\n全部通过：快手禁下载参数（CLI / HTTP / MCP / help）");
