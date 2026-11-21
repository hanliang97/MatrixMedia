"use strict";

require("@babel/register")({
  extensions: [".js"], ignore: [/node_modules/],
  presets: [["@babel/preset-env", { targets: { node: "20" }, modules: "commonjs" }]],
});
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const babel = require("@babel/core");
const xlsx = require("xlsx");
const { normalizeCreativeStatement } = require("../src/shared/creativeStatement.js");
const { normalizeVideoMetadata } = require("../src/shared/videoMetadata.js");

// 提取实际目录处理函数，发布服务替身只截获调用；绝不连接平台或上传素材。
const source = fs.readFileSync(path.join(__dirname, "../src/main/cli/index.js"), "utf8");
const ast = babel.parseSync(source, { babelrc: false, configFile: false, sourceType: "module" });
const names = ["fileStem", "parseXlsxRows", "resolveFileInDir", "runBatchDirPublish"];
const functions = names.map(name => {
  const node = ast.program.body.find(n => n.type === "FunctionDeclaration" && n.id.name === name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}).join("\n");

async function runCase(rows, replies, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-native-batch-"));
  const calls = [];
  const lines = [];
  try {
    for (const file of ["one.mp4", "two.mp4", "cover.png", "global.png"]) {
      fs.writeFileSync(path.join(dir, file), "fixture only");
    }
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.json_to_sheet(rows), "metadata");
    const config = path.join(dir, "metadata.xlsx");
    xlsx.writeFile(book, config);
    const run = vm.runInNewContext(`${functions}\nrunBatchDirPublish`, {
      fs, path, xlsx, normalizeCreativeStatement, normalizeVideoMetadata,
      console: { log: line => lines.push(JSON.parse(line)), error: () => {} },
      runSingleFilePublish: async value => {
        calls.push(value);
        return replies[calls.length - 1] || { exitCode: 0, status: "success" };
      },
    });
    const exitCode = await run({
      platform: "抖音", phone: "test", partition: "persist:test抖音",
      dir, config, publishAt: "2090-01-02 13:45:00", preferNativeSchedule: true,
      ...overrides,
    }, {});
    return { exitCode, calls, lines, dir };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  const native = await runCase([{
    文件名: "one.mp4", 标题: "批量标题", 简介: "独立简介", 视频号短标题: "批量短标题",
    标签: "测试,原创", 封面: "cover.png", 创作声明: "无标注",
  }], [{ exitCode: 0, status: "native_scheduled", nativeScheduleVerified: true }]);
  assert.equal(native.exitCode, 0);
  assert.equal(native.calls.length, 1);
  const sent = native.calls[0];
  assert.equal(sent.dir, null);
  assert.equal(sent.file, path.join(native.dir, "one.mp4"));
  assert.equal(sent.cover, path.join(native.dir, "cover.png"));
  assert.equal(sent.title, "批量标题");
  assert.equal(sent.description, "独立简介");
  assert.equal(sent.shortTitle, "批量短标题");
  assert.deepEqual(Array.from(sent.tags), ["测试", "原创"]);
  assert.equal(sent.preferNativeSchedule, true);
  assert.equal(sent.publishAt, "2090-01-02 13:45:00");
  assert.equal(native.lines.at(-1).succeeded, 1);
  assert.equal(native.lines.filter(l => l.progress).length, 2, "保留开始/完成进度消息");

  const partial = await runCase([{ 文件名: "one.mp4" }, { 文件名: "two.mp4" }], [
    { exitCode: 0, status: "success" }, { exitCode: 3, status: "failed" },
  ]);
  assert.equal(partial.exitCode, 1, "保留批量部分失败退出码");
  assert.equal(partial.lines.at(-1).failed, 1);
  const failed = await runCase([{ 文件名: "one.mp4" }], [{ exitCode: 3, status: "failed" }]);
  assert.equal(failed.exitCode, 2, "保留批量全部失败退出码");
  const missing = await runCase([{ 文件名: "missing.mp4" }], []);
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.calls.length, 0);
  const badCover = await runCase([{ 文件名: "one.mp4", 封面: "missing.png" }], []);
  assert.equal(badCover.calls.length, 0);
  assert.equal(badCover.exitCode, 2);
  const cover = await runCase([{ 文件名: "one.mp4", 封面: "cover.png" }], [], { cover: "global.png" });
  assert.equal(cover.calls[0].cover, path.join(cover.dir, "global.png"));

  for (const code of [4, 5]) {
    const attention = await runCase([{ 文件名: "one.mp4" }], [{ exitCode: code, status: "needs_attention" }]);
    assert.equal(attention.exitCode, code);
    assert.equal(attention.lines.at(-1).succeeded, 0);
  }
  const draft = await runCase([{ 文件名: "one.mp4" }], [{ exitCode: 0, status: "draft" }], {
    draft: true, publishAt: null, preferNativeSchedule: false,
  });
  assert.equal(draft.exitCode, 0);
  assert.equal(draft.calls[0].draft, true);
  console.log("test-native-schedule-batch: 目录参数、封面、标签、草稿、进度与退出码回归通过");
})().catch(error => { console.error(error); process.exitCode = 1; });
