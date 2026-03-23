/* eslint-disable no-case-declarations */
import { app, dialog } from 'electron'
import path from 'path'

function safeSend(mainWindow, channel, ...args) {
  try {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(channel, ...args)
    }
  } catch (_) {
    // 窗口已关闭或正在退出时忽略
  }
}

export default {
  download(mainWindow, downloadUrL) {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      !mainWindow.webContents ||
      mainWindow.webContents.isDestroyed()
    ) {
      return
    }
    mainWindow.webContents.downloadURL(downloadUrL)
    mainWindow.webContents.session.once('will-download', (event, item) => {
      const filePath = path.join(app.getPath('downloads'), item.getFilename())
      item.setSavePath(filePath)
      item.on('updated', (event, state) => {
        switch (state) {
          case 'progressing': {
            const total = item.getTotalBytes()
            const pct =
              total > 0
                ? ((item.getReceivedBytes() / total) * 100).toFixed(0)
                : '0'
            safeSend(mainWindow, 'download-progress', pct)
            break
          }
          case 'interrupted':
            safeSend(mainWindow, 'download-paused', true)
            break
          default:
            break
        }
      })
      item.once('done', (event, state) => {
        switch (state) {
          case 'completed':
            safeSend(mainWindow, 'download-done', { filePath })
            break
          case 'interrupted':
            safeSend(mainWindow, 'download-error', true)
            dialog.showErrorBox(
              '下载出错',
              '由于网络或其他未知原因导致下载出错.'
            )
            break
          default:
            break
        }
      })
    })
  }
}
