<template>
  <div class="app-wrapper NoUseSysTitle" >
    <div :class="classObj">
      <navbar></navbar>
      <div class="container-set flex">
        <!-- {{ route }} -->
        <sidebar class="sidebar-container" v-if="!$route.meta.noSlide" ></sidebar>
        <div class="main-container">
          <app-main></app-main>
        </div>
      </div>
    </div>
    <!-- 反馈问卷弹窗：原本是 el-dialog 套 <webview>，已改成
         「点确认 → 调主进程 open-external-window 弹独立 BrowserWindow 加载问卷」。
         彻底移除 webview 标签，保持全应用 webview-free。 -->
    <el-dialog
      title="MatrixMedia 使用反馈"
      :visible.sync="feedbackDialogVisible"
      append-to-body
      destroy-on-close
      width="480px"
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="feedback-confirm-text">
        我们想听听你的使用感受。点击「打开反馈表单」会弹出一个独立窗口，
        填写后回到本窗口点「我已经提交」即可。
      </div>
      <template #footer>
        <el-button @click="openFeedbackWindow">打开反馈表单</el-button>
        <el-button type="primary" @click="showFeedbackConfirm">
          我已经提交
        </el-button>
      </template>
    </el-dialog>
    <el-dialog
      title="确认是否已填表"
      :visible.sync="feedbackConfirmVisible"
      append-to-body
      width="420px"
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="feedback-confirm-text">
        请确认你已经填写并提交了反馈表。确认后，本版本将不再显示该反馈弹窗。
      </div>
      <template #footer>
        <el-button @click="feedbackConfirmVisible = false">
          还没提交
        </el-button>
        <el-button type="primary" @click="confirmFeedbackSubmitted">
          确认已提交
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import AppMain from "./components/AppMain";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { useAppStore } from "@/store/app";
import { ipcRenderer } from "electron";
import packageInfo from "../../../package.json";


const { sidebarStatus } = useAppStore();
const IsUseSysTitle = ref(false);
const sidebarSwitch = computed(() => sidebarStatus.opened)
const feedbackUrl = "https://wj.qq.com/s2/26701939/4679/";
const feedbackDialogVisible = ref(false);
const feedbackConfirmVisible = ref(false);
const feedbackStorageKey = `matrixmedia-feedback-submitted:${packageInfo.version}`;

ipcRenderer.invoke("IsUseSysTitle").then(res => {
  IsUseSysTitle.value = res;
});

onMounted(() => {
  // 2026.6.1号就不出现了
  const now = new Date();
  const targetDate = new Date(2026, 5, 1);
  if (now > targetDate) {
    feedbackDialogVisible.value = localStorage.getItem(feedbackStorageKey) !== "1";
  }
});

function openFeedbackWindow() {
  ipcRenderer.invoke("open-external-window", {
    url: feedbackUrl,
    title: "MatrixMedia 使用反馈",
    width: 960,
    height: 720,
  }).catch(() => {});
}

function showFeedbackConfirm() {
  feedbackConfirmVisible.value = true;
}

function confirmFeedbackSubmitted() {
  localStorage.setItem(feedbackStorageKey, "1");
  feedbackConfirmVisible.value = false;
  feedbackDialogVisible.value = false;
}

const classObj = computed(() => {
  return {
    hideSidebar: !sidebarSwitch.value,
    openSidebar: sidebarSwitch.value
  };
});
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
@import "@/styles/mixin.scss";

.app-wrapper {
  @include clearfix;
  position: relative;
  height: 100%;
  width: 100%;


}
.container-set{
  height: calc(100vh - 98px);
  overflow: hidden;
}

.UseSysTitle {
  top: 0px;
}

.NoUseSysTitle {
  top: 30px
}

.feedback-confirm-text {
  color: #333333;
  line-height: 24px;
}
</style>
