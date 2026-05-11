/*
 * 由 lib/icons/icon.png（或现有 icon.ico）生成多尺寸 Windows ICO。
 * 仅在源 PNG 比当前 ICO 新、或 ICO 不存在 / 只有单一尺寸时重建。
 *
 * Windows shell 需要 16/24/32/48/64/128/256 多尺寸，否则桌面/开始菜单
 * 快捷方式会回退到 Electron 默认图标。
 *
 * 依赖：Python3 + Pillow（已存在则直接用）。CI 环境如无 Pillow，
 * 也可改成调用 sharp / png-to-ico。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PNG = path.join(ROOT, 'lib/icons/icon.png')
const ICO = path.join(ROOT, 'lib/icons/icon.ico')

function readIcoCount(file) {
  if (!fs.existsSync(file)) return 0
  const buf = fs.readFileSync(file)
  if (buf.length < 6) return 0
  return buf.readUInt16LE(4)
}

function needRebuild() {
  const count = readIcoCount(ICO)
  if (count < 2) return true
  if (!fs.existsSync(PNG)) return false
  return fs.statSync(PNG).mtimeMs > fs.statSync(ICO).mtimeMs
}

if (!needRebuild()) {
  console.log(`[build-ico] icon.ico OK (${readIcoCount(ICO)} sizes), skip`)
  process.exit(0)
}

const script = `
from PIL import Image
src = '${PNG.replace(/\\/g, '/')}'
ico = '${ICO.replace(/\\/g, '/')}'
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
`
execFileSync('python3', ['-c', script], { stdio: 'inherit' })
console.log(`[build-ico] regenerated (${readIcoCount(ICO)} sizes)`)
