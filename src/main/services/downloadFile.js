/* eslint-disable no-case-declarations */
import { app, dialog } from 'electron'
import path from 'path'
export default {
  download(mainWindow, downloadUrL) {
    mainWindow.webContents.downloadURL(downloadUrL)
    mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
      //   将文件保存在系统的下载目录
      const filePath = path.join(app.getPath('downloads'), item.getFilename())
      // 自动保存
      item.setSavePath(filePath)
      // 下载进度
      item.on('updated', (event, state) => {
        switch (state) {
          case 'progressing':
            mainWindow.webContents.send('download-progress', (item.getReceivedBytes() / item.getTotalBytes() * 100).toFixed(0))
            break
          case 'interrupted ':
            mainWindow.webContents.send('download-paused', true)
            break
          default:

            break
        }
      })
      // 下载完成或失败
      item.once('done', (event, state) => {
        switch (state) {
          case 'completed':
            const data = {
              filePath
            }
            mainWindow.webContents.send('download-done', data)
            break
          case 'interrupted':
            mainWindow.webContents.send('download-error', true)
            dialog.showErrorBox('下载出错', '由于网络或其他未知原因导致下载出错.')
            break
          default:
            break
        }
      })
    })
  }
}
