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
        <el-tag v-if="isXhsPlatform && useRealBrowser" size="mini" type="success"
          >真实浏览器</el-tag
        >
        <el-tag v-else-if="defaultPublishToDraft" size="mini" type="warning"
          >默认草稿</el-tag
        >
      </div>
      <!-- 小红书平台：使用真实浏览器开关 -->
      <template v-if="isXhsPlatform">
        <p class="section-tip">
          开启后将使用本机安装的 Chrome 浏览器代替内置窗口进行发布，从根源上避免小红书 AI 自动化检测。
        </p>
        <el-form label-width="120px" class="form-block">
          <el-form-item label="使用真实浏览器">
            <el-switch
              v-model="useRealBrowser"
              active-text="开启"
              inactive-text="关闭"
              @change="onUseRealBrowserChange"
            />
          </el-form-item>

          <!-- Chrome 浏览器配置（开启真实浏览器后显示） -->
          <template v-if="useRealBrowser">
            <el-form-item label="选择浏览器">
              <div class="chrome-path-row">
                <div v-if="chromeDisplayName" class="chrome-selected-app">
                  <span class="chrome-app-name">{{ chromeDisplayName }}</span>
                  <el-button size="mini" type="text" @click="browseChromePath">更换</el-button>
                </div>
                <el-button v-else size="small" icon="el-icon-folder-opened" @click="browseChromePath">
                  选择 Chrome 浏览器
                </el-button>
                <el-button size="small" type="info" plain @click="autoDetectChrome">自动检测</el-button>
                <el-button
                  v-if="chromePath"
                  size="small"
                  type="success"
                  plain
                  :loading="testingChrome"
                  @click="testChromeConnection"
                >
                  测试连接
                </el-button>
              </div>
              <div v-if="chromeTestResult" class="chrome-test-row">
                <span class="chrome-test-result" :class="chromeTestResult.ok ? 'test-ok' : 'test-fail'">
                  {{ chromeTestResult.ok ? '✅ 连接成功 ' + (chromeTestResult.version || '') : '❌ ' + chromeTestResult.error }}
                </span>
              </div>
              <p v-if="chromePath" class="chrome-path-detail">{{ chromePath }}</p>
            </el-form-item>
            <el-form-item>
              <p class="section-tip" style="margin: 0; font-size: 12px; color: #909399;">
                点击「自动检测」自动查找本机浏览器，或手动「选择」应用程序。配置后建议「测试连接」确认可用。
              </p>
            </el-form-item>
          </template>

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
      </template>
      <!-- 其他平台：默认发布到草稿 -->
      <template v-else>
        <p class="section-tip">开启后，该账号在视频发布时会优先保存到草稿。</p>
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
      </template>
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
import { ipcRenderer } from "electron";
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
import { isXhsPlatform } from "../../../shared/xhsPublishPolicy.js";

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
      useRealBrowser: false,
      savingPublishSettings: false,
      // Chrome 路径配置
      chromePath: "",
      chromeDisplayName: "",
      testingChrome: false,
      chromeTestResult: null,
    };
  },

  computed: {
    isXhsPlatform() {
      return isXhsPlatform(this.title);
    },
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
      this.useRealBrowser = settings.useRealBrowser;
      this.chromeTestResult = null;
      // 异步加载全局 Chrome 路径配置
      ipcRenderer.invoke("chrome:getPath").then((res) => {
        this.chromePath = (res && res.path) || "";
        this.chromeDisplayName = (res && res.displayName) || "";
      }).catch(() => {});
    },
    async savePublishSettings() {
      if (!this.urldata.id || !this.urldata.date) {
        this.$message.error("账号记录缺少 id/date，无法保存发布设置");
        return;
      }
      // 开启真实浏览器时，必须先配置并测试 Chrome 路径
      if (this.useRealBrowser && !this.chromePath) {
        this.$message.warning("请先配置 Chrome 浏览器路径");
        return;
      }
      this.savingPublishSettings = true;
      try {
        // 保存全局 Chrome 路径（所有账号共用）
        if (this.chromePath) {
          await ipcRenderer.invoke("chrome:setPath", this.chromePath);
        }
        const settings = normalizeAccountPublishSettings({
          defaultPublishToDraft: this.defaultPublishToDraft,
          useRealBrowser: this.useRealBrowser,
        });
        const res = await dataRequest({
          type: "update",
          fileName: "account",
          item: {
            id: this.urldata.id,
            date: this.urldata.date,
            defaultPublishToDraft: settings.defaultPublishToDraft,
            useRealBrowser: settings.useRealBrowser,
          },
        });
        if (!res || res.success === false) {
          this.$message.error((res && res.message) || "保存发布设置失败");
          return;
        }
        this.defaultPublishToDraft = settings.defaultPublishToDraft;
        this.useRealBrowser = settings.useRealBrowser;
        this.urldata = {
          ...this.urldata,
          defaultPublishToDraft: settings.defaultPublishToDraft,
          useRealBrowser: settings.useRealBrowser,
        };
        this.$route.meta.defaultPublishToDraft = settings.defaultPublishToDraft;
        this.$route.meta.useRealBrowser = settings.useRealBrowser;
        this.syncAccountTreePublishSettings(settings.defaultPublishToDraft, settings.useRealBrowser);
        this.$message.success("发布设置已保存");
      } catch (e) {
        this.$message.error(
          "保存发布设置失败：" + (e && e.message ? e.message : e)
        );
      } finally {
        this.savingPublishSettings = false;
      }
    },
    syncAccountTreePublishSettings(defaultPublishToDraft, useRealBrowser) {
      try {
        const raw = localStorage.getItem("accountTree");
        const tree = raw ? JSON.parse(raw) : {};
        const nextTree = updateAccountTreePublishSettings(tree, {
          phone: this.urldata.phone,
          pt: this.title,
          defaultPublishToDraft,
          useRealBrowser,
        });
        localStorage.setItem("accountTree", JSON.stringify(nextTree));
      } catch (e) {
        console.warn("同步账号树发布设置失败:", e && e.message);
      }
    },

    // ── Chrome 浏览器配置 ──────────────────────────────────────
    /** 开启真实浏览器开关时，自动检测 Chrome 路径（仅当尚未配置时） */
    async onUseRealBrowserChange(enabled) {
      if (enabled && !this.chromePath) {
        await this.autoDetectChrome();
      }
    },
    _setChromeResult(res) {
      if (!res) return;
      this.chromePath = res.path || "";
      this.chromeDisplayName = res.displayName || "";
      this.chromeTestResult = null;
    },
    async browseChromePath() {
      try {
        const result = await ipcRenderer.invoke("chrome:browse");
        if (result && result.path) {
          if (result.error) {
            this.$message.warning(result.error);
          }
          this._setChromeResult(result);
        }
      } catch (e) {
        this.$message.error("选择失败: " + (e.message || e));
      }
    },
    async autoDetectChrome() {
      try {
        const result = await ipcRenderer.invoke("chrome:autoDetect");
        if (result && result.path) {
          this._setChromeResult(result);
          this.$message.success("已检测到: " + (result.displayName || result.path));
        } else {
          this.$message.warning("未能自动检测到 Chrome，请手动选择应用程序");
        }
      } catch (e) {
        this.$message.error("自动检测失败: " + (e.message || e));
      }
    },
    async testChromeConnection() {
      if (!this.chromePath) {
        this.$message.warning("请先选择 Chrome 浏览器");
        return;
      }
      this.testingChrome = true;
      this.chromeTestResult = null;
      try {
        const result = await ipcRenderer.invoke("chrome:test", this.chromePath);
        this.chromeTestResult = result;
        if (result.ok) {
          this.$message.success("Chrome 连接成功: " + (result.version || ""));
        } else {
          this.$message.error("连接失败: " + result.error);
        }
      } catch (e) {
        this.chromeTestResult = { ok: false, error: e.message || String(e) };
        this.$message.error("测试失败: " + (e.message || e));
      } finally {
        this.testingChrome = false;
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

.chrome-path-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.chrome-selected-app {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 4px;
}
.chrome-app-name {
  font-weight: 500;
  color: #67c23a;
  font-size: 14px;
}
.chrome-path-detail {
  margin: 6px 0 0;
  font-size: 11px;
  color: #c0c4cc;
  word-break: break-all;
}
.chrome-test-row {
  margin-top: 8px;
}
.chrome-test-result {
  font-size: 13px;
}
.chrome-test-result.test-ok {
  color: #67c23a;
}
.chrome-test-result.test-fail {
  color: #f56c6c;
}
</style>
