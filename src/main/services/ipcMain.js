import { ipcMain, dialog, BrowserWindow, app as electronApp, shell } from 'electron'
import { spawn } from 'child_process'
import Server from '../server/index'

import { winURL } from '../config/StaticPath'
import downloadFile from './downloadFile'
import { registerPuppeteerIpc } from './puppeteerFile'

const https = require('https')
const version = require('../../../package.json').version
console.log(version, '-------')
import fs from 'fs'
// 获取托管在 Gitee 的 pubtw 仓库 Release 信息。
// 公开仓库可匿名调用 API，无需 access_token，避免把可写 token 打进开源客户端。
function requestGiteeJson(path, fallback) {
  return new Promise(resolve => {
    const options = {
      hostname: 'gitee.com',
      path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'matrix-video'
      }
    }

    const req = https.request(options, res => {
      let data = ''

      res.on('data', chunk => {
        data += chunk
      })

      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (error) {
          console.error('Error parsing Gitee release:', error)
          resolve(fallback)
        }
      })
    })

    req.on('error', error => {
      console.error('Error fetching releases:', error)
      resolve(fallback)
    })

    req.end()
  })
}

async function getLatestRelease() {
  const latest = await requestGiteeJson(
    '/api/v5/repos/gzlingyi_0/pubtw/releases/latest',
    null
  )
  if (latest && latest.id) {
    return latest
  }

  const list = await requestGiteeJson(
    '/api/v5/repos/gzlingyi_0/pubtw/releases?page=1&per_page=20&direction=desc',
    []
  )
  return Array.isArray(list) && list.length > 0 ? list[0] : null
}

/** 解析 v0.9.7 / 0.9.7 为可比较的数字（按段比较，避免 0.9.10 与 parseInt 拼接错误） */
function compareSemver(remoteRaw, localRaw) {
  const norm = s =>
    String(s || '')
      .replace(/^v/i, '')
      .trim()
      .split('.')
      .map(x => parseInt(x, 10) || 0)
  const a = norm(remoteRaw)
  const b = norm(localRaw)
  const len = Math.max(a.length, b.length, 3)
  for (let i = 0; i < len; i++) {
    const da = a[i] || 0
    const db = b[i] || 0
    if (da !== db) {
      return da > db ? 1 : -1
    }
  }
  return 0
}

/**
 * 与 CI 产物一致：
 * Win: Setup-0.9.7-win-x64.exe
 * Mac ARM: 矩媒-0.9.7-arm64.dmg（Apple Silicon 时 process.arch === "arm64"）
 * Intel Mac: 矩媒-0.9.7.dmg（文件名不含 -arm64 的普通 dmg）
 */
function pickReleaseInstaller(assets) {
  const list = assets || []
  const platform = process.platform
  if (platform === 'win32') {
    return (
      list.find(a => /Setup-[\d.]+-win-x64\.exe$/i.test(a.name)) ||
      list.find(a => /-win-x64\.exe$/i.test(a.name)) ||
      list.find(a => /\.exe$/i.test(a.name))
    )
  }
  if (platform === "darwin") {
    const dmgs = list.filter(a => /\.dmg$/i.test(a.name));
    const isAppleSilicon = process.arch === "arm64";
    const armDmg = dmgs.find(a => /-arm64\.dmg$/i.test(a.name));
    const x64Dmg = dmgs.find(a => /-x64\.dmg$/i.test(a.name));
    const universalDmg = dmgs.find(a => /-universal\.dmg$/i.test(a.name));
    const plainDmg = dmgs.find(a => !/-arm64\.dmg$/i.test(a.name) && !/-x64\.dmg$/i.test(a.name) && !/-universal\.dmg$/i.test(a.name));

    if (isAppleSilicon) {
      return armDmg || universalDmg || plainDmg || null;
    } else {
      return x64Dmg || universalDmg || plainDmg || null;
    }
  }
  return null
}

