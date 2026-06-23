<template>
  <div class="account-manager-page">
    <div class="header">
      <el-tag type="danger" size="medium" class="phone-tag">{{
        partition.split("-")[0]
      }}</el-tag>
      <el-button type="primary" :loading="opening" @click="openLoginWindow"
        >打开登录窗口</el-button
      >
      <el-button @click="deleteData">删除账号</el-button>
    </div>

    <el-card class="tip-card" shadow="never">
      <div slot="header" class="tip-title">{{ title }} 账号登录</div>
      <p>
        本平台已切换到 <b>独立 BrowserWindow</b> 进行登录，绕开
        <code>&lt;webview&gt;</code>
        被小红书 /
        抖音等站点指纹识别（<code>websectiga</code>、<code>sec_poison_id</code>）
        导致的"反复跳登录"问题。
      </p>
      <p>使用方法：</p>
      <ol>
        <li>点击右上「打开登录窗口」 → 弹出 {{ title }} 创作者中心首页；</li>
        <li>在弹出窗口里完成扫码 / 账号登录；</li>
        <li>
          登录后可以直接关闭弹窗，登录态会落到 partition
          <code>{{ partition }}</code
          >；
        </li>
        <li>后续视频管理那边发布会复用同一份 cookie / localStorage。</li>
      </ol>
      <p class="muted">
        登录页 URL：<code>{{ ptConfig[title] && ptConfig[title].index }}</code>
      </p>
    </el-card>

    <el-card class="publish-card" shadow="never">
      <div slot="header" class="tip-title">发布设置</div>
      <p class="publish-desc">
        开启后，该账号在视频发布里无论点击「发布」还是目录批量发布，都会优先保存到草稿。
      </p>
      <el-form label-width="120px" class="publish-form">
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

    <el-card class="proxy-card" shadow="never">
      <div slot="header" class="tip-title">发布代理</div>
      <p class="proxy-desc">
        为该账号配置独立代理后，登录窗口与视频发布都会走同一出口 IP。 支持
        <code>http://host:port</code>、<code>http://user:pass@host:port</code>、
        <code>socks5://host:port</code> 等格式。
      </p>
      <el-form label-width="88px" class="proxy-form">
        <el-form-item label="启用代理">
          <el-switch
            v-model="proxyEnabled"
            active-text="启用"
            inactive-text="关闭"
          />
        </el-form-item>
        <el-form-item v-if="proxyEnabled" label="代理 URL">
          <el-input
            v-model="proxyUrl"
            placeholder="例如 http://user:pass@127.0.0.1:7890 或 socks5://127.0.0.1:1080"
            clearable
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="savingProxy"
            @click="saveProxyConfig"
          >
            保存代理配置
          </el-button>
          <span v-if="proxyDisplay" class="proxy-current"
            >当前：{{ proxyDisplay }}</span
          >
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
import { normalizeAccountPublishSettings } from "../../../shared/accountPublishSettings.js";

export default {
  data() {
    return {
      ptConfig,
      partition: "persist:",
      title: "",
      urldata: {},
      opening: false,
      proxyEnabled: false,
      proxyUrl: "",
      savingProxy: false,
      defaultPublishToDraft: false,
      savingPublishSettings: false,
    };
  },

  computed: {
    proxyDisplay() {
      if (!this.proxyEnabled || !String(this.proxyUrl || "").trim()) {
        return "";
      }
      return getAccountProxyDisplay({
        enabled: this.proxyEnabled,
        url: this.proxyUrl,
      });
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
      this.proxyEnabled = Boolean(proxy.enabled);
      this.proxyUrl = String(proxy.url || "");
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
        this.$message.success("发布设置已保存");
        await usePermissionStore().GenerateRoutes();
      } catch (e) {
        this.$message.error(
          "保存发布设置失败：" + (e && e.message ? e.message : e)
        );
      } finally {
        this.savingPublishSettings = false;
      }
    },
    async saveProxyConfig() {
      const normalized = normalizeAccountProxy({
        enabled: this.proxyEnabled,
        url: this.proxyUrl,
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
        this.proxyEnabled = normalized.value.enabled;
        this.proxyUrl = normalized.value.url;
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

<style scoped>
.account-manager-page {
  padding: 24px;
  box-sizing: border-box;
}
.account-manager-page .header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.account-manager-page .header .phone-tag {
  margin-right: 4px;
}
.account-manager-page .tip-card,
.account-manager-page .publish-card,
.account-manager-page .proxy-card {
  max-width: 760px;
  line-height: 1.8;
  margin-bottom: 16px;
}
.account-manager-page .tip-title {
  font-weight: 600;
  font-size: 15px;
}
.account-manager-page code {
  background: #f4f4f5;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
}
.account-manager-page .muted {
  color: #909399;
  font-size: 12px;
}
.account-manager-page ol {
  padding-left: 20px;
  margin: 8px 0;
}
.account-manager-page .publish-desc,
.account-manager-page .proxy-desc {
  margin: 0 0 12px;
  color: #606266;
  font-size: 13px;
}
.account-manager-page .publish-form,
.account-manager-page .proxy-form {
  margin-top: 4px;
}
.account-manager-page .proxy-current {
  margin-left: 12px;
  color: #67c23a;
  font-size: 13px;
}
</style>
