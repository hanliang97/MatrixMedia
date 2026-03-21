import Vue from 'vue'
import { ipcRenderer } from 'electron'
import { createPinia, PiniaVuePlugin } from 'pinia'
import Router from 'vue-router'

import App from './App'
import router from './router'
import { usePermission } from './permission'
// 引用element
import ElementUI from 'element-ui'
import 'element-ui/lib/theme-chalk/index.css'
// 日志
import './error'
import './icons'
import '@/styles/index.scss'
import '@/styles/dark-mode.scss'
import 'windi.css'


const pinia = createPinia()

if (!process.env.IS_WEB) {
  ipcRenderer.invoke("IsUseSysTitle").then(res => {
    if (!res) {
      require('@/styles/custom-title.scss')
    }
  });
}

ipcRenderer.invoke("statr-server").then(res => {
  if (!res) {
    console.log("重启服务器");
  } 
});

Vue.use(PiniaVuePlugin) // 确保pinia在最先挂载
Vue.use(Router)

usePermission() // 放在后面，确保加载顺序


Vue.use(ElementUI)

Vue.config.productionTip = false

new Vue({
  components: { App },
  router,
  pinia,
  template: '<App/>',
}).$mount('#app')

