module.exports = {
  build: {
    cleanConsole: false,  // 是否清理控制台
    hotPublishConfigName: "update-config",
  },
  dev: {
    removeElectronJunk: true,
    chineseLog: true,
    port: 9088,
  },
  DllFolder: "",
  UseJsx: true,
};
