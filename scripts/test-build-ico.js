const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PNG = path.join(ROOT, 'lib/icons/icon.png')
const ICO = path.join(ROOT, 'lib/icons/icon.ico')
const BUILD_ICO = path.join(ROOT, 'scripts/build-ico.js')

function writeExecutable(file, content) {
  fs.writeFileSync(file, content)
  fs.chmodSync(file, 0o755)
}

const pngStat = fs.statSync(PNG)
const icoStat = fs.statSync(ICO)
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-ico-test-'))

try {
  writeExecutable(
    path.join(tempDir, process.platform === 'win32' ? 'python3.cmd' : 'python3'),
    process.platform === 'win32'
      ? '@echo off\r\necho fake python should not be called 1>&2\r\nexit /b 99\r\n'
      : '#!/bin/sh\necho "fake python should not be called" >&2\nexit 99\n'
  )

  fs.utimesSync(PNG, pngStat.atime, new Date(icoStat.mtimeMs + 60000))

  const result = spawnSync(process.execPath, [BUILD_ICO], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH || ''}`
    },
    encoding: 'utf8'
  })

  assert.strictEqual(
    result.status,
    0,
    `build-ico should skip valid ico without python\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
  assert.match(result.stdout, /icon\.ico OK/)
} finally {
  fs.utimesSync(PNG, pngStat.atime, pngStat.mtime)
  fs.utimesSync(ICO, icoStat.atime, icoStat.mtime)
  fs.rmSync(tempDir, { recursive: true, force: true })
}
