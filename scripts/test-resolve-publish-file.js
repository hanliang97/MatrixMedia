"use strict";

/**
 * 远程发布文件（CLI / HTTP API 的 `file: http(s)://...`）下载边界回归测试。
 *
 * 背景（Issue #35「安全审计 · 远程 URL 下载」）：`resolvePublishFile` 早期实现
 * 只做了「下载 + 写盘 + 非空判断」：
 *   - 没有大小上限：一个指向超大文件的 URL 可以把用户磁盘写满（CLI 与被
 *     AI Agent 调用的 HTTP API 都直接吃这个参数）；
 *   - 不校验类型：HTML 错误页会被存成 .mp4，然后交给平台解析，最终只报
 *     「上传失败」，看不出真实原因；
 *   - 半成品不删：超限/中断/类型不符时临时文件留在 temp 目录；
 *   - URL 里的文件名直接落盘：非法字符、超长文件名、伪装扩展名未归一。
 *
 * 本测试用本地 HTTP 服务复现上述场景，并锁住评审后补强的两条：
 *   1. 失败删除必须等写句柄关闭 + 对 Windows EBUSY/EPERM 重试；
 *   2. 清理遗留临时文件只动本模块命名的 `<时间戳>-*`，不碰同目录其它文件。
 */

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

// 独立临时目录，避免污染真实用户 temp 目录
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mm-resolve-file-test-"));
process.env.MATRIXMEDIA_PUBLISH_TEMP_DIR = TEMP_DIR;

const bundlePath = path.join(outDir, "resolvePublishFile.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/resolvePublishFile.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
  external: ["electron", "axios"],
});

const {
  isRemotePublishFile,
  guessFileNameFromUrl,
  toSafeTempFileName,
  resolvePublishFile,
  pruneStaleTempFiles,
  unlinkWithRetry,
  looksLikeVideoContainer,
  needsContainerSniff,
  STALE_TEMP_FILE_MS,
} = require(bundlePath);

const tempFiles = () =>
  fs.existsSync(TEMP_DIR)
    ? fs.readdirSync(TEMP_DIR).filter((n) => n !== ".DS_Store")
    : [];

/* ---------- 1. URL 识别 ---------- */

assert.strictEqual(isRemotePublishFile("https://a.com/v.mp4"), true);
assert.strictEqual(isRemotePublishFile("HTTP://a.com/v.mp4"), true);
assert.strictEqual(isRemotePublishFile("  http://a.com/v.mp4  "), true);
assert.strictEqual(isRemotePublishFile("/Users/x/v.mp4"), false);
assert.strictEqual(isRemotePublishFile("ftp://a.com/v.mp4"), false);

/* ---------- 2. 展示名保持历史语义（publishVideo 去重键依赖它） ---------- */

assert.strictEqual(guessFileNameFromUrl("https://a.com/videos/clip.mp4"), "clip.mp4");
assert.strictEqual(guessFileNameFromUrl("https://a.com/videos/clip.MOV"), "clip.MOV");
// 无扩展名 / 非视频扩展名：展示名保持原样，补扩展名是落盘名（toSafeTempFileName）的事
assert.strictEqual(guessFileNameFromUrl("https://a.com/download/video"), "video");
assert.strictEqual(guessFileNameFromUrl("https://a.com/error-page.html"), "error-page.html");
// 路径穿越（含编码形式）只保留最后一段
assert.strictEqual(guessFileNameFromUrl("https://a.com/../../etc/passwd"), "passwd");
assert.ok(
  !guessFileNameFromUrl("https://a.com/%2e%2e%2f.mp4").includes("/"),
  "编码穿越未被压平"
);

/* ---------- 3. 落盘文件名归一（安全 + 字节长度） ---------- */

