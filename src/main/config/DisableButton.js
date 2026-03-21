import { globalShortcut } from 'electron'
import { DisableF12 } from "./const"

export default {
  Disablef12() {
    if (process.env.NODE_ENV === 'production' && DisableF12) {
      globalShortcut.register('f12', () => {
        console.log('用户试图启动控制台')
      })
    }
  }
}
