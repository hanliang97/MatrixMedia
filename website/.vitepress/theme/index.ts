import DefaultTheme from 'vitepress/theme'
import './custom.css'
import ActiveUsersBoard from './components/ActiveUsersBoard.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ActiveUsersBoard', ActiveUsersBoard)
  }
}