export default {
  async Mainfunc(IsUseSysTitle) {
    // Always register the check-for-updates handler first
    ipcMain.handle('check-for-updates', async event => {
      const lastData = await getLatestRelease()
      if (!lastData) {
        return { hasUpdate: false }
      }
      const remoteVer =
        (lastData.tag_name && String(lastData.tag_name).replace(/^v/i, '')) ||
        (lastData.name && String(lastData.name).replace(/^v/i, ''))
      console.log(lastData, remoteVer, 'remoteVer', version)
      const cmp = compareSemver(remoteVer, version)
      const assets = lastData.assets || []

      const installer = pickReleaseInstaller(assets)
      const downloadURL = installer && installer.browser_download_url
      console.log(downloadURL, 'downloadURL', assets)
      console.log(cmp, 'cmp')
      if (downloadURL && cmp > 0) {
        downloadFile.download(
          BrowserWindow.fromWebContents(event.sender),
          downloadURL
        )
      }
      return {
        hasUpdate: Boolean(downloadURL && cmp > 0)
      }
    })

    // Windows：先启动安装包再退出应用，避免 NSIS 无法结束正在运行的 矩媒.exe
    ipcMain.handle('launch-installer', async (event, installerPath) => {
      if (!installerPath || typeof installerPath !== 'string') {
        return { ok: false }
      }
      if (process.platform === 'win32') {
        spawn(installerPath, [], { detached: true, stdio: 'ignore' }).unref()
        electronApp.quit()
      } else {
        await shell.openPath(installerPath)
      }
      return { ok: true }
    })

    // puppeteerFile 上传文件发布，获取登录状态
    registerPuppeteerIpc()

    // 获取文件下面的文件
    ipcMain.handle('getFiles', (event, args) => {
      if (!fs.existsSync(args)) {
        return []
      }
      console.log(args, 'getFiles')
      return fs.readdirSync(args)
    })
    ipcMain.handle('IsUseSysTitle', async () => {
      return IsUseSysTitle
    })
    ipcMain.handle('windows-mini', (event, args) => {
      BrowserWindow.fromWebContents(event.sender)?.minimize()
    })
    ipcMain.handle('window-max', async (event, args) => {
      if (BrowserWindow.fromWebContents(event.sender)?.isMaximized()) {
        BrowserWindow.fromWebContents(event.sender)?.unmaximize()
        return { status: false }
      } else {
        BrowserWindow.fromWebContents(event.sender)?.maximize()
        return { status: true }
      }
    })

    ipcMain.handle('window-close', (event, args) => {
      BrowserWindow.fromWebContents(event.sender)?.close()
    })
    ipcMain.handle('start-download', (event, msg) => {
      downloadFile.download(
        BrowserWindow.fromWebContents(event.sender),
        msg.downloadUrL
      )
    })

    ipcMain.handle('reset-app', () => {
      electronApp.relaunch()
      electronApp.exit()
    })
    ipcMain.handle('open-messagebox', async (event, arg) => {
      const res = await dialog.showMessageBox(
        BrowserWindow.fromWebContents(event.sender),
        {
          type: arg.type || 'info',
          title: arg.title || '',
          buttons: arg.buttons || [],
          message: arg.message || '',
          noLink: arg.noLink || true
        }
      )
      return res
    })
    ipcMain.handle('open-errorbox', (event, arg) => {
      dialog.showErrorBox(arg.title, arg.message)
    })

    // 选择目录的函数
    ipcMain.handle('dialog:openDirectory', async event => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ['openDirectory'] // 选择目录
        }
      )
      return result.filePaths[0] // 返回选中的目录路径
    })

    ipcMain.handle('dialog:openVideoFile', async event => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ['openFile'],
          filters: [
            {
              name: 'Video',
              extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']
            }
          ]
        }
      )
      if (
        result.canceled ||
        !result.filePaths ||
        result.filePaths.length === 0
      ) {
        return undefined
      }
      return result.filePaths[0]
    })

    ipcMain.handle('statr-server', async () => {
      try {
        const serveStatus = await Server.StatrServer()
        return serveStatus
      } catch (error) {
        dialog.showErrorBox('错误', error)
      }
    })
    ipcMain.handle('stop-server', async (event, arg) => {
      try {
        const serveStatus = await Server.StopServer()
        return serveStatus
      } catch (error) {
        // dialog.showErrorBox("错误", error);
      }
    })
    let childWin = null
    let cidArray = []
    ipcMain.handle('open-win', (event, arg) => {
      let cidJson = { id: null, url: '' }
      let data = cidArray.filter(currentValue => {
        if (currentValue.url === arg.url) {
          return currentValue
        }
      })
      if (data.length > 0) {
        //获取当前窗口
        let currentWindow = BrowserWindow.fromId(data[0].id)
        //聚焦窗口
        currentWindow.focus()
      } else {
        //获取主窗口ID
        let parentID = event.sender.id
        //创建窗口
        childWin = new BrowserWindow({
          width: arg?.width || 842,
          height: arg?.height || 595,
          //width 和 height 将设置为 web 页面的尺寸(译注: 不包含边框), 这意味着窗口的实际尺寸将包括窗口边框的大小，稍微会大一点。
          useContentSize: true,
          //自动隐藏菜单栏，除非按了Alt键。
          autoHideMenuBar: true,
          //窗口大小是否可调整
          resizable: arg?.resizable ?? false,
          //窗口的最小高度
          minWidth: arg?.minWidth || 842,
          show: arg?.show ?? false,
          //窗口透明度
          opacity: arg?.opacity || 1.0,
          //当前窗口的父窗口ID
          parent: parentID,
          frame: IsUseSysTitle,
          webPreferences: {
            nodeIntegration: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
            //使用webview标签 必须开启
            webviewTag: arg?.webview ?? false,
            // 如果是开发模式可以使用devTools
            devTools: process.env.NODE_ENV === 'development',
            // 在macos中启用橡皮动画
            scrollBounce: process.platform === 'darwin',
            // 临时修复打开新窗口报错
            contextIsolation: false
          }
        })

        childWin.loadURL(winURL + `#${arg.url}`)
        cidJson.id = childWin?.id
        cidJson.url = arg.url
        cidArray.push(cidJson)
        childWin.webContents.once('dom-ready', () => {
          childWin.show()
          childWin.webContents.send('send-data', arg.sendData)
          if (arg.IsPay) {
            // 检查支付时候自动关闭小窗口
            const testUrl = setInterval(() => {
              const Url = childWin.webContents.getURL()
              if (Url.includes(arg.PayUrl)) {
                childWin.close()
              }
            }, 1200)
            childWin.on('close', () => {
              clearInterval(testUrl)
            })
          }
        })
        childWin.on('closed', () => {
          childWin = null
          let index = cidArray.indexOf(cidJson)
          if (index > -1) {
            cidArray.splice(index, 1)
          }
        })
      }
      childWin.on('maximize', () => {
        if (cidJson.id != null) {
          BrowserWindow.fromId(cidJson.id).webContents.send('w-max', true)
        }
      })
      childWin.on('unmaximize', () => {
        if (cidJson.id != null) {
          BrowserWindow.fromId(cidJson.id).webContents.send('w-max', false)
        }
      })
    })
  }
}
