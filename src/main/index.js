"use strict";

const electron = require("electron");
if (typeof electron !== "object" || !electron.app) {
  const runAsNode = process.env.ELECTRON_RUN_AS_NODE;
  if (runAsNode && String(runAsNode).trim() !== "") {
    console.error(
      "MatrixMedia: 检测到环境变量 ELECTRON_RUN_AS_NODE 已开启，主进程会得到 npm 的 electron 路径字符串而非 API。",
      "请先取消该变量后再启动，例如：ELECTRON_RUN_AS_NODE= electron . cli publish --help"
    );
  } else {
    console.error(
      "MatrixMedia: require('electron') 异常，请使用「electron .」从项目根启动（勿直接 electron path/to/main.js）。",
      typeof electron
    );
  }
  process.exit(1);
}
const app = electron.app;
const { Tray, nativeImage, Menu, dialog, screen } = electron;

import initWindow from "./services/windowManager";
import DisableButton from "./config/DisableButton";
import path from "path";
import pie from "puppeteer-in-electron";
import { isCliMode, runCliMain } from "./cli";
import { startScheduledPublishScheduler } from "./services/scheduledPublish";

const cliMode = isCliMode(process.argv);

if (!cliMode) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  }
}

app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");

if (!cliMode) {
  app.on("window-all-closed", () => {
    app.quit();
  });
}

let tray;

pie.initialize(app).then(() => {
  if (cliMode) {
    const startCli = () => {
      runCliMain(process.argv)
        .then(code => {
          app.exit(typeof code === "number" ? code : 0);
        })
        .catch(err => {
          console.error(err);
          app.exit(1);
        });
    };
    if (app.isReady()) {
      startCli();
    } else {
      app.on("ready", startCli);
    }
  } else if (app.isReady()) {
    onAppReady();
  } else {
    app.on("ready", onAppReady);
  }
});

function onAppReady() {
  startScheduledPublishScheduler();
  initWindow(win => {
    const iconPath = path.join(__static, "logo.png");
    console.log(iconPath);
    let icon = nativeImage.createFromPath(iconPath);
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
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip("推推达人");
    tray.on("click", () => {
      win.isVisible() ? win.hide() : win.show();
    });
    app.on("will-quit", () => {
      tray.destroy();
    });
  });
  DisableButton.Disablef12();
  if (process.env.NODE_ENV === "development") {
    try {
      const { default: installExtension, VUEJS_DEVTOOLS } = require("electron-devtools-installer");
      installExtension(VUEJS_DEVTOOLS)
        .then(name => console.log(`installed: ${name}`))
        .catch(err => console.log("Unable to install `vue-devtools`: \n", err));
    } catch (err) {
      console.log("electron-devtools-installer 加载失败:", err);
    }
  }
}

app.on("browser-window-created", () => {
  if (!cliMode) {
    console.log("window-created");
  }
});
