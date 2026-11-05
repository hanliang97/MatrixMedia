<template>
  <div class="navbar-header-fixed">
    <div class="top-right">
      <el-menu
        class="main-nav flex1"
        :default-active="activeIndex"
        mode="horizontal"
        @select="selectFn"
      >
        <el-menu-item index="/data-stats">账号数据</el-menu-item>
        <el-menu-item index="/video-manager">视频管理</el-menu-item>
        <el-menu-item :index="mediaMenuItemIndex">媒体平台管理</el-menu-item>
        <el-menu-item index="/project-detail">项目详情</el-menu-item>
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
          <el-select
            ref="groupSelect"
            v-model="pushData.phone"
            filterable
            allow-create
            default-first-option
            clearable
            placeholder="选择已有分组，或输入后回车新增"
            no-data-text="输入分组名称后回车新增"
            style="width: 100%"
          >
            <el-option
              v-for="name in groupOptions"
              :key="name"
              :label="name"
              :value="name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="账号名称">
          <el-input
            v-model="pushData.accountName"
            placeholder="选填，默认与分组同名"
            maxlength="50"
          />
          <div class="tips-content" style="margin-top: 4px">
            同一分组可添加多个同平台账号（用不同账号名称区分）；同一平台账号在多个分组请保持名称一致，登录态自动共享、不会互相挤掉线。
          </div>
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="pushData.pt" placeholder="请选择平台">
            <el-option
              v-for="item in platformOptions"
              :key="item.key"
              :value="item.key"
              :label="item.key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <div class="tips-content">
            新增账号后，建议先到对应平台上传页走一遍流程并取消上传，部分平台会有新手引导需要手动关闭。
          </div>
          <div v-if="isXhsPlatform" class="tips-content tips-danger">
            小红书风控严格，请谨慎使用小红书自动发布，容易封号。只是管理账号、手动发布暂未发现异常。
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
import {
  deriveAccountKeyFromName,
  recordAccountNameOf,
} from "../../../shared/accountIdentity.js";

const MEDIA_MENU_NO_ACCOUNT = "__media_no_account__";

export default {
  name: "Navbar",
  data() {
    return {
      activeIndex: "/",
      getAccoutIndex: "",
      ptConfig,
      showDialog: false,
      groupOptions: [],
      pushData: {
        phone: "",
        accountName: "",
        pt: "",
        url: "",
      },
    };
  },
  computed: {
    mediaMenuItemIndex() {
      return this.getAccoutIndex || MEDIA_MENU_NO_ACCOUNT;
    },
    // 是否选中了小红书平台
    isXhsPlatform() {
      return String(this.pushData.pt || "").trim() === "小红书";
    },
    platformOptions() {
      return Object.keys(this.ptConfig).map((key) => ({ key }));
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
    showDialog(open) {
      if (open) {
        this.refreshGroupOptions();
        this.pushData.accountName = "";
      }
    },
  },
  methods: {
    refreshGroupOptions() {
      try {
        const tree = JSON.parse(localStorage.getItem("accountTree") || "{}");
        this.groupOptions = Object.keys(tree).filter(Boolean);
      } catch (e) {
        this.groupOptions = [];
      }
    },
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
      if (parts[0] === "data-stats") {
        useAppStore().setData("isRoute", "dataStats");
        return;
      }
      useAppStore().setData("isRoute", "/");
    },
    syncActiveIndexToCurrentRoute() {
      const p = this.$route.path;
      if (p === "/") {
        this.activeIndex = "/";
      } else if (p.startsWith("/data-stats")) {
        this.activeIndex = "/data-stats";
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
    /**
     * 新增账号（新分组模型）：
     *   - 分组只是容器，同一分组可加多个同平台账号；
     *   - accountKey（= 账号名清洗值）是登录主键，同一平台账号跨分组同名
     *     即共享登录态（一份登录、一个出口 IP，不会互相挤掉线）；
     *   - phone 字段继续按 "分组-账号名"（同名不带后缀）写入，兼容旧版本/CLI。
     */
    addAccount() {
      const typed =
        this.$refs.groupSelect && this.$refs.groupSelect.query
          ? String(this.$refs.groupSelect.query).trim()
          : "";
      const group = String(this.pushData.phone || "").trim() || typed;
      if (!group) {
        this.$message.warning("请选择或输入分组名称");
        return;
      }
      if (!this.pushData.pt) {
        this.$message.warning("请选择平台");
        return;
      }
      const accountName =
        String(this.pushData.accountName || "").trim() || group;
      const accountKey = deriveAccountKeyFromName(accountName) || group;
      const pt = this.pushData.pt;

      const tree = this.readAccountTree();
      let duplicate = null;
      let sharedLoginGroup = "";
      Object.keys(tree).forEach((groupName) => {
        ((tree[groupName] && tree[groupName].children) || []).forEach(
          (child) => {
            const meta = (child && child.meta) || {};
            if (String(meta.pt || "") !== pt) return;
            const sameAccount = recordAccountNameOf(meta) === accountName;
            if (groupName === group && sameAccount) {
              duplicate = meta;
              return;
            }
            if (groupName !== group && sameAccount && !sharedLoginGroup) {
              sharedLoginGroup = groupName;
            }
          }
        );
      });
      if (duplicate) {
        this.$message.warning(
          `该分组下已存在同名账号「${accountName}」的 ${pt}，请更换账号名称`
        );
        return;
      }

      const doAdd = () => {
        dataRequest({
          type: "add",
          fileName: "account",
          item: {
            phone: accountName === group ? group : `${group}-${accountName}`,
            group,
            accountName,
            accountKey,
            pt,
            url: this.ptConfig[pt].index,
          },
        }).then(() => {
          if (sharedLoginGroup) {
            this.$message({
              type: "success",
              message: `添加成功！该账号已在分组「${sharedLoginGroup}」添加过，两个分组共享同一份登录态`,
              duration: 6000,
            });
          } else {
            this.$message({
              type: "success",
              message: "添加成功!",
            });
          }

          this.showDialog = false;
          this.pushData = {
            phone: "",
            accountName: "",
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
      };

      if (sharedLoginGroup) {
        this.$confirm(
          `平台账号「${accountName}」已在分组「${sharedLoginGroup}」添加过。继续添加将共享同一份登录态与代理出口（不会互相挤掉线），是否继续？`,
          "共享登录态提示",
          {
            confirmButtonText: "继续添加",
            cancelButtonText: "取消",
            type: "info",
          }
        )
          .then(doAdd)
          .catch(() => {});
        return;
      }
      doAdd();
    },
    readAccountTree() {
      try {
        return JSON.parse(localStorage.getItem("accountTree") || "{}") || {};
      } catch (e) {
        return {};
      }
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

  & + .tips-content {
    margin-top: 8px;
  }
}

// 小红书风控警告，红色显示
.tips-danger {
  color: #f56c6c;
  background-color: #fef0f0;
}

// 平台下拉选项内容铺满整行，保证禁用项整行悬停都能触发 tooltip
.platform-option-label {
  display: block;
}
</style>
