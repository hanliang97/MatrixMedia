<template>
  <div class="box-left">
    <el-menu mode="vertical" :show-timeout="200" v-if="show" :default-active="$route.path" :collapse="isCollapse">
      <sidebar-item v-for="route in routes_list" :key="route.name" :item="route" :base-path="route.path" :collapse="isCollapse"></sidebar-item>
    </el-menu>
  </div>
</template>

<script setup>
import { computed, defineComponent, watch, ref } from "vue";
import SidebarItem from "./SidebarItem";
import { useAppStore } from "@/store/app";
import { usePermissionStore } from "@/store/permission";
defineComponent({
  name: "Sidebar",
});
const { sidebarStatus, isRoute } = useAppStore();
const permissionStore = usePermissionStore();

let routes_list = ref([]);
let show = ref(true);

const updateRoutes = () => {
  routes_list.value = permissionStore.routers.map((item, index) => {
    if (item.redirect != useAppStore().isRoute) {
      return { ...item, hidden: true };
    } else {
      return { ...item, hidden: false };
    }
  });
};

updateRoutes();

watch(
  () => useAppStore().isRoute,
  val => {
    show.value = false;
    updateRoutes();
    setTimeout(() => {
      show.value = true;
    }, 60);
  },
  { deep: true }
);

watch(
  () => permissionStore.routers,
  () => {
    show.value = false;
    updateRoutes();
    setTimeout(() => {
      show.value = true;
    }, 60);
  },
  { deep: true }
);

const isCollapse = computed(() => !sidebarStatus.opened);
</script>
<style rel="stylesheet/scss" lang="scss" scoped>
.box-left {
  box-shadow: 2px 6px 10px rgba(0, 0, 0, 0.1);
  height: calc(100vh - 98px);
  overflow-y: auto;
}
</style>
