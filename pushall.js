/**
 * 发布流水线（本地执行）：
 * 1. 在 main 上升版本号并提交、push origin main，同时打 v{version} 本地 tag 并推送
 * 2. 切到 prod 合并 main 后 push origin prod（触发 GitHub Actions 打 GitHub Release）
 * 3. 回到 main，本地生成 release-notes.md（使用 prev tag..HEAD 区间，修复 Gitee 日志为空）
 * 4. 本地执行 electron-builder 打包（默认全平台，可用 --platforms 限制）
 * 5. 直接调用 upload-gitee.js 把 .exe/.dmg 上传到 Gitee Release（token 从 .token 读取）
 *
 * 用法:
 *   node pushall.js [patch|minor|major] [--platforms=all|mac|win|linux|mac,win,...]
 *                   [--skip-bump] [--skip-git] [--skip-build] [--skip-upload]
 *
 *   默认 patch + --platforms=all。要求工作区干净。
 *
 * .token 文件示例（仓库根目录、已在 .gitignore）：
 *   gitee_key=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 */

const fs = require('fs')
const path = require('path')
const { execSync, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname)
const PKG = path.join(ROOT, 'package.json')
const TOKEN_FILE = path.join(ROOT, '.token')
const RELEASE_NOTES_PATH = path.join(ROOT, 'release-notes.md')
const UPLOAD_SCRIPT = path.join(ROOT, 'upload-gitee.js')
const BUILD_DIR = path.join(ROOT, 'build')

// -------- CLI 解析 --------
const argv = process.argv.slice(2)
const BUMP = ['patch', 'minor', 'major'].includes(argv[0]) ? argv[0] : 'patch'

function hasFlag(name) {
  return argv.includes('--' + name)
}
function getOpt(name, def) {
  const prefix = '--' + name + '='
  const found = argv.find((a) => a.startsWith(prefix))
  return found ? found.slice(prefix.length) : def
}

const SKIP_BUMP = hasFlag('skip-bump')
const SKIP_GIT = hasFlag('skip-git')
const SKIP_BUILD = hasFlag('skip-build')
const SKIP_UPLOAD = hasFlag('skip-upload')
const PLATFORMS = parsePlatforms(getOpt('platforms', 'all'))

function parsePlatforms(spec) {
  const set = new Set()
  for (const raw of String(spec).split(',')) {
    const p = raw.trim().toLowerCase()
    if (!p) continue
    if (p === 'all') {
      ;['win', 'mac', 'linux'].forEach((x) => set.add(x))
    } else if (['win', 'mac', 'linux'].includes(p)) {
      set.add(p)
    } else {
      throw new Error(`未知平台: ${p}（支持: all/win/mac/linux）`)
    }
  }
  if (set.size === 0) throw new Error('platforms 为空')
  return [...set]
}

// -------- 基础工具 --------
function run(cmd, opts = {}) {
  console.log('$', cmd)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
}
function runSilent(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()
}
function runOk(cmd) {
  try {
    runSilent(cmd)
    return true
  } catch {
    return false
  }
}

function assertCleanWorkingTree() {
  const out = runSilent('git status --porcelain')
  if (out) {
    console.error('工作区有未提交改动：')
    console.error(out)
    console.error('请先提交/暂存后再执行 pushall.js')
    process.exit(1)
  }
}

function bumpSemver(current, type) {
  const parts = String(current)
    .split('.')
    .map((s) => parseInt(s, 10))
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`无效的 version 字段: ${current}`)
  }
  let [major, minor, patch] = parts
  if (type === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (type === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
    if (patch >= 10) {
      minor += 1
      patch = 0
    }
  }
  return `${major}.${minor}.${patch}`
}

function writePackageVersion(next) {
  const raw = fs.readFileSync(PKG, 'utf8')
  const pkg = JSON.parse(raw)
  pkg.version = next
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

function readGiteeToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`未找到 ${TOKEN_FILE}（请在仓库根目录创建 .token，内容: gitee_key=xxxxx）`)
  }
  const map = {}
  for (const line of fs.readFileSync(TOKEN_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const k = trimmed.slice(0, idx).trim()
    const v = trimmed.slice(idx + 1).trim()
    if (k) map[k] = v
  }
  const token =
    map.gitee_key ||
    map.gitee_token ||
    map.GITEE_ACCESS_TOKEN ||
    map.GITEE_KEY
  if (!token) {
    throw new Error('.token 中缺少 gitee_key=...（也可写 gitee_token / GITEE_ACCESS_TOKEN）')
  }
  return token
}

function localTagExists(tag) {
  return runOk(`git rev-parse --verify -q refs/tags/${tag}`)
}

