import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import './custom.css'
import ActiveUsersBoard from './components/ActiveUsersBoard.vue'
import HomeOpenCount from './components/HomeOpenCount.vue'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // 首页 hero 区块顶部（“快速开始”按钮上方）插入打开次数徽章
      'home-hero-before': () => h(HomeOpenCount)
    })
  },
  enhanceApp({ app }) {
    app.component('ActiveUsersBoard', ActiveUsersBoard)
  }
}