assert.strictEqual(toSafeTempFileName("video"), "video.mp4");
assert.strictEqual(toSafeTempFileName("error-page.html"), "error-page.mp4");
assert.strictEqual(toSafeTempFileName("clip.MOV"), "clip.MOV");
assert.strictEqual(toSafeTempFileName("../../etc/passwd"), "passwd.mp4");
assert.ok(/^matrixmedia-\d+\.mp4$/.test(toSafeTempFileName("..")), "纯点号未回退默认名");
const dirty = toSafeTempFileName("a".repeat(200) + " <b>.mp4");
assert.ok(Buffer.byteLength(dirty) <= 120, `落盘名超过 120 字节: ${Buffer.byteLength(dirty)}`);
assert.ok(!/[<>]/.test(dirty), `非法字符未替换: ${dirty}`);
// 中文名按字节截断：80 个汉字 = 240 字节，必须被截到 120 字节以内
const cjk = toSafeTempFileName("视".repeat(80) + ".mp4");
assert.ok(Buffer.byteLength(cjk) <= 120, `中文名未按字节截断: ${Buffer.byteLength(cjk)}`);
assert.ok(cjk.endsWith(".mp4"), "截断把扩展名吃掉了");

/* ---------- 3.5 容器魔数判断（纯函数） ---------- */

const mp4Head = Buffer.alloc(32, 0);
mp4Head.writeUInt32BE(24, 0);
mp4Head.write("ftyp", 4, "latin1");
const freeHead = Buffer.alloc(32, 0);
freeHead.write("free", 0, "latin1");
const mkvHead = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12, 0)]);
const aviHead = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("AVI ", "latin1"),
  Buffer.alloc(8, 0),
]);
const flvHead = Buffer.concat([Buffer.from("FLV", "latin1"), Buffer.alloc(13, 0)]);
const htmlHead = Buffer.from("<!doctype html><html><body>404</body></html>");

for (const [label, buf] of [
  ["mp4", mp4Head],
  ["mp4(free 开头)", freeHead],
  ["mkv", mkvHead],
  ["avi", aviHead],
  ["flv", flvHead],
]) {
  assert.strictEqual(looksLikeVideoContainer(buf), true, `${label} 未识别为视频容器`);
}
assert.strictEqual(looksLikeVideoContainer(htmlHead), false, "HTML 被识别成视频容器");
assert.strictEqual(looksLikeVideoContainer(Buffer.from([1, 2, 3])), false, "短数据被识别成视频");
assert.strictEqual(needsContainerSniff("application/octet-stream"), true);
assert.strictEqual(needsContainerSniff(""), true);
assert.strictEqual(needsContainerSniff("video/mp4; charset=utf-8"), false);

/* ---------- 4. 下载行为 ---------- */

const BIG = 8 * 1024; // 8 KB
const MAX = 4 * 1024; // 测试用上限 4 KB

function makeServer() {
  return http.createServer((req, res) => {
    if (req.url === "/ok.mp4") {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": 1024 });
      res.end(Buffer.alloc(1024, 1));
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/ok.mp4" });
      res.end();
      return;
    }
    if (req.url === "/gzip-big.mp4") {
      // 内容编码 gzip：计数必须按解压后的真实字节
      const body = zlib.gzipSync(Buffer.alloc(BIG, 4));
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Encoding": "gzip" });
      res.end(body);
      return;
    }
    if (req.url === "/html-as-octet.mp4") {
      // 404 页面以通用二进制返回：只信 Content-Type 会被存成 .mp4
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("<!doctype html><html><body>404 Not Found</body></html>");
      return;
    }
    if (req.url === "/json-as-octet.mp4") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end('{"error":"not found"}');
      return;
    }
    if (req.url === "/mp4-as-octet.mp4") {
      const body = Buffer.alloc(1024, 0);
      body.writeUInt32BE(24, 0);
      body.write("ftyp", 4, "latin1");
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
      res.end(body);
      return;
    }
    if (req.url === "/mkv-as-octet.mkv") {
      const body = Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        Buffer.alloc(1020, 0),
      ]);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
      res.end(body);
      return;
    }
    if (req.url === "/short-as-octet.mp4") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(Buffer.from([1, 2, 3, 4]));
      return;
    }
    if (req.url === "/video-type-html.mp4") {
      // 服务端明确声明 video/*：按设计信任，不再嗅探（有意识取舍）
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end("<html><body>500</body></html>");
      return;
    }
    if (req.url === "/html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>404 Not Found</body></html>");
      return;
    }
    if (req.url === "/json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"error":"not found"}');
      return;
    }
    if (req.url === "/declared-big.mp4") {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": BIG });
      res.end(Buffer.alloc(BIG, 2));
      return;
    }
    if (req.url === "/chunked-big.mp4") {
      // 不给 Content-Length，只能靠流式计数拦住
      res.writeHead(200, { "Content-Type": "video/mp4" });
      let sent = 0;
      const timer = setInterval(() => {
        if (sent >= BIG) {
          clearInterval(timer);
          res.end();
          return;
        }
        sent += 1024;
        res.write(Buffer.alloc(1024, 3));
      }, 5);
      res.on("close", () => clearInterval(timer));
      return;
    }
    if (req.url === "/burst-big.mp4") {
      // 一次性灌一大块：复现「首块即超限、写句柄还没 open」的竞态
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(Buffer.alloc(BIG * 2, 5));
      return;
    }
    if (req.url === "/empty.mp4") {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": 0 });
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
}

