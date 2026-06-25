<template>
  <div class="sidebar-panel">
    <div v-if="!isCollapse" class="sidebar-head">
      <span class="sidebar-head-title">分组列表</span>
      <span class="sidebar-head-tip">拖动分组排序</span>
    </div>
    <div class="box-left">
      <draggable
        v-if="show"
        v-model="visibleRoutes"
        handle=".group-drag-handle"
        :animation="200"
        :disabled="isCollapse"
        class="sidebar-groups"
        ghost-class="sidebar-group-ghost"
        @start="onGroupSortStart"
        @end="onGroupSortEnd"
      >
        <div
          v-for="route in visibleRoutes"
          :key="route.name"
          class="sidebar-group-row"
        >
          <el-menu
            mode="vertical"
            :default-active="$route.path"
            :collapse="isCollapse"
            :router="false"
            class="group-menu"
          >
            <sidebar-item
              :item="route"
              :base-path="route.path"
              :collapse="isCollapse"
            />
          </el-menu>
        </div>
      </draggable>
    </div>
  </div>
</template>

<script setup>
import { computed, defineComponent, watch, ref } from "vue";
import draggable from "vuedraggable";
import SidebarItem from "./SidebarItem";
import { useAppStore } from "@/store/app";
import { usePermissionStore } from "@/store/permission";
import dataRequest from "@/utils/dataRequest";
import {
  buildGroupOrderUpdates,
  extractGroupKey,
  reorderAccountTreeStorage,
  reorderPermissionStoreRouters,
} from "../../../../shared/accountGroupOrder.js";

defineComponent({
  name: "Sidebar",
});

const { sidebarStatus } = useAppStore();
const permissionStore = usePermissionStore();

const routes_list = ref([]);
const visibleRoutes = ref([]);
const show = ref(true);
const sorting = ref(false);

const isCollapse = computed(() => !sidebarStatus.opened);

const syncVisibleRoutes = () => {
  visibleRoutes.value = routes_list.value.filter((item) => !item.hidden);
};

const updateRoutes = () => {
  routes_list.value = permissionStore.routers.map((item) => {
    if (item.redirect != useAppStore().isRoute) {
      return { ...item, hidden: true };
    }
    return { ...item, hidden: false };
  });
  syncVisibleRoutes();
};

updateRoutes();

watch(
  () => useAppStore().isRoute,
  () => {
    if (sorting.value) return;
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
    if (sorting.value) return;
    show.value = false;
    updateRoutes();
    setTimeout(() => {
      show.value = true;
    }, 60);
  },
  { deep: true }
);

function onGroupSortStart() {
  sorting.value = true;
}

async function onGroupSortEnd() {
  const orderedPhones = visibleRoutes.value
    .map((route) => extractGroupKey(route))
    .filter(Boolean);
  if (orderedPhones.length === 0) {
    sorting.value = false;
    return;
  }

  permissionStore.routers = reorderPermissionStoreRouters(
    permissionStore.routers,
    orderedPhones
  );
  reorderAccountTreeStorage(orderedPhones);
  updateRoutes();

  try {
    const res = await dataRequest({
      type: "get",
      fileName: "account",
      item: { page: 1, pageSize: 10000 },
    });
    const raw = (res && res.data) || {};
    const updates = buildGroupOrderUpdates(raw, orderedPhones);
    await Promise.all(
      updates.map((item) =>
        dataRequest({
          type: "update",
          fileName: "account",
          item,
        })
      )
    );
  } catch (e) {
    console.warn("保存分组排序失败:", e && e.message);
  } finally {
    sorting.value = false;
  }
}
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
@import "@/styles/variables.scss";

.sidebar-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  width: 100%;
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  border-bottom: 1px solid $borderColor;
  background-color: $menuBg;
  flex-shrink: 0;
}

.sidebar-head-title {
  font-size: 13px;
  font-weight: 600;
  color: $menuText;
}

.sidebar-head-tip {
  font-size: 12px;
  color: $menuMuted;
}

.box-left {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: scroll;
  background-color: $menuBg;
}

.sidebar-groups {
  min-height: 100%;
}

.sidebar-group-row {
  border-bottom: 1px solid $borderColor;
}

.sidebar-group-ghost {
  opacity: 0.6;
  background-color: $menuHover;
}

.group-menu {
  border-right: none;
}
</style>
