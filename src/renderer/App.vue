<template>
  <div id="app">
    <c-header></c-header>
    <transition name="fade" mode="out-in">
      <router-view></router-view>
    </transition>
    <el-dialog :title="item.partition.split('-')[0]" v-for="(item,index) in showList" :visible.sync="item.showLoginDialog" append-to-body destroy-on-close width="1020px" @close="closeDialog(index)" :top="(index * 100 )+60+ 'px'" :key="index" >
      <webview v-if="item.url" :src="item.url" style="display: flex; width: 100%; height: 650px" webpreferences="javascript=yes" :httpreferrer="item.url" nodeintegrationinsubframes disablewebsecurity allowpopups :partition="item.partition.split('-')[0]" :key="item.partition.split('-')[0]" :useragent="ptConfig[item.pt.replace('状态','')].useragent"></webview>
    </el-dialog>
 
  </div>
</template>

<script setup>
import {  computed } from "vue";
import CHeader from "./components/title";
import ptConfig from "@/utils/configUrl";
import { useAppStore } from "@/store/app";
const appData = useAppStore();
let showList = computed(() => appData.showLogingData);

function closeDialog(index) {
  useAppStore().delLoginData(index);
}
</script>

<style>
/* CSS */
</style>
