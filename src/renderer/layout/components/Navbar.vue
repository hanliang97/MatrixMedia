<template>
  <div class="navbar-header-fixed">
    <div class="top-right">
      <el-menu
        class="main-nav flex1"
        :default-active="activeIndex"
        mode="horizontal"
        @select="selectFn"
      >
        <el-menu-item index="/">项目详情</el-menu-item>
        <el-menu-item index="/video-manager">视频管理</el-menu-item>
        <el-menu-item :index="mediaMenuItemIndex">媒体平台管理</el-menu-item>
      </el-menu>
      <div class="account-actions">
        <el-button type="primary" size="small" @click="showDialog = true">
          添加媒体账号
        </el-button>
      </div>
    </div>
    <el-dialog
      :visible.sync="showDialog"
      title="添加媒体账号"
      width="560px"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      custom-class="add-account-dialog"
    >
      <el-form ref="form" :model="pushData" label-width="88px">
        <el-form-item label="分组">
          <el-input
            v-model="pushData.phone"
            placeholder="可填写手机号、团队名或任意便于识别的名称"
          />
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="pushData.pt" placeholder="请选择平台">
            <el-option
              v-for="(val, key) in ptConfig"
              :key="key"
              :value="key"
              :label="key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <div class="tips-content">
            新增账号后，建议先到对应平台上传页走一遍流程并取消上传，部分平台会有新手引导需要手动关闭。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" @click="addAccount">新增</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
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
      getAccoutIndex: "",
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
    "$route.path"(path) {
      this.applyIsRouteFromPath(path);
      this.syncActiveIndexToCurrentRoute();
    },
  },
  methods: {
    refreshAccountMenuIndex() {
      const hit = this.$router
        .getRoutes()
        .find(
          (r) =>
            typeof r.path === "string" && r.path.startsWith("/accountManager")
        );
      this.getAccoutIndex = hit ? hit.path : "";
    },
    applyIsRouteFromPath(pathStr) {
      const parts = (pathStr || "").split("/").filter(Boolean);
      if (parts.length === 0) {
        useAppStore().setData("isRoute", "/");
        return;
      }
      if (parts[0] === "accountManager") {
        useAppStore().setData("isRoute", "accountManager");
        return;
      }
      useAppStore().setData("isRoute", "/");
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
      if (!String(this.pushData.phone || "").trim()) {
        this.$message.warning("请填写分组名称");
        return;
      }
      if (!this.pushData.pt) {
        this.$message.warning("请选择平台");
        return;
      }
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

        usePermissionStore()
          .GenerateRoutes()
          .then(() => {
            setTimeout(() => {
              this.refreshAccountMenuIndex();
              const accountRoutes = this.$router
                .getRoutes()
                .filter(
                  (route) =>
                    typeof route.path === "string" &&
                    route.path.startsWith("/accountManager")
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
    },
  },
};
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
@import "@/styles/variables.scss";

.navbar-header-fixed {
  transition: width 0.28s;
  width: 100%;
  display: flex;
  align-items: center;
  z-index: 1002;
  height: $shellHeaderHeight;
  border-bottom: 1px solid $borderColor;
  background-color: #ffffff;
  flex-shrink: 0;

  .top-right {
    display: flex;
    width: 100%;
    height: 100%;
    background-color: #ffffff;
    justify-content: space-between;
    align-items: center;
    padding-right: 20px;
  }

  .main-nav {
    border-bottom: none;
    background-color: transparent;

    ::v-deep .el-menu-item {
      height: $shellHeaderHeight;
      line-height: $shellHeaderHeight;
      color: $menuText;
      border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;

      &:hover {
        color: $primaryColor;
        background-color: transparent;
      }

      &.is-active {
        color: $primaryColor;
        border-bottom-color: $primaryColor;
        background-color: transparent;
      }
    }
  }

  .account-actions {
    display: flex;
    align-items: center;
    margin-left: 16px;
    flex-shrink: 0;
  }
}

.tips-content {
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
  padding: 10px 12px;
  background-color: #f4f4f5;
  border-radius: 4px;
}
</style>
