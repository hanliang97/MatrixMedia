// 这里是定义菜单的地方，详情请查看 https://electronjs.org/docs/api/menu
const { dialog } = require('electron')
const os = require('os')
const version = require('../../../package.json').version
const menu = [
  {
    label: '设置',
    submenu: [{
      label: '快速重启',
      accelerator: 'F5',
      role: 'reload'
    }, {
      label: '退出',
      accelerator: 'CmdOrCtrl+F4',
      role: 'close'
    }]
  },
  {
    label: '编辑',
    submenu: [{
      label: '撤销',
      accelerator: 'CmdOrCtrl+Z',
      role: 'undo'
    },
    {
      label: '重做',
      accelerator: 'Shift+CmdOrCtrl+Z',
      role: 'redo'
    },
    {
      label: '剪切',
      accelerator: 'CmdOrCtrl+X',
      role: 'cut'
    },
    {
      label: '复制',
      accelerator: 'CmdOrCtrl+C',
      role: 'copy'
    },
    {
      label: '粘贴',
      accelerator: 'CmdOrCtrl+V',
      role: 'paste'
    }
    ]
  },

  {
    label: '帮助',
    submenu: [{
      label: '关于',
      role: 'about',
      click: function () {
        info()
      }
    }]
  }]
function info() {
  dialog.showMessageBox({
    title: '关于',
    type: 'info',
    message: 'electron-Vue框架',
    detail: `版本信息：${version}\n引擎版本：${process.versions.v8}\n当前系统：${os.type()} ${os.arch()} ${os.release()}`,
    noLink: true,
    buttons: ['查看github', '确定']
  })
}
export default menu
