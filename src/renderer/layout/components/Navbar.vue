<template>
  <div class="navbar-header-fixed">
    <div class="top-right">
      <el-menu class="flex1" :default-active="activeIndex" mode="horizontal" @select="selectFn">
        <el-menu-item index="/" >视频管理</el-menu-item>
        <el-menu-item :index="mediaMenuItemIndex">媒体平台管理</el-menu-item>
      </el-menu>
      <div  class="account-actions">
        <el-button type="primary" size="small" @click="showDialog = true">
          添加媒体账号
        </el-button>
      </div>
    </div>
    <el-dialog :visible.sync="showDialog" title="添加账号" width="500px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form ref="form" :model="pushData" label-width="80px">
        <el-form-item label="手机号码">
          <el-input v-model="pushData.phone" placeholder="请输入手机号码"></el-input>
        </el-form-item>
        <el-form-item label="选择平台">
          <el-select v-model="pushData.pt" placeholder="请选择平台">
            <el-option v-for="(val, key) in ptConfig" :key="key" :value="key">{{ key }}</el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="addAccount">新增</el-button>
        <el-button @click="showDialog = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script >
import { useAppStore } from "@/store/app";
import dataRequest from "@/utils/dataRequest";
import ptConfig from "@/utils/configUrl";
import { usePermissionStore } from "@/store/permission";

const MEDIA_MENU_NO_ACCOUNT = "__media_no_account__";

export default {
  name: "Navbar",
  data() {
    return {
      activeIndex: "/",
      getAccoutIndex:'',
      ptConfig,
      showDialog: false,
      pushData: {
        phone: "",
        pt: "",
        url: "",
      },
    };
  },
  computed: {
    isAccountManager() {
      return this.$route.path.indexOf('/accountManager') !== -1;
    },
    mediaMenuItemIndex() {
      return this.getAccoutIndex || MEDIA_MENU_NO_ACCOUNT;
    },
  },
  created() {
      this.refreshAccountMenuIndex();
      this.activeIndex = this.$route.path;
      this.applyIsRouteFromPath(this.$route.path);
  },
  watch: {
    '$route.path'(path) {
      this.applyIsRouteFromPath(path);
      if (path === '/') {
        this.activeIndex = '/';
      } else if (path.startsWith('/accountManager') && this.getAccoutIndex) {
        this.activeIndex = this.getAccoutIndex;
      }
    },
  },
  methods: {
    refreshAccountMenuIndex() {
      const hit = this.$router.getRoutes().find(
        r => typeof r.path === 'string' && r.path.startsWith('/accountManager')
      );
      if (hit) {
        this.getAccoutIndex = hit.path;
      } else {
        this.getAccoutIndex = "";
      }
    },
    applyIsRouteFromPath(pathStr) {
      const parts = (pathStr || '').split('/').filter(Boolean);
      if (parts.length === 0) {
        useAppStore().setData('isRoute', '/');
        return;
      }
      if (parts[0] === 'accountManager') {
        useAppStore().setData('isRoute', 'accountManager');
        return;
      }
      useAppStore().setData('isRoute', '/');
    },
    syncActiveIndexToCurrentRoute() {
      const p = this.$route.path;
      if (p === "/") {
        this.activeIndex = "/";
      } else if (p.startsWith("/accountManager") && this.getAccoutIndex) {
        this.activeIndex = this.getAccoutIndex;
      } else {
        this.activeIndex = p;
      }
    },
    selectFn(index) {
      if (index === MEDIA_MENU_NO_ACCOUNT) {
        this.showDialog = true;
        this.syncActiveIndexToCurrentRoute();
        return;
      }
      this.activeIndex = index;
      if (index !== this.$route.path) {
        this.$router.push(index).catch(() => {});
      }
      this.applyIsRouteFromPath(index);
    },
    addAccount() {
      dataRequest({
        type: "add",
        fileName: "account",
        item: { ...this.pushData, url: this.ptConfig[this.pushData.pt].index },
      }).then(() => {
        this.$message({
          type: "success",
          message: "添加成功!",
        });
        
        this.showDialog = false;
        this.pushData = {
          phone: "",
          pt: "",
          url: "",
        };
        
        usePermissionStore().GenerateRoutes().then(() => {
          setTimeout(() => {
            this.refreshAccountMenuIndex();
            const accountRoutes = this.$router.getRoutes().filter(route =>
              typeof route.path === 'string' && route.path.startsWith('/accountManager')
            );
            if (accountRoutes.length > 0) {
              const targetPath = accountRoutes[0].path;
              if (this.$route.path !== targetPath) {
                this.$router.push(targetPath);
              }
              this.applyIsRouteFromPath(targetPath);
              if (this.getAccoutIndex) {
                this.activeIndex = this.getAccoutIndex;
              }
            }
          }, 200);
        });
      });
    }
  },
};
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
.navbar-header-fixed {
  transition: width 0.28s;
  width: 100%;
  display: flex;
  align-items: center;
  z-index: 1002;
  height: 62px;

  .hamburger-container {
    line-height: 58px;
    height: 50px;
    float: left;
    padding: 0 10px;
  }

  .logo {
    width: 199px;
    height: 62px;
  }

  .top-right {
    display: flex;
    width: 100%;
    height: 100%;
    background-color: #ffffff;
    justify-content: space-between;
    padding-right: 19px;

    .hb-bd {
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .avatar {
      width: 30px;
      height: 30px;
      margin-right: 10px;

      ::v-deep img {
        width: 100%;
        height: 100%;
        border-radius: 50%;
      }
    }

    .top-select {
      display: flex;
      align-items: center;

      .go-index {
        color: #333333;
        font-weight: 400;
        margin-right: 20px;
        padding-right: 20px;
        border-right: 1px solid #cccccc;
      }

      .select-right ::v-deep .el-dropdown > span {
        font-size: 6px;
      }

      .select-right {
        .el-dropdown-link {
          color: #333333;
          font-weight: 400;
        }

        ::v-deep .el-dropdown-selfdefine {
          display: flex;
          align-items: center;
        }
      }
    }

    .account-actions {
      display: flex;
      align-items: center;
    }
  }
}

.dragTitle {
  -webkit-app-region: drag;
}
</style>
