/*
 * @Description:
 * @Date: 2026-05-16 13:55:31
 * @Author: Do not edit
 * @LastEditors: liuhanliang
 */
const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const { createDevDownloadApp } = require('../.electron-vue/dev-download-server')

function request(server, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const { port } = server.address()
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method
      },
      res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          })
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

function listen(app) {
  return new Promise(resolve => {
    const server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

;(async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'matrixmedia-dev-download-')
  )
  const buildDir = path.join(tempRoot, 'build')
  fs.mkdirSync(path.join(buildDir, 'nested'), { recursive: true })
  fs.writeFileSync(
    path.join(buildDir, 'MatrixMedia-0.6.2-mac-arm64.dmg'),
    'installer'
  )
  fs.writeFileSync(path.join(buildDir, 'notes.txt'), 'notes')
  fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}')

  let shutdownCount = 0
  const app = createDevDownloadApp({
    rootDir: tempRoot,
    onShutdown: () => {
      shutdownCount += 1
    }
  })
  const server = await listen(app)

  try {
    const index = await request(server, '/')
    assert.strictEqual(index.statusCode, 200)
    assert.match(index.headers['content-type'], /text\/html/)
    assert.match(
      index.body.toString('utf8'),
      /MatrixMedia-0\.6\.2-mac-arm64\.dmg/
    )
    assert.match(index.body.toString('utf8'), /notes\.txt/)
    assert.match(index.body.toString('utf8'), /关闭下载服务/)

    const file = await request(server, '/MatrixMedia-0.6.2-mac-arm64.dmg')
    assert.strictEqual(file.statusCode, 200)
    assert.strictEqual(file.body.toString('utf8'), 'installer')
    assert.match(file.headers['content-disposition'], /attachment/)

    const blocked = await request(server, '/%2e%2e/package.json')
    assert.strictEqual(blocked.statusCode, 403)

    const shutdown = await request(server, '/__shutdown', 'POST')
    assert.strictEqual(shutdown.statusCode, 200)
    assert.match(shutdown.body.toString('utf8'), /下载服务已关闭/)
    assert.strictEqual(shutdownCount, 1)
  } finally {
    server.close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('dev download server tests passed')
})().catch(error => {
  console.error(error)
  process.exit(1)
})
