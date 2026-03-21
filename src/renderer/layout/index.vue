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
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import AppMain from "./components/AppMain";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import { useAppStore } from "@/store/app";
import { ipcRenderer } from "electron";
import { useRoute } from "@/hooks/use-router";


const { sidebarStatus } = useAppStore();
const IsUseSysTitle = ref(false);
const sidebarSwitch = computed(() => sidebarStatus.opened)

ipcRenderer.invoke("IsUseSysTitle").then(res => {
  IsUseSysTitle.value = res;
});

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
</style>
