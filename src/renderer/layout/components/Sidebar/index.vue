<template>
  <div class="sidebar-panel">
    <div v-if="!isCollapse && showGroupHead" class="sidebar-head">
      <span class="sidebar-head-title">分组列表</span>
      <span class="sidebar-head-tip">
        拖动分组排序
        <el-button
          type="text"
          size="mini"
          class="sidebar-rename-btn"
          @click="openRenameDialog"
        >重命名</el-button>
      </span>
    </div>
    <el-dialog
      :visible.sync="renameVisible"
      title="重命名分组"
      width="420px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form label-width="88px">
        <el-form-item label="选择分组">
          <el-select v-model="renameOld" filterable style="width: 100%">
            <el-option
              v-for="name in groupOptions"
              :key="name"
              :label="name"
              :value="name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="新名称">
          <el-input
            v-model="renameNew"
            maxlength="50"
            placeholder="输入新的分组名称"
            @keyup.enter.native="confirmRenameGroup"
          />
        </el-form-item>
      </el-form>
      <p class="rename-tip">
        改名只影响分组展示与账号归属，不影响各账号的登录态（登录态按平台账号保存）。
      </p>
      <template #footer>
        <el-button @click="renameVisible = false">取消</el-button>
        <el-button type="primary" :loading="renaming" @click="confirmRenameGroup">
          保存
        </el-button>
      </template>
    </el-dialog>
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
import { Message } from "element-ui";
import SidebarItem from "./SidebarItem";
import router from "@/router";
import { useAppStore } from "@/store/app";
import { usePermissionStore } from "@/store/permission";
import dataRequest from "@/utils/dataRequest";
import {
  buildGroupOrderUpdates,
  extractGroupKey,
  reorderAccountTreeStorage,
  reorderPermissionStoreRouters,
} from "../../../../shared/accountGroupOrder.js";
import {
  buildCompatPhone,
  recordGroupOf,
} from "../../../../shared/accountIdentity.js";

defineComponent({
  name: "Sidebar",
});

const { sidebarStatus } = useAppStore();
const permissionStore = usePermissionStore();

const routes_list = ref([]);
const visibleRoutes = ref([]);
const show = ref(true);
const sorting = ref(false);

// ── 分组重命名（新分组模型：分组只是容器，改名不动登录态） ──
const renameVisible = ref(false);
const renameOld = ref("");
const renameNew = ref("");
const renaming = ref(false);

const groupOptions = computed(() =>
  routes_list.value
    .map((route) => extractGroupKey(route))
    .filter((key) => key && !(routeHasAffix(key)))
);

function routeHasAffix(key) {
  const route = routes_list.value.find(
    (route) => extractGroupKey(route) === key
  );
  return Boolean(route && route.meta && route.meta.affix);
}

function openRenameDialog() {
  // 预选第一个可排序分组；用户可下拉切换
  renameOld.value =
    visibleRoutes.value
      .filter((route) => !(route.meta && route.meta.affix))
      .map((route) => extractGroupKey(route))
      .filter(Boolean)[0] || "";
  renameNew.value = "";
  renameVisible.value = true;
}

async function confirmRenameGroup() {
  const oldName = String(renameOld.value || "").trim();
  const newName = String(renameNew.value || "").trim();
  if (!oldName || !newName) {
    Message.warning("请选择分组并填写新名称");
    return;
  }
  if (oldName === newName) {
    renameVisible.value = false;
    return;
  }
  if (groupOptions.value.includes(newName)) {
    Message.warning(`分组「${newName}」已存在，请换一个名称`);
    return;
  }
  renaming.value = true;
  try {
    const res = await dataRequest({
      type: "get",
      fileName: "account",
      item: { page: 1, pageSize: 10000 },
    });
    const raw = (res && res.data) || {};
    const updates = [];
    for (const dateKey of Object.keys(raw)) {
      for (const row of raw[dateKey] || []) {
        if (!row || !row.id) continue;
        if (recordGroupOf(row) !== oldName) continue;
        const next = { ...row, group: newName };
        updates.push({
          id: row.id,
          date: row.date || dateKey,
          group: newName,
          // phone 是兼容字段（旧版本/CLI 按 phone 读写），同步重建
          phone: buildCompatPhone(next),
        });
      }
    }
    if (updates.length === 0) {
      Message.error(`未找到分组「${oldName}」下的账号记录`);
      return;
    }
    for (const item of updates) {
      const r = await dataRequest({
        type: "update",
        fileName: "account",
        item,
      });
      if (r && r.success === false) {
        throw new Error(r.message || "更新账号记录失败");
      }
    }
    renameVisible.value = false;
    Message.success(`分组已重命名为「${newName}」`);
    await usePermissionStore().GenerateRoutes();
    // 当前若停留在旧分组页面，跳到新分组
    const currentPath = router.currentRoute.path || "";
    const oldPrefix = `/accountManager/${oldName}`;
    if (currentPath.startsWith(oldPrefix)) {
      const tail = currentPath.slice(oldPrefix.length);
      router
        .push(`/accountManager/${newName}${tail}`.replace(/\/+$/, ""))
        .catch(() => {});
    }
  } catch (e) {
    Message.error("重命名分组失败：" + (e && e.message ? e.message : e));
  } finally {
    renaming.value = false;
  }
}

const isCollapse = computed(() => !sidebarStatus.opened);

// 「分组列表 / 拖动排序」头部只在媒体平台管理模块显示，账号数据模块不显示
const showGroupHead = computed(
  () => useAppStore().isRoute === "accountManager"
);

// 拖拽排序后同步重排数据统计模块的分组路由，保持两个模块侧边栏顺序一致
function reorderStatsGroupRoutes(routers, orderedPhones) {
  const prefix = "/data-stats/group/";
  const statsMap = {};
  const rest = [];
  (routers || []).forEach((route) => {
    const p = route && route.path ? String(route.path) : "";
    if (p.startsWith(prefix)) {
      const key = (route.meta && route.meta.phone) || p.slice(prefix.length);
      statsMap[key] = route;
    } else {
      rest.push(route);
    }
  });
  const sorted = orderedPhones.map((key) => statsMap[key]).filter(Boolean);
  Object.keys(statsMap).forEach((key) => {
    if (!orderedPhones.includes(key)) sorted.push(statsMap[key]);
  });
  return [...rest, ...sorted];
}

const syncVisibleRoutes = () => {
  // affix 项（如「所有账号」）固定在列表最前，不参与拖拽排序
  visibleRoutes.value = routes_list.value
    .filter((item) => !item.hidden)
    .sort((a, b) => affixWeight(b) - affixWeight(a));
};

const affixWeight = (route) => (route.meta && route.meta.affix ? 1 : 0);

const routeModuleKey = (item) =>
  item.redirect || (item.meta && item.meta.navModule);

const updateRoutes = () => {
  routes_list.value = permissionStore.routers.map((item) => {
    if (routeModuleKey(item) != useAppStore().isRoute) {
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
    .filter((route) => !(route.meta && route.meta.affix))
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
  permissionStore.routers = reorderStatsGroupRoutes(
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

.sidebar-rename-btn {
  padding: 0 0 0 6px;
  font-size: 12px;
}

.rename-tip {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
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
