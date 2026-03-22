/**
 * 发布流水线（本地执行）：
 * 1. 在 main 上升版本号并提交、推送 origin main
 * 2. 同步 main 到 Gitee（git@gitee.com:gzlingyi_0/pubtw.git），失败则强制推送
 * 3. 切到 prod，合并 main，推送 prod（prod 仅承载发布，日常开发在 main）
 * 4. 切回 main
 *
 * 用法: node pushall.js [patch|minor|major]
 * 默认 patch。要求工作区干净（无未提交改动）。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname);
const PKG = path.join(ROOT, 'package.json');

const GITEE_REMOTE = 'gitee';
const GITEE_URL = 'git@gitee.com:gzlingyi_0/pubtw.git';

const BUMP = ['patch', 'minor', 'major'].includes(process.argv[2])
  ? process.argv[2]
  : 'patch';

function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function runSilent(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function assertCleanWorkingTree() {
  const out = runSilent('git status --porcelain');
  if (out) {
    console.error('工作区有未提交改动，请先提交或暂存后再执行 pushall.js');
    process.exit(1);
  }
}

function bumpSemver(current, type) {
  const parts = String(current)
    .split('.')
    .map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`无效的 version 字段: ${current}`);
  }
  let [major, minor, patch] = parts;
  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function writePackageVersion(next) {
  const raw = fs.readFileSync(PKG, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.version = next;
  const text = `${JSON.stringify(pkg, null, 2)}\n`;
  fs.writeFileSync(PKG, text, 'utf8');
}

function checkoutBranch(name) {
  try {
    runSilent(`git rev-parse --verify ${name}`);
    run(`git checkout ${name}`);
  } catch {
    run(`git checkout -b ${name} origin/${name}`);
  }
}

function ensureGiteeRemote() {
  try {
    runSilent(`git remote get-url ${GITEE_REMOTE}`);
    run(`git remote set-url ${GITEE_REMOTE} ${GITEE_URL}`);
  } catch {
    run(`git remote add ${GITEE_REMOTE} ${GITEE_URL}`);
  }
}

function syncGiteeMain() {
  ensureGiteeRemote();
  try {
    run(`git push ${GITEE_REMOTE} main`);
  } catch {
    console.warn('推送到 Gitee 失败，正在强制同步 main...');
    run(`git push -f ${GITEE_REMOTE} main`);
  }
}

function main() {
  assertCleanWorkingTree();

  run('git fetch origin main prod');

  checkoutBranch('main');
  run('git pull --ff-only origin main');

  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const prev = pkg.version;
  const next = bumpSemver(prev, BUMP);
  if (next === prev) {
    console.error('版本号未变化');
    process.exit(1);
  }
  writePackageVersion(next);
  console.log(`版本: ${prev} -> ${next} (${BUMP})`);

  run('git add package.json');
  run(`git commit -m "chore(release): v${next}"`);
  run('git push origin main');

  syncGiteeMain();

  checkoutBranch('prod');
  run('git pull --ff-only origin prod');
  run(`git merge main -m "chore: merge main for release v${next}"`);
  run('git push origin prod');

  run('git checkout main');
  console.log('完成。当前分支: main，已推送 origin main、Gitee main 与 prod。');
}

main();
