<template>
  <section class="app-main">
    <div class="app-main-viewport">
      <transition name="fade" mode="out-in">
        <keep-alive>
          <router-view :key="$route.path" />
        </keep-alive>
      </transition>
    </div>
  </section>
</template>

<script setup>
import { defineComponent } from "vue";
defineComponent({
  name: "AppMain",
});
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
.app-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-main-viewport {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: scroll;
}
</style>
