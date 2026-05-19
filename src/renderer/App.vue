<template>
  <div id="app">
    <c-header></c-header>
    <transition name="fade" mode="out-in">
      <router-view></router-view>
    </transition>
    <!-- 旧的全局登录弹窗（基于 store.showLogingData 用 el-dialog 套 <webview>）
         已废弃：getLoginInfo 检测到未登录账号后，会通过 openLoginWindow 直接
         弹独立 BrowserWindow，绕开 webview 反爬识别。 -->
  </div>
</template>

<script setup>
import CHeader from "./components/title";
</script>

<style>
/* CSS */
</style>
