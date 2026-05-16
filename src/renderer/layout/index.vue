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
    <el-dialog
      title="MatrixMedia 使用反馈"
      :visible.sync="feedbackDialogVisible"
      append-to-body
      destroy-on-close
      width="960px"
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <webview
        v-if="feedbackDialogVisible"
        :src="feedbackUrl"
        class="feedback-webview"
        webpreferences="javascript=yes"
        :httpreferrer="feedbackUrl"
        disablewebsecurity
        allowpopups
      />
      <template #footer>
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
  feedbackDialogVisible.value = localStorage.getItem(feedbackStorageKey) !== "1";
});

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

.feedback-webview {
  display: flex;
  width: 100%;
  height: 650px;
}

.feedback-confirm-text {
  color: #333333;
  line-height: 24px;
}
</style>
