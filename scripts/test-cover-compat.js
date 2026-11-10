"use strict";

/**
 * coverCompat 单测：3:4 居中裁切数学 + 归一/回退行为。
 * Electron nativeImage 在纯 node 下不可用，测试通过 esbuild 打包
 * coverCompat.js（electron external）后注入 fake 实现验证逻辑：
 *   - 横图/竖图 → 居中裁切矩形正确，产物写入 tmpdir
 *   - 已是 1080×1440 的 jpg/png → 免重编码透传
 *   - 解不了的格式（webp/gif）/解码失败/无 nativeImage → 回退原图不抛错
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { build } = require("esbuild");

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFileBuf(magic, extra = 16) {
  return Buffer.concat([magic, Buffer.alloc(extra)]);
}

/** fake nativeImage：按源尺寸模拟 decode/crop/resize/toJPEG，记录调用参数 */
function makeFakeNativeImage(srcW, srcH, { decodable = true } = {}) {
  const calls = { crop: [], resize: [] };
  const makeOut = (w, h) => ({
    isEmpty: () => false,
    getSize: () => ({ width: w, height: h }),
    resize: (opts) => {
      calls.resize.push(opts);
      return {
        isEmpty: () => false,
        toJPEG: (q) => Buffer.from(`fake-jpeg-${opts.width}x${opts.height}-q${q}`),
      };
    },
    toJPEG: (q) => Buffer.from(`fake-jpeg-${w}x${h}-q${q}`),
  });
  return {
    calls,
    createFromBuffer(buf) {
      if (!decodable) return { isEmpty: () => true };
      // 只认 JPEG/PNG 魔数（对齐真实 nativeImage：webp/gif 解不了 → isEmpty）
      const ok =
        (buf[0] === 0xff && buf[1] === 0xd8) ||
        (buf[0] === 0x89 && buf[1] === 0x50);
      if (!ok) return { isEmpty: () => true };
      return {
        isEmpty: () => false,
        getSize: () => ({ width: srcW, height: srcH }),
        crop: (rect) => {
          calls.crop.push(rect);
          return makeOut(rect.width, rect.height);
        },
        resize: (opts) => {
          calls.resize.push(opts);
          return makeOut(opts.width, opts.height);
        },
        toJPEG: (q) => Buffer.from(`fake-jpeg-${srcW}x${srcH}-q${q}`),
      };
    },
  };
}

