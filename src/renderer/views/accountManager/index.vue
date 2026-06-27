<template>
  <div class="page-shell account-manager-page">
    <div class="page-header account-header">
      <div class="account-header-main">
        <h1 class="page-title">媒体平台管理</h1>
        <p class="page-desc">管理账号的平台登录、发布默认项与代理配置</p>
      </div>
      <div class="account-header-actions">
        <el-tag type="info" size="medium" class="group-tag">
          分组：{{ partition.split("-")[0] }}
        </el-tag>
        <el-tag size="medium">平台：{{ title }}</el-tag>
        <el-button type="primary" :loading="opening" @click="openLoginWindow">
          打开登录窗口
        </el-button>
        <el-button type="danger" plain @click="deleteData">删除账号</el-button>
      </div>
    </div>

    <el-card class="section-card" shadow="never">
      <div slot="header" class="card-header">
        <span>账号登录</span>
        <el-tag size="mini" type="success">独立窗口</el-tag>
      </div>
      <p class="section-muted">
        登录页：<code>{{ ptConfig[title] && ptConfig[title].index }}</code>
      </p>
    </el-card>

    <el-card class="section-card" shadow="never">
      <div slot="header" class="card-header">
        <span>发布设置</span>
        <el-tag v-if="defaultPublishToDraft" size="mini" type="warning"
          >默认草稿</el-tag
        >
      </div>
      <p class="section-tip">开启后，该账号在视频发布时会优先保存到草稿。</p>
      <p class="section-danger-tip">
        小红书谨慎使用，如果被小红书警告ai托管，建议开启默认发布到草稿。草稿不能在
        App 发布，保存草稿后需在矩媒里手动发布。
      </p>
      <el-form label-width="120px" class="form-block">
        <el-form-item label="默认发布到草稿">
          <el-switch
            v-model="defaultPublishToDraft"
            active-text="开启"
            inactive-text="关闭"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="savingPublishSettings"
            @click="savePublishSettings"
          >
            保存发布设置
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="section-card" shadow="never">
      <div slot="header" class="card-header">
        <span>发布代理</span>
        <span v-if="proxyDisplay" class="card-sub">{{ proxyDisplay }}</span>
      </div>
      <p class="section-tip">
        为该账号配置独立代理后，登录窗口与视频发布都使用第一个启用代理。支持
        <code>http://host:port</code>、<code>http://user:pass@host:port</code>、
        <code>socks5://host:port</code> 等格式。
      </p>
      <el-form label-width="88px" class="form-block proxy-form">
        <el-form-item label="代理列表">
          <div v-if="proxyList.length" class="proxy-list">
            <div
              v-for="(item, index) in proxyList"
              :key="index"
              class="proxy-row"
            >
              <el-switch
                v-model="item.enabled"
                active-text="启用"
                inactive-text="关闭"
              />
              <el-input
                v-model="item.url"
                class="proxy-input"
                placeholder="例如 http://user:pass@127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                clearable
              />
              <el-button
                type="text"
                class="proxy-remove"
                @click="removeProxy(index)"
              >
                删除
              </el-button>
            </div>
          </div>
          <el-button type="primary" plain size="small" @click="addProxy">
            添加代理配置
          </el-button>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="savingProxy"
            @click="saveProxyConfig"
          >
            保存代理配置
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script>
import ptConfig from "@/utils/configUrl";
import dataRequest from "@/utils/dataRequest";
import openLoginWindow from "@/utils/openLoginWindow";
import { usePermissionStore } from "@/store/permission";
import { useAppStore } from "@/store/app";
import {
  normalizeAccountProxy,
  getAccountProxyDisplay,
} from "../../../shared/accountProxy.js";
import {
  normalizeAccountPublishSettings,
  updateAccountTreePublishSettings,
} from "../../../shared/accountPublishSettings.js";

