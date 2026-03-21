"use strict";

import { app, Tray, nativeImage, Menu, dialog, screen } from "electron";
import initWindow from "./services/windowManager";
import DisableButton from "./config/DisableButton";
import electronDevtoolsInstaller, { VUEJS_DEVTOOLS } from "electron-devtools-installer";
import path from "path";
import pie from "puppeteer-in-electron";


let tray;
// ⚠️ 一定要在 app.ready 前执行
pie.initialize(app).then(res => {
  app.isReady() ? onAppReady() : app.on("ready", onAppReady);
});

function onAppReady() {
  initWindow(win => {
    const iconPath = path.join(__static, "logo.png");
    console.log(iconPath);
    let icon = nativeImage.createFromPath(iconPath);
    /* macOS 菜单栏约 22pt；大图（如 500px）若不缩放会明显偏大 */
    if (process.platform === "darwin" && !icon.isEmpty()) {
      const scale = screen.getPrimaryDisplay().scaleFactor || 1;
      const target = Math.round(10 * scale);
      const { width, height } = icon.getSize();
      if (width > target || height > target) {
        icon = icon.resize({ width: target, height: target });
      }
    }
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "显示主界面",
        click: () => {
          win.show();
        },
      },
      {
        label: "设置",
        click: function () {
          console.log("setting");
          win.webContents.send("goSetting");
        },
      },
      {
        label: "重启应用",
        click: function () {
          // win.reload();
          // 询问是否重启dialog
          dialog
            .showMessageBox(win, {
              type: "question",
              title: "重启应用",
              message: "是否重启应用？",
              buttons: ["是", "否"],
            })
            .then(result => {
              if (result.response === 0) {
                win.reload();
              }
            });
        },
      },
      {
        label: "退出程序",
        click: () => {
          app.quit(); // 退出应用程序
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip("推推达人");
    // 监听托盘点击事件
    tray.on("click", () => {
      win.isVisible() ? win.hide() : win.show();
    });
    // 确保在应用程序退出时销毁托盘
    app.on("will-quit", () => {
      tray.destroy();
    });
  });
  DisableButton.Disablef12();
  if (process.env.NODE_ENV === "development") {
    electronDevtoolsInstaller(VUEJS_DEVTOOLS)
      .then(name => console.log(`installed: ${name}`))
      .catch(err => console.log("Unable to install `vue-devtools`: \n", err));
  }
}
//禁止程序多开，此处需要单例锁的同学打开注释即可
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// 解决9.x跨域异常问题
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");

app.on("window-all-closed", () => {
  // 所有平台均为所有窗口关闭就退出软件
  app.quit();
});
app.on("browser-window-created", () => {
  console.log("window-created");
});