async function main() {
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "test/.cache");
  fs.mkdirSync(outDir, { recursive: true });
  const bundlePath = path.join(outDir, "cover-compat.cjs");

  await build({
    entryPoints: [path.join(root, "src/main/services/coverCompat.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: bundlePath,
  });

  const {
    computeCenterCrop,
    normalizeCoverForUpload,
    COVER_TARGET_WIDTH,
    COVER_TARGET_HEIGHT,
  } = require(bundlePath);

  assert.strictEqual(COVER_TARGET_WIDTH, 1080);
  assert.strictEqual(COVER_TARGET_HEIGHT, 1440);

  // ---- computeCenterCrop：居中裁切数学 ----
  // 横图 2000×1000：裁两侧留全高，crop 宽 = 1000*3/4 = 750，x 居中 625
  assert.deepStrictEqual(computeCenterCrop(2000, 1000), {
    x: 625,
    y: 0,
    width: 750,
    height: 1000,
  });
  // 竖长图 800×1600：裁上下留全宽，crop 高 = 800*4/3 ≈ 1067，y 居中
  assert.deepStrictEqual(computeCenterCrop(800, 1600), {
    x: 0,
    y: Math.round((1600 - Math.round(800 * 4 / 3)) / 2),
    width: 800,
    height: Math.round(800 * 4 / 3),
  });
  // 已是 3:4（含 1080×1440 本身）：无需裁切
  assert.strictEqual(computeCenterCrop(540, 720), null);
  assert.strictEqual(computeCenterCrop(1080, 1440), null);
  // 异常尺寸
  assert.strictEqual(computeCenterCrop(0, 100), null);
  assert.strictEqual(computeCenterCrop(100, 0), null);
  assert.strictEqual(computeCenterCrop(NaN, 100), null);
  console.log("computeCenterCrop passed");

  // ---- normalizeCoverForUpload ----
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-cover-test-"));
  const created = [];
  try {
    // 1) 横图 jpg：居中裁切 → 缩放 1080×1440 → 写出 tmp jpg
    const landscape = path.join(workDir, "landscape.jpg");
    fs.writeFileSync(landscape, makeFileBuf(JPEG_MAGIC));
    const fake1 = makeFakeNativeImage(2000, 1000);
    const out1 = await normalizeCoverForUpload(landscape, {
      nativeImage: fake1,
    });
    assert.notStrictEqual(out1, landscape, "横图应产出归一后的新路径");
    assert.ok(fs.existsSync(out1), "归一产物应已写盘");
    assert.strictEqual(path.extname(out1), ".jpg", "产物应为 jpg");
    assert.strictEqual(out1.startsWith(os.tmpdir()), true, "产物应落在 tmpdir");
    assert.deepStrictEqual(fake1.calls.crop, [
      { x: 625, y: 0, width: 750, height: 1000 },
    ]);
    assert.deepStrictEqual(fake1.calls.resize, [
      { width: 1080, height: 1440, quality: "best" },
    ]);
    assert.strictEqual(
      fs.readFileSync(out1).toString(),
      "fake-jpeg-1080x1440-q92"
    );
    created.push(out1);
    console.log("landscape normalize passed");

    // 2) 竖长图 png：裁上下 → 缩放
    const tall = path.join(workDir, "tall.png");
    fs.writeFileSync(tall, makeFileBuf(PNG_MAGIC));
    const fake2 = makeFakeNativeImage(800, 1600);
    const out2 = await normalizeCoverForUpload(tall, { nativeImage: fake2 });
    assert.notStrictEqual(out2, tall);
    assert.strictEqual(fake2.calls.crop.length, 1);
    assert.strictEqual(fake2.calls.crop[0].width, 800);
    assert.strictEqual(fake2.calls.resize[0].width, 1080);
    assert.strictEqual(fake2.calls.resize[0].height, 1440);
    created.push(out2);
    console.log("tall normalize passed");

    // 3) 已是 1080×1440 jpg：免重编码透传
    const exact = path.join(workDir, "exact.jpg");
    fs.writeFileSync(exact, makeFileBuf(JPEG_MAGIC));
    const fake3 = makeFakeNativeImage(1080, 1440);
    const out3 = await normalizeCoverForUpload(exact, { nativeImage: fake3 });
    assert.strictEqual(out3, exact, "已是 3:4 目标尺寸的 jpg 应透传");
    assert.strictEqual(fake3.calls.crop.length, 0);
    assert.strictEqual(fake3.calls.resize.length, 0);
    console.log("exact-size jpg passthrough passed");

    // 4) 已是 1080×1440 png：透传（三平台均收 png，不白耗一次重编码）
    const exactPng = path.join(workDir, "exact.png");
    fs.writeFileSync(exactPng, makeFileBuf(PNG_MAGIC));
    const fake4 = makeFakeNativeImage(1080, 1440);
    const out4 = await normalizeCoverForUpload(exactPng, {
      nativeImage: fake4,
    });
    assert.strictEqual(out4, exactPng);
    console.log("exact-size png passthrough passed");

    // 5) nativeImage 解不了的格式（webp/gif 模拟：魔数不匹配）→ 回退原图
    const weird = path.join(workDir, "cover.webp");
    fs.writeFileSync(weird, Buffer.from("RIFF0000WEBPVP8 fake"));
    const fake5 = makeFakeNativeImage(800, 600);
    const out5 = await normalizeCoverForUpload(weird, { nativeImage: fake5 });
    assert.strictEqual(out5, weird, "解不了的格式应回退原图");
    console.log("undecodable fallback passed");

    // 6) 解码失败（isEmpty）→ 回退原图不抛错
    const broken = path.join(workDir, "broken.jpg");
    fs.writeFileSync(broken, makeFileBuf(JPEG_MAGIC));
    const fake6 = makeFakeNativeImage(800, 600, { decodable: false });
    const out6 = await normalizeCoverForUpload(broken, { nativeImage: fake6 });
    assert.strictEqual(out6, broken, "解码失败应回退原图");
    console.log("decode-failure fallback passed");

    // 7) 无 nativeImage（纯 node 环境）→ 回退原图不抛错
    const plain = path.join(workDir, "plain.jpg");
    fs.writeFileSync(plain, makeFileBuf(JPEG_MAGIC));
    const out7 = await normalizeCoverForUpload(plain);
    assert.strictEqual(out7, plain, "无 nativeImage 应回退原图");
    console.log("no-nativeImage fallback passed");

    // 8) 文件不存在 → 回退原路径不抛错
    const missing = path.join(workDir, "not-exist.jpg");
    const out8 = await normalizeCoverForUpload(missing, {
      nativeImage: makeFakeNativeImage(100, 100),
    });
    assert.strictEqual(out8, missing);
    console.log("missing-file fallback passed");

    // 9) 同一源图重复归一：产物路径稳定（重试复用，tmpdir 不膨胀）
    const out9 = await normalizeCoverForUpload(landscape, {
      nativeImage: makeFakeNativeImage(2000, 1000),
    });
    assert.strictEqual(out9, out1, "同源图归一产物路径应稳定");
    console.log("stable temp path passed");
  } finally {
    for (const f of created) {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  console.log("test-cover-compat passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