export default {
  data() {
    return {
      ptConfig,
      partition: "persist:",
      title: "",
      urldata: {},
      opening: false,
      proxyList: [],
      savingProxy: false,
      defaultPublishToDraft: false,
      savingPublishSettings: false,
    };
  },

  computed: {
    proxyDisplay() {
      const display = getAccountProxyDisplay({ proxies: this.proxyList });
      return display ? "当前：" + display : "";
    },
  },

  mounted() {
    this.syncRouteMeta(this.$route);
    this._autoOpenTimer = setTimeout(() => {
      this.openLoginWindow();
    }, 300);
  },
  beforeRouteUpdate(to, _from, next) {
    if (this._autoOpenTimer) clearTimeout(this._autoOpenTimer);
    this.syncRouteMeta(to);
    this._autoOpenTimer = setTimeout(() => {
      this.openLoginWindow();
    }, 300);
    next();
  },
  beforeDestroy() {
    if (this._autoOpenTimer) clearTimeout(this._autoOpenTimer);
  },
  methods: {
    syncRouteMeta(route) {
      this.partition =
        "persist:" + route.meta.phone.split("-")[0] + route.meta.title;
      this.urldata = route.meta;
      this.title = route.meta.title;
      this.loadProxyFromMeta();
      this.loadPublishSettingsFromMeta();
    },
    loadProxyFromMeta() {
      const proxy = (this.urldata && this.urldata.proxy) || {};
      const source = Array.isArray(proxy.proxies)
        ? proxy.proxies
        : proxy && (proxy.enabled || proxy.url)
        ? [proxy]
        : [];
      this.proxyList = source.map((item) => ({
        enabled: Boolean(item && item.enabled),
        url: String((item && item.url) || ""),
      }));
    },
    loadPublishSettingsFromMeta() {
      const settings = normalizeAccountPublishSettings(this.urldata || {});
      this.defaultPublishToDraft = settings.defaultPublishToDraft;
    },
    async savePublishSettings() {
      if (!this.urldata.id || !this.urldata.date) {
        this.$message.error("账号记录缺少 id/date，无法保存发布设置");
        return;
      }
      this.savingPublishSettings = true;
      try {
        const settings = normalizeAccountPublishSettings({
          defaultPublishToDraft: this.defaultPublishToDraft,
        });
        const res = await dataRequest({
          type: "update",
          fileName: "account",
          item: {
            id: this.urldata.id,
            date: this.urldata.date,
            defaultPublishToDraft: settings.defaultPublishToDraft,
          },
        });
        if (!res || res.success === false) {
          this.$message.error((res && res.message) || "保存发布设置失败");
          return;
        }
        this.defaultPublishToDraft = settings.defaultPublishToDraft;
        this.urldata = {
          ...this.urldata,
          defaultPublishToDraft: settings.defaultPublishToDraft,
        };
        this.$route.meta.defaultPublishToDraft = settings.defaultPublishToDraft;
        this.syncAccountTreePublishSettings(settings.defaultPublishToDraft);
        this.$message.success("发布设置已保存");
      } catch (e) {
        this.$message.error(
          "保存发布设置失败：" + (e && e.message ? e.message : e)
        );
      } finally {
        this.savingPublishSettings = false;
      }
    },
    syncAccountTreePublishSettings(defaultPublishToDraft) {
      try {
        const raw = localStorage.getItem("accountTree");
        const tree = raw ? JSON.parse(raw) : {};
        const nextTree = updateAccountTreePublishSettings(tree, {
          phone: this.urldata.phone,
          pt: this.title,
          defaultPublishToDraft,
        });
        localStorage.setItem("accountTree", JSON.stringify(nextTree));
      } catch (e) {
        console.warn("同步账号树发布设置失败:", e && e.message);
      }
    },
    async saveProxyConfig() {
      const normalized = normalizeAccountProxy({
        proxies: this.proxyList,
      });
      if (!normalized.ok) {
        this.$message.warning(normalized.error || "代理配置无效");
        return;
      }
      if (!this.urldata.id || !this.urldata.date) {
        this.$message.error("账号记录缺少 id/date，无法保存代理");
        return;
      }
      this.savingProxy = true;
      try {
        const res = await dataRequest({
          type: "update",
          fileName: "account",
          item: {
            id: this.urldata.id,
            date: this.urldata.date,
            proxy: normalized.value,
          },
        });
        if (!res || res.success === false) {
          this.$message.error((res && res.message) || "保存代理失败");
          return;
        }
        this.proxyList = normalized.value.proxies.map((item) => ({ ...item }));
        this.urldata = {
          ...this.urldata,
          proxy: normalized.value,
        };
        this.$route.meta.proxy = normalized.value;
        this.$message.success("代理配置已保存");
        await usePermissionStore().GenerateRoutes();
      } catch (e) {
        this.$message.error(
          "保存代理失败：" + (e && e.message ? e.message : e)
        );
      } finally {
        this.savingProxy = false;
      }
    },
    addProxy() {
      this.proxyList.push({ enabled: true, url: "" });
    },
    removeProxy(index) {
      this.proxyList.splice(index, 1);
    },
    async openLoginWindow() {
      if (!this.ptConfig[this.title]) {
        this.$message.error("未找到平台配置：" + this.title);
        return;
      }
      this.opening = true;
      try {
        const result = await openLoginWindow({
          partition: this.partition,
          url: this.ptConfig[this.title].index,
          pt: this.title,
          phone: this.urldata.phone,
        });
        if (!result || result.ok === false) {
          this.$message.error((result && result.message) || "打开登录窗口失败");
        } else if (result.reused) {
          this.$message.info("已切换到已打开的登录窗口");
        }
      } catch (e) {
        this.$message.error(
          "打开登录窗口失败：" + (e && e.message ? e.message : e)
        );
      } finally {
        this.opening = false;
      }
    },
    deleteData() {
      this.$confirm("此操作将永久删除该数据, 是否继续?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      }).then(() => {
        dataRequest({
          type: "delete",
          fileName: "account",
          item: this.urldata,
        }).then(() => {
          this.$message({
            type: "success",
            message: "删除成功!",
          });

          usePermissionStore()
            .GenerateRoutes()
            .then(() => {
              setTimeout(() => {
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
                  useAppStore().setData("isRoute", "accountManager");
                } else {
                  this.$router.push("/");
                  useAppStore().setData("isRoute", "/");
                }
              }, 200);
            });
        });
      });
    },
  },
};
</script>

<style scoped lang="scss">
.account-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.account-header-main {
  flex: 1;
  min-width: 220px;
}

.account-header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.group-tag {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
}

.section-danger-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #f56c6c;
  line-height: 1.6;
}

.section-muted {
  margin: 0;
  color: #909399;
  font-size: 12px;
}

.form-block {
  margin-top: 4px;
}

.proxy-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 10px;
}

.proxy-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.proxy-input {
  flex: 1;
  min-width: 260px;
}

.proxy-remove {
  color: #f56c6c;
}

code {
  background: #f4f4f5;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
