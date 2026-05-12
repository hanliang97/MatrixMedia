/*
 * 由 lib/icons/icon.png（或现有 icon.ico）生成多尺寸 Windows ICO。
 * 默认只校验已提交的 ICO 是否包含完整尺寸；需要重新生成时传 --force。
 *
 * Windows shell 需要 16/24/32/48/64/128/256 多尺寸，否则桌面/开始菜单
 * 快捷方式会回退到 Electron 默认图标。
 *
 * 重新生成依赖：Python3 + Pillow。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PNG = path.join(ROOT, "lib/icons/icon.png");
const ICO = path.join(ROOT, "lib/icons/icon.ico");
const REQUIRED_SIZES = [16, 24, 32, 40, 48, 64, 96, 128, 256];

function readIcoSizes(file) {
  if (!fs.existsSync(file)) return [];
  const buf = fs.readFileSync(file);
  if (buf.length < 6) return [];
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return [];

  const count = buf.readUInt16LE(4);
  if (buf.length < 6 + count * 16) return [];

  const sizes = [];
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    const width = buf[offset] || 256;
    const height = buf[offset + 1] || 256;
    if (width === height) sizes.push(width);
  }
  return sizes;
}

function hasRequiredIcoSizes(file) {
  const sizes = new Set(readIcoSizes(file));
  return REQUIRED_SIZES.every((size) => sizes.has(size));
}

function needRebuild() {
  if (process.argv.includes("--force")) return true;
  return !hasRequiredIcoSizes(ICO);
}

if (!needRebuild()) {
  console.log(
    `[build-ico] icon.ico OK (${readIcoSizes(ICO).length} sizes), skip`
  );
  process.exit(0);
}

const script = `
from PIL import Image
src = '${PNG.replace(/\\/g, "/")}'
ico = '${ICO.replace(/\\/g, "/")}'
import os
if not os.path.exists(src):
    # 回退：用现有 ico 最大帧
    src = ico
im = Image.open(src)
im.load()
if im.mode != 'RGBA':
    im = im.convert('RGBA')
sizes = [(16,16),(24,24),(32,32),(40,40),(48,48),(64,64),(96,96),(128,128),(256,256)]
im.save(ico, format='ICO', sizes=sizes, bitmap_format='bmp')
print('wrote', ico)
`;
execFileSync("python3", ["-c", script], { stdio: "inherit" });
console.log(`[build-ico] regenerated (${readIcoSizes(ICO).length} sizes)`);
