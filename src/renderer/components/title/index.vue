<!--  -->
<template>
  <div class="window-title" v-if="!IsUseSysTitle&&!IsWeb">
    <!-- 软件logo预留位置 -->
      <img src="@/assets/icon.png" style="width: 30px;height: 30px;" :style="{ marginLeft: !isNotMac ? 'auto' : '' }" >
    <!-- 菜单栏位置 -->
    <div></div>
    <!-- 中间标题位置 -->
    <div style="-webkit-app-region: drag;" class="title"></div>
    <div class="controls-container" v-if="isNotMac">
      <div class="windows-icon-bg" @click="Mini">
        <svg-icon icon-class="mini" class-name="icon-size"></svg-icon>
      </div>
      <div class="windows-icon-bg" @click="MixOrReduction">
        <svg-icon v-if="mix" icon-class="reduction" class-name="icon-size"></svg-icon>
        <svg-icon v-else icon-class="mix" class-name="icon-size"></svg-icon>
      </div>
      <div class="windows-icon-bg close-icon" @click="Close">
        <svg-icon icon-class="close" class-name="icon-size"></svg-icon>
      </div>
    </div>
    <el-dialog title="自动更新" :visible.sync="dialogVisible" :show-close="false" :close-on-press-escape="false" :close-on-click-modal="false" center width="60%" top="10vh">
      <div style='color:red' >
        提示未知来源请手动允许安装！！
      </div>
      <div>
        <el-image 
        style="width: 50%;"
        v-for="(item, index) in srcList" :key="index"
        :src="item" 
        z-index="999999999"
        :preview-src-list="srcList">
      </el-image>
      </div>
     
      <div v-if="percentage == 100" >等待文件处理就绪...</div>
      <div class="conten">
        <el-progress :stroke-width="20" :percentage="percentage" :color="colors" :status="progressStaus"></el-progress>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
export default {
  data: () => ({
    mix: false,
    IsUseSysTitle: false,
    isNotMac: process.platform !== "darwin",
    IsWeb: process.env.IS_WEB,
    dialogVisible: false,
    progressStaus: null,
    filePath: "",
    srcList: process.platform === "darwin"
      ? [
          require("@/assets/mac1.png"),
          require("@/assets/mac2.png"),
        ]
      : [
          require("@/assets/i1.png"),
          require("@/assets/i2.png"),
        ],
    colors: [
      { color: "#f56c6c", percentage: 20 },
      { color: "#e6a23c", percentage: 40 },
      { color: "#6f7ad3", percentage: 60 },
      { color: "#1989fa", percentage: 80 },
      { color: "#5cb87a", percentage: 100 },
    ],
    percentage: 0,
  }),

  components: {},
  created() {
    ipcRenderer.invoke("check-for-updates");
    ipcRenderer.invoke("IsUseSysTitle").then(res => {
      this.IsUseSysTitle = res;
    });
    // 下载进度
    ipcRenderer.on("download-progress", this._onDownloadProgress);
    // 下载报错
    ipcRenderer.on("download-error", this._onDownloadError);
    // 下载暂停提示
    ipcRenderer.on("download-paused", this._onDownloadPaused);
    // 下载成功
    ipcRenderer.on("download-done", this._onDownloadDone);
  },

  mounted() {
      ipcRenderer.on("w-max",(event,state)=>{
        this.mix = state
      })
  },

  methods: {
    _defaultProgressColors() {
      return [
        { color: "#f56c6c", percentage: 20 },
        { color: "#e6a23c", percentage: 40 },
        { color: "#6f7ad3", percentage: 60 },
        { color: "#1989fa", percentage: 80 },
        { color: "#5cb87a", percentage: 100 },
      ];
    },
    resetDownloadUi() {
      this.percentage = 0;
      this.progressStaus = null;
      this.colors = this._defaultProgressColors();
      this.dialogVisible = false;
    },
    _onDownloadProgress(event, arg) {
      this.percentage = Number(arg);
      this.dialogVisible = Boolean(this.percentage);
    },
    _onDownloadError(event, arg) {
      if (arg) {
        this.progressStaus = "exception";
        this.percentage = 40;
        this.colors = "#d81e06";
      }
    },
    _onDownloadPaused(event, arg) {
      if (arg) {
        this.progressStaus = "warning";
        this.$alert("下载由于未知原因被中断！", "提示", {
          confirmButtonText: "重试",
          callback: () => {
            this.resetDownloadUi();
            ipcRenderer.invoke("check-for-updates");
          },
        });
      }
    },
    _onDownloadDone(event, age) {
      this.filePath = age.filePath;
      this.progressStaus = "success";
      this.dialogVisible = false;
      this.$alert("更新下载完成！", "提示", {
        confirmButtonText: "安装",
        callback: () => {
          ipcRenderer.invoke("launch-installer", this.filePath);
        },
      });
    },
    Mini() {
      ipcRenderer.invoke("windows-mini");
    },
    MixOrReduction() {
      ipcRenderer.invoke("window-max").then(res=>{
        this.mix = res.status
      })
    },
    Close() {
     ipcRenderer.invoke("windows-mini");
    }
  },
  destroyed() {
    ipcRenderer.removeAllListeners("w-max");
    ipcRenderer.removeListener("download-progress", this._onDownloadProgress);
    ipcRenderer.removeListener("download-error", this._onDownloadError);
    ipcRenderer.removeListener("download-paused", this._onDownloadPaused);
    ipcRenderer.removeListener("download-done", this._onDownloadDone);
  }
};
</script>
<style rel='stylesheet/scss' lang='scss' scoped>
.window-title {
  width: 100%;
  height: 30px;
  line-height: 30px;
  display: flex;
  -webkit-app-region: drag;
  position: fixed;
  top: 0;
  background:linear-gradient(to right, #0c3c78, #fff);
  z-index: 99999;
  .title {
    text-align: center;
  }
  .logo {
    margin-left: 20px;
  }
  .controls-container {
    display: flex;
    flex-grow: 0;
    flex-shrink: 0;
    text-align: center;
    position: relative;
    z-index: 3000;
    -webkit-app-region: no-drag;
    height: 100%;
    width: 138px;
    margin-left: auto;
    .windows-icon-bg {
      display: inline-block;
      -webkit-app-region: no-drag;
      height: 100%;
      width: 33.34%;
      color: rgba(129, 129, 129, 0.6);
      .icon-size {
        width: 12px;
        height: 15px;
      }
    }
    .windows-icon-bg:hover {
      background-color: rgba(182, 182, 182, 0.2);
      color: #333;
    }
    .close-icon:hover {
      background-color: rgba(232, 17, 35, 0.9);
      color: #fff;
    }
  }
}
</style>