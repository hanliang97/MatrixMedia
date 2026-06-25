<template>
  <div id="app">
    <c-header></c-header>
    <div class="app-body">
      <transition name="fade" mode="out-in">
        <router-view></router-view>
      </transition>
    </div>
  </div>
</template>

<script setup>
import CHeader from "./components/title";
</script>

<style>
#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-body > * {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
