<template>
  <div class="app-wrapper NoUseSysTitle">
    <div :class="classObj" class="layout-body">
      <navbar></navbar>
      <div class="container-set flex">
        <!-- {{ route }} -->
        <sidebar
          class="sidebar-container"
          v-if="!$route.meta.noSlide"
        ></sidebar>
        <div class="main-container">
          <app-main></app-main>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import AppMain from "./components/AppMain";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { useAppStore } from "@/store/app";
import { ipcRenderer } from "electron";

const { sidebarStatus } = useAppStore();
const IsUseSysTitle = ref(false);
const sidebarSwitch = computed(() => sidebarStatus.opened);

ipcRenderer.invoke("IsUseSysTitle").then((res) => {
  IsUseSysTitle.value = res;
});

const classObj = computed(() => {
  return {
    hideSidebar: !sidebarSwitch.value,
    openSidebar: sidebarSwitch.value,
  };
});
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
@import "@/styles/mixin.scss";
@import "@/styles/variables.scss";

.app-wrapper {
  @include clearfix;
  position: relative;
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.layout-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.container-set {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.UseSysTitle {
  top: 0px;
}

.NoUseSysTitle {
  top: $titleBarHeight;
  // 标题栏 fixed 定位不占布局，下移多少就要从高度里减去多少，否则内容区底部被裁。
  // 注意：本元素同时是 .app-body 的 flex 子项（App.vue 里 flex:1 会撑满高度，
  // 单写 height 无效），必须用 flex-grow:0 + flex-basis 才能真正收缩。
  flex: 0 1 calc(100% - #{$titleBarHeight});
  max-height: calc(100% - #{$titleBarHeight});
}
</style>