const expectReject = async (label, promise, pattern) => {
  let error = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${label}: 预期失败但成功了`);
  assert.ok(
    pattern.test(String(error.message)),
    `${label}: 错误信息不含期望内容 → ${error.message}`
  );
  assert.deepStrictEqual(tempFiles(), [], `${label}: 失败后临时文件未清理`);
};

(async () => {
  const server = makeServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // 正常下载：落到临时目录，cleanup 能删掉
    const ok = await resolvePublishFile(`${base}/ok.mp4`);
    assert.ok(fs.existsSync(ok.localPath), "正常下载未落盘");
    assert.ok(ok.localPath.startsWith(TEMP_DIR), "落盘路径不在临时目录");
    assert.ok(path.basename(ok.localPath).endsWith("-ok.mp4"), "文件名未保留原后缀");
    assert.strictEqual(fs.statSync(ok.localPath).size, 1024);
    ok.cleanup();
    assert.deepStrictEqual(tempFiles(), [], "cleanup 未删除临时文件");

    // 302 重定向后仍是视频：按最终响应判定，正常下载
    const redirected = await resolvePublishFile(`${base}/redirect`);
    assert.strictEqual(fs.statSync(redirected.localPath).size, 1024);
    redirected.cleanup();

    // 类型不符：HTML / JSON 必须直接拒绝，而不是存成 .mp4 交给平台
    await expectReject("HTML 响应", resolvePublishFile(`${base}/html`), /不是视频文件/);
    await expectReject("JSON 响应", resolvePublishFile(`${base}/json`), /不是视频文件/);

    // 通用 Content-Type：按容器魔数复核，错误页 / JSON 不能存成 .mp4
    await expectReject(
      "HTML 伪装 octet-stream",
      resolvePublishFile(`${base}/html-as-octet.mp4`),
      /不是视频文件/
    );
    await expectReject(
      "JSON 伪装 octet-stream",
      resolvePublishFile(`${base}/json-as-octet.mp4`),
      /不是视频文件/
    );
    await expectReject(
      "过短内容 octet-stream",
      resolvePublishFile(`${base}/short-as-octet.mp4`),
      /不是视频文件/
    );

    // 真正的视频 + 通用 Content-Type：魔数通过，正常下载
    const octetMp4 = await resolvePublishFile(`${base}/mp4-as-octet.mp4`);
    assert.strictEqual(fs.statSync(octetMp4.localPath).size, 1024);
    octetMp4.cleanup();
    const octetMkv = await resolvePublishFile(`${base}/mkv-as-octet.mkv`);
    assert.ok(octetMkv.localPath.endsWith(".mkv"), "mkv 落盘扩展名不对");
    octetMkv.cleanup();
    assert.deepStrictEqual(tempFiles(), [], "魔数通过的下载残留了临时文件");

    // 服务端明确声明 video/* 时按设计信任（不嗅探）
    const trusted = await resolvePublishFile(`${base}/video-type-html.mp4`);
    assert.ok(fs.existsSync(trusted.localPath), "声明 video/* 时不应被嗅探拦下");
    trusted.cleanup();

    // 错误信息不再出现「下载视频失败: 下载远程视频失败:」双重前缀
    let doublePrefix = null;
    try {
      await resolvePublishFile(`${base}/missing.mp4`);
    } catch (e) {
      doublePrefix = e.message;
    }
    assert.ok(doublePrefix, "404 未抛错");
    assert.ok(!/下载视频失败/.test(doublePrefix), `模块层错误信息带了调用方前缀: ${doublePrefix}`);

    // 服务端声明超限：不下载实体，直接失败
    await expectReject(
      "Content-Length 超限",
      resolvePublishFile(`${base}/declared-big.mp4`, { maxBytes: MAX }),
      /超过大小上限/
    );

    // 无 Content-Length 的分块响应：流式计数拦截，且半成品被删除
    await expectReject(
      "分块超限",
      resolvePublishFile(`${base}/chunked-big.mp4`, { maxBytes: MAX }),
      /超过大小上限/
    );

    // gzip 响应：按解压后的字节数拦截
    await expectReject(
      "gzip 超限",
      resolvePublishFile(`${base}/gzip-big.mp4`, { maxBytes: MAX }),
      /超过大小上限/
    );

    // 空文件
    await expectReject("空文件", resolvePublishFile(`${base}/empty.mp4`), /为空/);

    // 突发单块超限：首块就超限（写句柄可能还没 open）也不能留 0 字节残骸
    for (let i = 0; i < 10; i += 1) {
      await expectReject(
        `突发超限 #${i + 1}`,
        resolvePublishFile(`${base}/burst-big.mp4`, { maxBytes: MAX }),
        /超过大小上限/
      );
    }

    // 大小上限可配置：同一个大文件在默认上限下正常下载
    const big = await resolvePublishFile(`${base}/declared-big.mp4`);
    assert.strictEqual(fs.statSync(big.localPath).size, BIG);
    big.cleanup();
    assert.deepStrictEqual(tempFiles(), [], "默认上限下 cleanup 未删除临时文件");
  } finally {
    server.close();
  }

  /* ---------- 5. Windows 删除失败重试（EBUSY / EPERM） ---------- */

  const retryTarget = path.join(TEMP_DIR, "retry-target.mp4");
  fs.writeFileSync(retryTarget, "x");
  const realUnlink = fs.unlink;
  let unlinkCalls = 0;
  fs.unlink = (target, cb) => {
    if (target === retryTarget && unlinkCalls < 2) {
      unlinkCalls += 1;
      const err = new Error("EBUSY: resource busy or locked");
      err.code = "EBUSY";
      return cb(err);
    }
    return realUnlink(target, cb);
  };
  try {
    const removedOk = await unlinkWithRetry(retryTarget, 4, 5);
    assert.strictEqual(removedOk, true, "EBUSY 重试后仍未删除");
    assert.strictEqual(unlinkCalls, 2, `重试次数不对: ${unlinkCalls}`);
    assert.ok(!fs.existsSync(retryTarget), "重试成功后文件仍在");
  } finally {
    fs.unlink = realUnlink;
  }

  /* ---------- 6. 遗留临时文件清理：只动本模块命名的文件 ---------- */

  const stale = path.join(TEMP_DIR, `1700000000000-stale-clip.mp4`);
  const fresh = path.join(TEMP_DIR, `1700000000000-fresh-clip.mp4`);
  // 同目录下不属于本模块的文件（模拟 MATRIXMEDIA_PUBLISH_TEMP_DIR 指到别处）
  const foreignOld = path.join(TEMP_DIR, "user-important.mov");
  fs.writeFileSync(stale, "old");
  fs.writeFileSync(fresh, "new");
  fs.writeFileSync(foreignOld, "keep me");
  const old = Date.now() - STALE_TEMP_FILE_MS - 60 * 1000;
  for (const f of [stale, foreignOld]) fs.utimesSync(f, old / 1000, old / 1000);

  const removed = pruneStaleTempFiles(TEMP_DIR);
  assert.strictEqual(removed, 1, `应只删除 1 个超期临时文件，实际 ${removed}`);
  assert.ok(!fs.existsSync(stale), "超期临时文件未删除");
  assert.ok(fs.existsSync(fresh), "未超期的临时文件被误删");
  assert.ok(fs.existsSync(foreignOld), "误删了非本模块命名的文件");

  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  console.log("test-resolve-publish-file: 全部通过");
})().catch((e) => {
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
  console.error(e);
  process.exit(1);
});