// -------- 主步骤 --------
function generateReleaseNotes(version) {
  console.log('生成 release notes...')
  const res = spawnSync('node', ['scripts/gen-release-notes.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      VERSION: version,
      RELEASE_NOTES_PATH: 'release-notes.md'
    }
  })
  if (res.status !== 0) throw new Error('gen-release-notes.js 失败')
  return fs.readFileSync(RELEASE_NOTES_PATH, 'utf8')
}

function buildLocal() {
  console.log('开始本地打包，目标平台:', PLATFORMS.join(','))

  // 清理 + 渲染进程构建（始终）
  run('yarn rm:build')
  if (PLATFORMS.includes('win')) run('yarn build:ico')
  run('yarn build:dir')

  // 单次 electron-builder 调用，覆盖所有平台
  const flags = []
  if (PLATFORMS.includes('win')) flags.push('--win', '--x64')
  if (PLATFORMS.includes('mac')) flags.push('--mac', '--x64')
  if (PLATFORMS.includes('linux')) flags.push('--linux', '--x64')

  const env = {
    ...process.env,
    // mac 跳过自动签名（与 CI 一致）
    CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  }
  const res = spawnSync('npx', ['--no-install', 'electron-builder', ...flags], {
    cwd: ROOT,
    stdio: 'inherit',
    env
  })
  if (res.status !== 0) throw new Error('electron-builder 打包失败')
}

function collectArtifacts() {
  if (!fs.existsSync(BUILD_DIR)) return []
  // Gitee 单文件 100MB 上限，AppImage 通常较大，沿用 CI 策略仅上传 .exe / .dmg
  return fs
    .readdirSync(BUILD_DIR)
    .filter((f) => /\.(exe|dmg)$/i.test(f))
    .map((f) => path.join(BUILD_DIR, f))
}

function uploadToGitee(token, version, files, releaseBody) {
  if (files.length === 0) {
    throw new Error('build/ 下未找到可上传的 .exe / .dmg 产物')
  }
  console.log('上传到 Gitee：')
  files.forEach((f) => console.log('  -', f))

  const res = spawnSync('node', [UPLOAD_SCRIPT, token, version, ...files], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, RELEASE_BODY: releaseBody }
  })
  if (res.status !== 0) throw new Error('upload-gitee.js 上传失败')
}

function main() {
  assertCleanWorkingTree()

  // 提前校验 token，避免打包完才发现没 token
  const giteeToken = readGiteeToken()

  // 拉取远端（含 tags），保证 gen-release-notes 能找到上一个 v* tag
  if (!SKIP_GIT) {
    run('git fetch origin main prod')
    run('git fetch --tags --prune --force origin')
  }

  let nextVersion
  if (SKIP_BUMP) {
    nextVersion = JSON.parse(fs.readFileSync(PKG, 'utf8')).version
    console.log('跳过版本升级，使用当前版本:', nextVersion)
  } else {
    run('git checkout main')
    if (!SKIP_GIT) run('git pull --ff-only origin main')

    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'))
    const prev = pkg.version
    nextVersion = bumpSemver(prev, BUMP)
    if (nextVersion === prev) {
      console.error('版本号未变化')
      process.exit(1)
    }
    writePackageVersion(nextVersion)
    console.log(`版本: ${prev} -> ${nextVersion} (${BUMP})`)

    run('git add package.json')
    run(`git commit -m "chore(release): v${nextVersion}"`)

    // 本地打 tag —— 关键：保证后续 gen-release-notes 能从 v{prev}..HEAD 算 changelog
    const tagName = `v${nextVersion}`
    if (localTagExists(tagName)) {
      console.warn(`本地已存在 tag ${tagName}，跳过创建`)
    } else {
      run(`git tag -a ${tagName} -m "${tagName}"`)
    }

    if (!SKIP_GIT) {
      run('git push origin main')
      run(`git push origin ${tagName}`)

      // 合并 main 到 prod，触发 GitHub Actions 走 GitHub Release（保留原行为）
      run('git checkout prod')
      run('git pull --ff-only origin prod')
      run(`git merge main -m "chore: merge main for release v${nextVersion}"`)
      run('git push origin prod')
      run('git checkout main')
    }
  }

  // 生成 release notes（此时 v{prev} 已 fetch，v{next} 已本地打 tag）
  const releaseBody = generateReleaseNotes(nextVersion)

  // 本地打包
  if (!SKIP_BUILD) {
    buildLocal()
  } else {
    console.log('跳过本地打包')
  }

  // 上传 Gitee
  if (!SKIP_UPLOAD) {
    const files = collectArtifacts()
    uploadToGitee(giteeToken, nextVersion, files, releaseBody)
  } else {
    console.log('跳过 Gitee 上传')
  }

  console.log(`\n✅ 完成。当前分支: main，版本: v${nextVersion}`)
}

try {
  main()
} catch (e) {
  console.error('❌ 发布失败:', e.message || e)
  process.exit(1)
}
