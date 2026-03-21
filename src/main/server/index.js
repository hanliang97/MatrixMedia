/* eslint-disable prefer-promise-reject-errors */
import app from './server'
import http from "http";
const port = process.env.userConfig.BuiltInServerPort
var server = null
app.set('port', port)
 
export default {
  StatrServer () {
    return new Promise((resolve, reject) => {
      console.log('启动服务--------',port)
      server = http.createServer(app)
      server.listen(port)
      server.on('error', (error) => {
        switch (error.code) {
          case 'EACCES':
            reject('权限不足内置服务器启动失败，请使用管理员权限运行。')
            break
          case 'EADDRINUSE':
            // reject('内置服务器端口已被占用，请检查。')
            break
          default:
            reject(error)
        }
      })
      server.on('listening', () => {
        resolve('服务端运行中'+port)
      })
    })
  },
  StopServer () {
    return new Promise((resolve, reject) => {
      if (server) {
        server.close()
        server.on('close', () => {
          server = null
          resolve(1)
        })
      } else {
        reject('服务端尚未开启')
      }
    })
  }
}
