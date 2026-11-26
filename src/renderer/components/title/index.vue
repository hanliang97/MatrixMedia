<!--  -->
<template>
  <div class="window-title" v-if="!IsUseSysTitle && !IsWeb">
    <!-- 软件logo预留位置 -->
    <img
      src="@/assets/icon.png"
      style="width: 30px; height: 30px"
      :style="{ marginLeft: !isNotMac ? 'auto' : '' }"
    />
    <!-- 菜单栏位置 -->
    <div></div>
    <!-- 中间标题位置 -->
    <div style="-webkit-app-region: drag" class="title"></div>
    <div class="controls-container" v-if="isNotMac">
      <div class="windows-icon-bg" @click="Mini">
        <svg-icon icon-class="mini" class-name="icon-size"></svg-icon>
      </div>
      <div class="windows-icon-bg" @click="MixOrReduction">
        <svg-icon
          v-if="mix"
          icon-class="reduction"
          class-name="icon-size"
        ></svg-icon>
        <svg-icon v-else icon-class="mix" class-name="icon-size"></svg-icon>
      </div>
      <div class="windows-icon-bg close-icon" @click="Close">
        <svg-icon icon-class="close" class-name="icon-size"></svg-icon>
      </div>
    </div>
    <!-- 发现新版本：仅提示，用户点「立即更新」才开始下载；「暂不更新」直接关闭 -->
    <el-dialog
      title="发现新版本"
      :visible.sync="versionDialogVisible"
      width="60%"
      top="12vh"
      center
      :close-on-click-modal="false"
    >
      <div class="version-update-summary">
        当前版本 v{{ currentVersion }}，发现新版本
        <span class="version-update-latest">v{{ updateInfo.latestVersion }}</span>
      </div>
      <div v-if="updateInfo.releaseName" class="release-notes-title">
        {{ updateInfo.releaseName }}
      </div>
      <pre class="release-notes-body">{{
        updateInfo.releaseBody || "暂无更新记录"
      }}</pre>
      <div class="version-update-tip">
        也可以暂不更新，明天启动时会再次提醒。
      </div>
      <template #footer>
        <el-button @click="skipUpdate">暂不更新</el-button>
        <el-button
          type="primary"
          :loading="startingDownload"
          @click="startUpdateDownload"
        >
          立即更新
        </el-button>
      </template>
    </el-dialog>
    <el-dialog
      title="自动更新"
      :visible.sync="dialogVisible"
      :show-close="false"
      :close-on-press-escape="false"
      :close-on-click-modal="false"
      center
      width="60%"
      top="10vh"
    >
      <el-tabs v-model="activeUpdateTab">
        <el-tab-pane label="更新记录" name="releaseNotes">
          <div v-if="updateInfo.releaseName" class="release-notes-title">
            {{ updateInfo.releaseName }}
          </div>
          <pre class="release-notes-body">{{
            updateInfo.releaseBody || "暂无更新记录"
          }}</pre>
        </el-tab-pane>
        <el-tab-pane label="安装提示" name="installTips">
          <div style="color: red">提示未知来源请手动允许安装！！</div>
          <div>
            <el-image
              style="width: 50%"
              v-for="(item, index) in srcList"
              :key="index"
              :src="item"
              z-index="999999999"
              :preview-src-list="srcList"
            >
            </el-image>
          </div>
        </el-tab-pane>
      </el-tabs>

      <div v-if="percentage == 100">等待文件处理就绪...</div>
      <div class="conten">
        <el-progress
          :stroke-width="20"
          :percentage="percentage"
          :color="colors"
          :status="progressStaus"
        ></el-progress>
      </div>
      <!-- 兜底退出：本弹窗关闭了 X / ESC / 点遮罩三条关闭入口，
           下载失败或长时间无进展时用户会被遮罩困住。下载未完成时给一个
           显式「关闭」按钮，避免整屏不可操作（历史反馈「卡住遮罩」）。 -->
      <template #footer>
        <el-button
          v-if="percentage < 100"
          size="small"
          @click="dismissUpdateDialog"
        >
          关闭
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
import { shouldRunDailyUpdateCheck } from "./updateCheckPolicy";

const currentVersion = require("../../../../package.json").version;

