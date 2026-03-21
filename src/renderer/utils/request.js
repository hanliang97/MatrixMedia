import axios from 'axios'
import { Message } from 'element-ui'
const serves = axios.create({
  baseURL: 'http://127.0.0.1:30088',
  timeout: 5000
})

// 设置请求发送之前的拦截器
serves.interceptors.request.use(config => {
  // 设置发送之前数据需要做什么处理
  return config
}, err => Promise.reject(err))

// 设置请求接受拦截器
serves.interceptors.response.use(res => {
  // 设置接受数据之后，做什么处理
  if (res.data.code === 50000) {
    Message.error(res.data.data)
  }
  return res
}, err => {
  // 判断请求异常信息中是否含有超时timeout字符串
  if (err.message.includes('timeout')) {
    console.log('错误回调', err)
    Message.error('网络超时')
  }
  if (err.message.includes('Network Error')) {
    console.log('错误回调', err)
    Message.error('服务端未启动，或网络连接错误')
  }
  return Promise.reject(err)
})

// 将serves抛出去
export default serves
