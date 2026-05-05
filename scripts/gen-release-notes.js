/**
 * CI：根据上一 semver 标签生成 release-notes.md（与 GitHub / Gitee 共用）。
 * 环境变量：VERSION（必填）、RELEASE_NOTES_PATH（可选，默认 release-notes.md）
 */
const { execFileSync } = require('child_process')
const fs = require('fs')

const version = process.env.VERSION
const outPath = process.env.RELEASE_NOTES_PATH || 'release-notes.md'

function parseSemver(s) {
  return String(s || '')
    .replace(/^v/i, '')
    .trim()
    .split('.')
    .map(x => parseInt(x, 10) || 0)
}

function cmpSemver(a, b) {
  const aa = parseSemver(a)
  const bb = parseSemver(b)
  const len = Math.max(aa.length, bb.length, 3)
  for (let i = 0; i < len; i++) {
    const da = aa[i] || 0
    const db = bb[i] || 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}

function getTags() {
  try {
    const out = execFileSync(
      'git',
      ['tag', '-l', 'v*', '--sort=-version:refname'],
      { encoding: 'utf8' }
    )
    return out.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 在按版本降序排列的 v* 标签中，找「严格小于当前 package 版本」的最新标签。
 * 这样会跳过：同名当前版本、以及比当前版本更新的标签（避免错误区间）。
 */
function findPrevTag(tags, currentVer) {
  for (const tag of tags) {
    const tagVer = tag.replace(/^v/i, '')
    if (cmpSemver(tagVer, currentVer) < 0) return tag
  }
  return ''
}

function gitLog(args) {
  const base = [
    'log',
    ...args,
    '--pretty=format:- %s (%h)',
    '--grep=^chore(release): v',
    '--invert-grep'
  ]
  try {
    return execFileSync('git', base, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function main() {
  if (!version) {
    console.error('缺少环境变量 VERSION')
    process.exit(1)
  }

  const tags = getTags()
  const prevTag = findPrevTag(tags, version)

  let rangeLabel
  let commits

  if (prevTag) {
    rangeLabel = `${prevTag}..HEAD`
    commits = gitLog([`${prevTag}..HEAD`])
  } else {
    rangeLabel =
      '无更早 v* 标签，以下为最近提交（最多 40 条，已排除 chore(release)）'
    commits = gitLog(['-40'])
  }

  if (!commits) {
    commits = '- 无更新记录'
  }

  const body = `## 更新记录

对比范围: ${rangeLabel}

${commits}
`

  fs.writeFileSync(outPath, body, 'utf8')
  console.log(
    'gen-release-notes:',
    outPath,
    'prevTag=',
    prevTag || '(none)',
    'tags=',
    tags.length
  )
}

main()
