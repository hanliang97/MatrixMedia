'use strict'

const express = require('express')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const Portfinder = require('portfinder')

const DEFAULT_PORT = 30999

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function encodePathname(value) {
  return value
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/')
}

function isInsideBuild(buildDir, targetPath) {
  const relative = path.relative(buildDir, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveBuildPath(buildDir, requestPath) {
  const rawPath = decodeURIComponent(requestPath || '/')
  const relativePath = path.normalize(rawPath.replace(/^[/\\]+/, ''))
  return path.resolve(buildDir, relativePath)
}

function getOriginalPath(req) {
  return (req.originalUrl || req.url || '/').split('?')[0]
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function renderDirectoryPage(buildDir, currentPath, entries) {
  const normalizedPath = currentPath === '/' ? '' : currentPath.replace(/^\/+/, '').replace(/\/+$/, '')
  const parentPath = normalizedPath.split('/').slice(0, -1).join('/')
  const rows = []

  if (normalizedPath) {
    rows.push(`<li><a href="/${encodePathname(parentPath)}">../</a></li>`)
  }

  entries.forEach(entry => {
    const childPath = [normalizedPath, entry.name].filter(Boolean).join('/')
    const href = `/${encodePathname(childPath)}${entry.isDirectory ? '/' : ''}`
    const suffix = entry.isDirectory ? '/' : ''
    const meta = entry.isDirectory ? '目录' : formatFileSize(entry.size)
    rows.push(
      `<li><a href="${href}">${escapeHtml(entry.name)}${suffix}</a><span>${escapeHtml(meta)}</span></li>`
    )
  })

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MatrixMedia Dev Build</title>
  <style>
    body { margin: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2937; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 24px; color: #6b7280; }
    ul { max-width: 760px; padding: 0; margin: 0; list-style: none; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 16px; border-top: 1px solid #e5e7eb; }
    li:first-child { border-top: 0; }
    a { color: #2563eb; text-decoration: none; word-break: break-all; }
    a:hover { text-decoration: underline; }
    span { flex: 0 0 auto; color: #6b7280; }
    form { margin: 24px 0 0; }
    button { padding: 8px 14px; border: 1px solid #dc2626; border-radius: 6px; background: #fff; color: #dc2626; cursor: pointer; }
    button:hover { background: #fef2f2; }
  </style>
</head>
<body>
  <h1>MatrixMedia Dev Build</h1>
  <p>${escapeHtml(buildDir)}</p>
  <ul>${rows.join('') || '<li>build 目录暂无文件</li>'}</ul>
  <form method="post" action="/__shutdown">
    <button type="submit">关闭下载服务</button>
  </form>
</body>
</html>`
}

function listDirectory(buildDir, targetPath, requestPath, res) {
  const entries = fs.readdirSync(targetPath, { withFileTypes: true })
    .map(dirent => {
      const entryPath = path.join(targetPath, dirent.name)
      const stat = fs.statSync(entryPath)
      return {
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        size: stat.size
      }
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  res.type('html').send(renderDirectoryPage(buildDir, requestPath, entries))
}

function createDevDownloadApp(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..')
  const buildDir = options.buildDir || path.join(rootDir, 'build')
  const app = express()
  const onShutdown = typeof options.onShutdown === 'function' ? options.onShutdown : null

  app.post('/__shutdown', (req, res) => {
    if (onShutdown) {
      res.on('finish', onShutdown)
    }
    res.type('html').send('<h1>下载服务已关闭</h1>')
  })

  app.get('*', (req, res) => {
    const requestPath = getOriginalPath(req)
    let targetPath
    try {
      targetPath = resolveBuildPath(buildDir, requestPath)
    } catch (error) {
      res.status(400).send('Bad request')
      return
    }

    if (!isInsideBuild(buildDir, targetPath)) {
      res.status(403).send('Forbidden')
      return
    }

    if (!fs.existsSync(targetPath)) {
      res.status(404).send('Not found')
      return
    }

    const stat = fs.statSync(targetPath)
    if (stat.isDirectory()) {
      listDirectory(buildDir, targetPath, requestPath, res)
      return
    }

    res.download(targetPath)
  })

  return app
}

function isIpv4(item) {
  return item.family === 'IPv4' || item.family === 4
}

function getLanUrls(port) {
  const urls = [`http://127.0.0.1:${port}/`]
  const interfaces = os.networkInterfaces()

  Object.keys(interfaces).forEach(name => {
    interfaces[name].forEach(item => {
      if (isIpv4(item) && !item.internal) {
        urls.push(`http://${item.address}:${port}/`)
      }
    })
  })

  return urls
}

function ensureBuildDir(buildDir) {
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true })
  }
}

function startDevDownloadServer(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..')
  const buildDir = options.buildDir || path.join(rootDir, 'build')
  const port = options.port || Number(process.env.DEV_DOWNLOAD_PORT) || DEFAULT_PORT
  const host = options.host || '0.0.0.0'

  ensureBuildDir(buildDir)
  Portfinder.basePort = port

  return new Promise((resolve, reject) => {
    Portfinder.getPort((error, availablePort) => {
      if (error) {
        reject(error)
        return
      }

      let server
      const app = createDevDownloadApp({
        ...options,
        rootDir,
        buildDir,
        onShutdown: () => {
          server.close(() => {
            console.log('\n下载服务已关闭。如需再次分享，请重新执行 pnpm xz 或 yarn dev:download\n')
            process.exit(0)
          })
        }
      })
      server = http.createServer(app)

      server.on('error', reject)
      server.listen(availablePort, host, () => {
        const urls = getLanUrls(availablePort)
        const requestedPort = port
        console.log('\nDev build 下载服务已启动（终端需保持运行）:')
        if (availablePort !== requestedPort) {
          console.log(`  注意: ${requestedPort} 已被占用，实际端口为 ${availablePort}`)
        }
        urls.forEach(url => console.log(`  ${url}`))
        console.log('  同网段设备请用上面的局域网地址访问')
        console.log('  按 Ctrl+C 停止；页面上的「关闭下载服务」也会停止本服务\n')
        resolve({ server, port: availablePort, urls, buildDir })
      })
    })
  })
}

if (require.main === module) {
  startDevDownloadServer().catch(error => {
    console.error(error)
    process.exit(1)
  })

  process.on('SIGINT', () => {
    console.log('\n下载服务已停止')
    process.exit(0)
  })
}

module.exports = {
  createDevDownloadApp,
  startDevDownloadServer
}
