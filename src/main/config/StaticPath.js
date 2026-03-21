// 这里定义了静态文件路径的位置
import path from 'path'
import { DllFolder } from '@config/index'

/**
 * Set `__static` path to static files in production
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-static-assets.html
 */
// 这个瓜皮全局变量只能在单个js中生效，而并不是整个主进程中
if (process.env.NODE_ENV !== 'development') {
  global.__static = path.join(__dirname, '/static').replace(/\\/g, '\\\\')
  process.env.libPath = path.join(__dirname, '..', '..', '..', '..', `${DllFolder}`).replace(/\\/g, '\\\\')
}

export const winURL = process.env.NODE_ENV === 'development' ? `http://localhost:${process.env.PORT}` : `file://${__dirname}/index.html`
export const loadingURL = process.env.NODE_ENV === 'development' ? `http://localhost:${process.env.PORT}/static/loader.html` : `file://${__static}/loader.html`
export const libPath = process.env.libPath
