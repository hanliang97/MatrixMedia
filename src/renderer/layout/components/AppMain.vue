<template>
  <section class="app-main">
    <transition name="fade" mode="out-in">
      <keep-alive>
        <router-view :key="$route.path"  />
      </keep-alive>
    </transition>
  </section>
</template>

<script setup>
import { defineComponent } from "vue";
defineComponent({
  name: "AppMain"
});
</script>
