<template>
  <div
    v-if="!item.hidden && item.children && item.children.length"
    class="menu-wrapper"
    :class="collapse ? `` : `active-menu-wrapper`"
  >
    <el-submenu :index="String(item.name || item.path)">
      <template slot="title">
        <svg-icon
          v-if="item.meta && item.meta.icon"
          :icon-class="item.meta.icon"
        ></svg-icon>
        <span
          v-if="item.meta && item.meta.title"
          slot="title"
          >{{ item.meta.title }}</span
        >
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
        ></sidebar-item>

        <router-link
          v-else-if="!child.hidden"
          :key="'leaf-' + (child.name || child.path)"
          :to="resolvePath(child.path)"
        >
          <el-menu-item
            style="display: flex; align-items: center"
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
            ></svg-icon>
            <span
              v-if="child.meta && child.meta.title"
              slot="title"
              >{{ child.meta.title }}</span
            >
          </el-menu-item>
        </router-link>
      </template>
    </el-submenu>
  </div>
</template>

<script>
const PT_ICON_STEM = {
  抖音: 'dy',
  视频号: 'sph',
  哔哩哔哩: 'blbl',
  百家号: 'bjh',
  头条: 'tt',
  快手: 'ks',
  小红书: 'xhs'
}

export default {
  name: 'SidebarItem',
  props: {
    item: {
      type: Object,
      required: true
    },
    isNest: {
      type: Boolean,
      default: false
    },
    basePath: {
      type: String,
      default: ''
    },
    collapse: {
      type: Boolean,
      required: true
    }
  },
  created() {
    try {
      this._ptIcons = require.context('./ptcion', false, /\.(png|jpe?g)$/i)
    } catch (e) {
      const stub = () => ''
      stub.keys = () => []
      this._ptIcons = stub
    }
  },
  methods: {
    resolvePath(...paths) {
      return this.basePath + '/' + paths[0]
    },
    ptIconSrc(pt) {
      if (!pt || !this._ptIcons || typeof this._ptIcons.keys !== 'function')
        return ''
      const stems = PT_ICON_STEM[pt] ? [pt, PT_ICON_STEM[pt]] : [pt]
      const seen = new Set()
      for (const stem of stems) {
        if (seen.has(stem)) continue
        seen.add(stem)
        for (const name of [
          `./${stem}.png`,
          `./${stem}.jpeg`,
          `./${stem}.jpg`
        ]) {
          if (this._ptIcons.keys().includes(name)) {
            return this._ptIcons(name)
          }
        }
      }
      return ''
    }
  }
}
</script>
<style lang="scss" scoped>
.menu-wrapper {
  ::v-deep .el-submenu__title {
    height: 35px;
    line-height: 35px;
    background-color: #545c64;
    color: #fff;
  }
  ::v-deep .el-menu-item,
  .el-submenu__title {
    height: 30px;
    line-height: 30px;
  }

  ::v-deep .el-menu-item {
    padding: 0 10px 0 5px;
  }
}

.pt-icon {
  width: 18px;
  height: 18px;
  margin-right: 6px;
  vertical-align: middle;
  object-fit: contain;
}
</style>
