<template>
  <div
    v-if="!item.hidden && item.children && item.children.length"
    class="menu-wrapper"
    :class="collapse ? '' : 'active-menu-wrapper'"
  >
    <el-submenu :index="String(item.name || item.path)">
      <template slot="title">
        <span
          v-if="!collapse"
          class="group-drag-handle"
          title="拖动排序"
          @mousedown.stop
          @click.stop
          >⋮⋮</span
        >
        <span v-if="item.meta && item.meta.title" class="group-title">{{
          item.meta.title
        }}</span>
      </template>

      <template v-for="child in item.children">
        <sidebar-item
          v-if="!child.hidden && child.children && child.children.length > 0"
          :key="'nest-' + (child.name || child.path)"
          :is-nest="true"
          class="nest-menu"
          :item="child"
          :base-path="resolvePath(child.path)"
          :collapse="collapse"
        />

        <router-link
          v-else-if="!child.hidden"
          :key="'leaf-' + (child.name || child.path)"
          :to="resolvePath(child.path)"
        >
          <el-menu-item
            class="platform-menu-item"
            :index="resolvePath(child.path)"
          >
            <img
              v-if="ptIconSrc(child.meta && child.meta.pt)"
              class="pt-icon"
              :src="ptIconSrc(child.meta && child.meta.pt)"
              alt=""
            />
            <svg-icon
              v-else-if="child.meta && child.meta.icon"
              :icon-class="child.meta.icon"
            />
            <span v-if="child.meta && child.meta.title">{{
              child.meta.title
            }}</span>
          </el-menu-item>
        </router-link>
      </template>
    </el-submenu>
  </div>
</template>

<script>
const PT_ICON_STEM = {
  抖音: "dy",
  视频号: "sph",
  哔哩哔哩: "blbl",
  百家号: "bjh",
  头条: "tt",
  快手: "ks",
  小红书: "xhs",
  番茄视频: "fqsp",
};

export default {
  name: "SidebarItem",
  props: {
    item: {
      type: Object,
      required: true,
    },
    isNest: {
      type: Boolean,
      default: false,
    },
    basePath: {
      type: String,
      default: "",
    },
    collapse: {
      type: Boolean,
      required: true,
    },
  },
  created() {
    try {
      this._ptIcons = require.context("./ptcion", false, /\.(png|jpe?g)$/i);
    } catch (e) {
      const stub = () => "";
      stub.keys = () => [];
      this._ptIcons = stub;
    }
  },
  methods: {
    resolvePath(...paths) {
      return this.basePath + "/" + paths[0];
    },
    ptIconSrc(pt) {
      if (!pt || !this._ptIcons || typeof this._ptIcons.keys !== "function")
        return "";
      const stems = PT_ICON_STEM[pt] ? [pt, PT_ICON_STEM[pt]] : [pt];
      const seen = new Set();
      for (const stem of stems) {
        if (seen.has(stem)) continue;
        seen.add(stem);
        for (const name of [
          `./${stem}.png`,
          `./${stem}.jpeg`,
          `./${stem}.jpg`,
        ]) {
          if (this._ptIcons.keys().includes(name)) {
            return this._ptIcons(name);
          }
        }
      }
      return "";
    },
  },
};
</script>

<style lang="scss" scoped>
@import "@/styles/variables.scss";

.menu-wrapper {
  ::v-deep .el-submenu__title {
    height: 40px;
    line-height: 40px;
    background-color: transparent;
    color: $menuText;
    font-weight: 600;
    display: flex;
    align-items: center;
    padding-right: 12px !important;

    &:hover {
      background-color: $menuHover;
    }
  }

  ::v-deep .el-menu-item,
  .el-submenu__title {
    min-height: 36px;
    line-height: 36px;
  }

  ::v-deep .el-menu-item {
    padding: 0 16px 0 28px !important;
    color: $menuText;

    &:hover {
      background-color: $menuHover;
    }

    &.is-active {
      background-color: $menuActiveBg;
      color: $primaryColor;
    }
  }
}

.group-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  margin-right: 6px;
  color: $menuMuted;
  cursor: grab;
  font-size: 12px;
  letter-spacing: -2px;
  user-select: none;
}

.group-drag-handle:active {
  cursor: grabbing;
}

.group-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-menu-item {
  display: flex;
  align-items: center;
}

.pt-icon {
  width: 18px;
  height: 18px;
  margin-right: 8px;
  vertical-align: middle;
  object-fit: contain;
  flex-shrink: 0;
}
</style>