export default {
  data: () => ({
    mix: false,
    IsUseSysTitle: false,
    isNotMac: process.platform !== "darwin",
    IsWeb: process.env.IS_WEB,
    dialogVisible: false,
    versionDialogVisible: false,
    startingDownload: false,
    currentVersion,
    updateInfo: {
      latestVersion: "",
      releaseName: "",
      releaseBody: "",
    },
    activeUpdateTab: "releaseNotes",
    progressStaus: null,
    filePath: "",
    srcList:
      process.platform === "darwin"
        ? [require("@/assets/mac1.png"), require("@/assets/mac2.png")]
        : [require("@/assets/i1.png"), require("@/assets/i2.png")],
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
    this.checkForUpdates();
    ipcRenderer.invoke("IsUseSysTitle").then((res) => {
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
    ipcRenderer.on("w-max", (event, state) => {
      this.mix = state;
    });
  },

  methods: {
    checkForUpdates(options = {}) {
      if (!options.force && !shouldRunDailyUpdateCheck()) {
        return Promise.resolve({ skipped: true });
      }
      // 只做检测并询问，不擅自下载（非强制更新）
      return Promise.resolve(ipcRenderer.invoke("check-for-updates"))
        .then((res) => {
          if (res && res.hasUpdate) {
            this.updateInfo = {
              latestVersion: res.latestVersion || "",
              releaseName: res.releaseName || "",
              releaseBody: res.releaseBody || "",
            };
            this.activeUpdateTab = "releaseNotes";
            this.versionDialogVisible = true;
          }
          return res;
        })
        .catch(() => ({ hasUpdate: false }));
    },
    // 用户点击「暂不更新」：本次不下载，按每日策略明天再提醒
    skipUpdate() {
      this.versionDialogVisible = false;
    },
    // 关闭「自动更新」进度弹窗。该弹窗禁用了 X / ESC / 点遮罩三条入口，
    // 下载卡住时用户会被遮罩困住，这里给一条明确的退出路径。
    dismissUpdateDialog() {
      this.dialogVisible = false;
      this.$message.info("已关闭更新窗口，可稍后重启应用再试");
    },
    // 用户点击「立即更新」才请求主进程开始下载安装包
    startUpdateDownload() {
      if (this.startingDownload) return;
      this.startingDownload = true;
      // 兜底超时：ipcRenderer.invoke 在极端情况下可能既不 resolve 也不 reject
      // （主进程事件异常等），届时按钮会永久转圈、弹窗遮罩挡住整个界面。
      // 这里限时等不到结果就复位并给提示，保证用户永远能退出来。
      let settled = false;
      const timeoutMs = 15000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.startingDownload = false;
        this.versionDialogVisible = false;
        this.$message.error("启动更新超时，已取消，请稍后重试");
      }, timeoutMs);

      Promise.resolve(ipcRenderer.invoke("start-update-download"))
        .then((res) => {
          if (settled) return;
          settled = true;
          if (res && res.ok) {
            this.versionDialogVisible = false;
            this.resetDownloadUi();
            return;
          }
          // 失败时同样关闭弹窗：只弹 toast 提示。否则遮罩会一直挡在主界面上，
          // 用户点「立即更新」失败后既看不到内容也关不掉（历史反馈）。
          this.versionDialogVisible = false;
          this.$message.error((res && res.message) || "启动更新下载失败");
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          this.versionDialogVisible = false;
          this.$message.error("启动更新下载失败");
        })
        .finally(() => {
          clearTimeout(timer);
          this.startingDownload = false;
        });
    },
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
            // 用户已确认过更新，重试直接重新开始下载
            this.startUpdateDownload();
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
      ipcRenderer.invoke("window-max").then((res) => {
        this.mix = res.status;
      });
    },
    Close() {
      ipcRenderer.invoke("windows-mini");
    },
  },
  destroyed() {
    ipcRenderer.removeAllListeners("w-max");
    ipcRenderer.removeListener("download-progress", this._onDownloadProgress);
    ipcRenderer.removeListener("download-error", this._onDownloadError);
    ipcRenderer.removeListener("download-paused", this._onDownloadPaused);
    ipcRenderer.removeListener("download-done", this._onDownloadDone);
  },
};
</script>
<style rel="stylesheet/scss" lang="scss" scoped>
.window-title {
  width: 100%;
  height: 30px;
  line-height: 30px;
  display: flex;
  -webkit-app-region: drag;
  position: fixed;
  top: 0;
  background: linear-gradient(to right, #0c3c78, #fff);
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
.release-notes-title {
  margin-bottom: 8px;
  font-weight: 600;
}
.version-update-summary {
  margin-bottom: 10px;
  font-size: 14px;
  color: #303133;

  .version-update-latest {
    color: #f56c6c;
    font-weight: 600;
  }
}
.version-update-tip {
  margin-top: 10px;
  font-size: 12px;
  color: #909399;
}
.release-notes-body {
  box-sizing: border-box;
  width: 100%;
  max-height: 240px;
  padding: 12px;
  margin: 0;
  overflow: auto;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: left;
  background: #f7f8fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  color: #303133;
  font-family: inherit;
}
</style>
