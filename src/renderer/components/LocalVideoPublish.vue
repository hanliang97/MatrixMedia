<template>
  <div>
    <el-dialog
      title="填写发布内容"
      :close-on-click-modal="false"
      :visible.sync="metaVisible"
      :close-on-press-escape="false"
      width="800px"
      @close="handleMetaClose"
    >
      <p class="file-line"><strong>已选文件：</strong>{{ displayFileName }}</p>
      <el-form label-width="88px" class="meta-form">
        <el-form-item label="名称">
          <el-input v-model="form.title" placeholder="默认与视频文件名一致，可改" />
        </el-form-item>
        <el-form-item label="视频标题">
          <el-input v-model="form.bt1" placeholder="发布时使用的标题" />
        </el-form-item>
        
        <el-form-item label="视频标签">
          <el-input v-model="form.bq" placeholder="视频标签" />
        </el-form-item>
        <el-form-item label="概括短标题">
          <el-input v-model="form.bt2" placeholder="选填，建议 6～16 字" />
          <p class="bt2-tip">
            仅<strong>微信视频号</strong>会用到本项：对应发布页「概括视频主要内容」。选择视频号时本项必填，长度需为 6～16 字，且不能包含特殊标点符号。
          </p>
        </el-form-item>
        <el-form-item label="地址"> 
          <el-input v-model="form.address" placeholder="选填" /> 
          <p class="bt2-tip">
            仅<strong>百家号</strong>会用到本项：对应发布页「地址」。其它平台忽略；若不填则不填写。
          </p> </el-form-item>
        <el-form-item label="定时发布">
          <el-switch v-model="scheduledPublish" active-text="定时" inactive-text="立即" />
        </el-form-item>
        <el-form-item v-if="scheduledPublish" label="发布时间">
          <el-date-picker
            v-model="publishAt"
            type="datetime"
            value-format="yyyy-MM-dd HH:mm:ss"
            placeholder="选择年月日时分秒"
            style="width: 260px"
          />
          <p class="bt2-tip">定时任务会立即进入发布历史，到点后自动发布；如果程序关闭错过时间，会显示任务过期。</p>
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button @click="metaVisible = false">取消</el-button>
        <el-button type="primary" @click="onMetaNext">下一步</el-button>
      </div>
    </el-dialog>

    <el-dialog
      title="选择账号并发布"
      :close-on-click-modal="false"
      :visible.sync="platformVisible"
      :close-on-press-escape="false"
      width="800px"
      @close="handlePlatformClose"
    >
      <el-form class="video-form">
        <el-form-item label="是否显示自动化发布过程">
          <el-switch v-model="thisShow" active-text="显示" inactive-text="不显示" />
        </el-form-item>
        <el-form-item v-if="thisShow" label="发布完是否关闭窗口">
          <el-switch v-model="closeWindow" active-text="关闭" inactive-text="不关闭" />
        </el-form-item>
      </el-form>

      <el-divider content-position="left">账号平台选择</el-divider>

      <el-tree v-if="treeData.length > 0" ref="tree" :data="treeData" node-key="id" show-checkbox default-expand-all :props="defaultProps">
        <span class="custom-tree-node" slot-scope="{ data }">
          <template v-if="!data.url">
            <span>{{ data.title }}</span>
            <el-button size="mini" type="text" style="margin-left: 5px" @click.stop="verifyLogin(data)">验证登录</el-button>
          </template>
          <template v-else>
            <span>{{ data.pt }}</span>
            <span style="margin-left: 5px" :style="{ color: data.loggedIn ? 'green' : 'red' }">
              <span v-if="data.loggedIn" class="login-ok" @click="reLogin(data)">登录√</span>
              <span v-else @click="reLogin(data)">❌重新登录</span>
            </span>
          </template>
        </span>
      </el-tree>
      <el-empty v-if="treeData.length === 0" description="请先在右上角添加媒体平台账号" />

      <div slot="footer" class="dialog-footer">
        <el-button @click="platformVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchPublish">发布</el-button>
      </div>

      <el-dialog
        :title="loginData.partition"
        :visible.sync="showLoginDialog"
        append-to-body
        destroy-on-close
        width="1200px"
        @close="hideLoginDialog"
      >
        <webview
          v-if="loginData.url"
          :src="loginData.url"
          style="display: flex; width: 100%; height: 650px"
          webpreferences="javascript=yes"
          :httpreferrer="loginData.url"
          nodeintegrationinsubframes
          disablewebsecurity
          allowpopups
          :partition="loginData.partition.split('-')[0]"
          :key="loginData.partition.split('-')[0]"
          :useragent="ptConfig[loginData.pt].useragent"
        />
      </el-dialog>
    </el-dialog>
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
import moment from "moment";
import dataRequest from "@/utils/dataRequest";
import ptConfig from "@/utils/configUrl";
import {
  setAccountLoginFlag,
  clearAccountLoginFlag,
  isAccountLoginFlagSet,
} from "@/utils/accountLoginFlag";

function fileBaseName(p) {
  if (!p) return "";
  const s = String(p).replace(/\\/g, "/");
  const seg = s.split("/");
  return seg[seg.length - 1] || "";
}

function fileStem(p) {
  const b = fileBaseName(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

export default {
  name: "LocalVideoPublish",
  data() {
    return {
      ptConfig,
      metaVisible: false,
      platformVisible: false,
      localFilePath: "",
      form: {
        title: "",
        bt1: "",
        bt2: "",
        bq: "",
        address: "",
      },
      thisShow: false,
      closeWindow: true,
      scheduledPublish: false,
      publishAt: "",
      republishContext: null,
      republishTextOtherName: "",
      showLoginDialog: false,
      loginData: {},
      treeData: [],
      taskHandlers: new Map(),
      defaultProps: {
        children: "children",
        label: "title",
      },
    };
  },
  computed: {
    displayFileName() {
      return fileBaseName(this.localFilePath);
    },
  },
  mounted() {
    this._onGetCookieDone = (event, data) => {
      const { taskId } = data;
      const handler = this.taskHandlers.get(taskId);
      if (handler) {
        handler(data);
        this.taskHandlers.delete(taskId);
      }
    };
    ipcRenderer.on("getCookie-done", this._onGetCookieDone);
  },
  beforeDestroy() {
    if (this._onGetCookieDone) {
      ipcRenderer.removeListener("getCookie-done", this._onGetCookieDone);
    }
  },
  methods: {
    open(filePath) {
      if (!filePath) return;
      this.localFilePath = filePath;
      const defaultTitle = fileStem(filePath);
      this.form = { title: defaultTitle, bt1: "", bt2: "", bq: "", address: "" };
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.republishContext = null;
      this.republishTextOtherName = "";
      this.metaVisible = true;
    },
    openRepublish(payload = {}) {
      const filePath = payload.filePath || "";
      if (!filePath) {
        this.$message.warning("缺少历史视频路径，无法重发");
        return false;
      }
      this.localFilePath = filePath;
      const defaultTitle = fileStem(filePath);
      const form = payload.form || {};
      this.form = {
        title: (form.title || defaultTitle || "").trim(),
        bt1: (form.bt1 || "").trim(),
        bt2: (form.bt2 || "").trim(),
        bq: (form.bq || "").trim(),
        address: (form.address || "").trim(),
      };
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.republishTextOtherName = payload.textOtherName || fileStem(filePath);
      this.republishContext = {
        records: Array.isArray(payload.records) ? payload.records : [],
        failedTargets: Array.isArray(payload.failedTargets) ? payload.failedTargets : [],
      };
      this.metaVisible = false;
      this.loadAccounts();
      this.platformVisible = true;
      this.$nextTick(() => {
        const checkedKeys = this.resolveRepublishCheckedKeys(this.republishContext.failedTargets);
        if (this.$refs.tree) {
          this.$refs.tree.setCheckedKeys(checkedKeys);
        }
      });
      return true;
    },
    resolveRepublishCheckedKeys(failedTargets = []) {
      if (!Array.isArray(failedTargets) || failedTargets.length === 0) return [];
      const keys = [];
      const targetSet = new Set(
        failedTargets.map(v => `${String(v.pt || "").trim()}__${String(v.phone || "").split("-")[0]}`)
      );
      (this.treeData || []).forEach(group => {
        (group.children || []).forEach(child => {
          const key = `${String(child.pt || "").trim()}__${String(child.phone || "").split("-")[0]}`;
          if (targetSet.has(key)) {
            keys.push(child.id);
          }
        });
      });
      return keys;
    },
    findRepublishRecord(pt, phone) {
      if (!this.republishContext || !Array.isArray(this.republishContext.records)) return null;
      const p = String(phone || "").split("-")[0];
      return this.republishContext.records.find(
        item => String(item.pt || "") === String(pt || "") && String(item.phone || "").split("-")[0] === p
      );
    },

    defaultBookName() {
      return fileStem(this.localFilePath) || "";
    },

    buildVideoPayload() {
      const bookName = (this.form.title && this.form.title.trim()) || this.defaultBookName();
      const bt1 = this.form.bt1.trim();
      const bt2 = (this.form.bt2 && this.form.bt2.trim()) || bt1;
      return {
        bookName,
        textType: "local",
        data: {
          textOtherName: this.republishTextOtherName || fileStem(this.localFilePath),
          bt1,
          bt2,
          bq: (this.form.bq || "").trim(),
          bdText: "",
          address: this.form.address.trim(),
        },
      };
    },
    isVideohaoPlatform(platform) {
      return String((platform && platform.pt) || "").includes("视频号");
    },
    validatePublishAt() {
      if (!this.scheduledPublish) return "";
      const value = String(this.publishAt || "").trim();
      if (!value) return "请选择定时发布时间";
      const dt = moment(value, "YYYY-MM-DD HH:mm:ss", true);
      if (!dt.isValid()) return "定时发布时间格式应为 YYYY-MM-DD HH:mm:ss";
      if (!dt.isAfter(moment())) return "定时发布时间必须是未来时间";
      return "";
    },
    validateVideohaoBt2(value) {
      const bt2 = String(value || "").trim();
      if (!bt2) {
        return "发布视频号时，请填写概括短标题";
      }
      const len = Array.from(bt2).length;
      if (len < 6 || len > 16) {
        return "视频号概括短标题长度需为 6～16 字";
      }
      if (!/^[\u4e00-\u9fa5A-Za-z0-9\s]+$/.test(bt2)) {
        return "视频号概括短标题不能包含特殊标点符号";
      }
      return "";
    },

    onMetaNext() {
      if (!this.form.bt1 || !this.form.bt1.trim()) {
        this.$message.warning("请填写标题");
        return;
      }
      const publishAtError = this.validatePublishAt();
      if (publishAtError) {
        this.$message.warning(publishAtError);
        return;
      }
      this.loadAccounts();
      this.metaVisible = false;
      this.platformVisible = true;
      this.$nextTick(() => {
        if (this.$refs.tree) {
          this.$refs.tree.setCheckedKeys([]);
        }
      });
    },

    handleMetaClose() {
      if (!this.platformVisible) {
        this.resetState();
      }
    },

    handlePlatformClose() {
      if (!this.metaVisible) {
        this.resetState();
      }
    },

    resetState() {
      this.localFilePath = "";
      this.form = { title: "", bt1: "", bt2: "", bq: "", address: "" };
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.republishContext = null;
      this.republishTextOtherName = "";
    },

    loadAccounts() {
      try {
        const raw = localStorage.getItem("accountTree");
        const parsed = raw ? JSON.parse(raw) : {};
        this.treeData = this.formatAccountTree(parsed);
      } catch (e) {
        this.treeData = [];
        console.error("账号树加载失败", e);
      }
    },

    formatAccountTree(rawTree) {
      return Object.keys(rawTree).map(phone => {
        const node = rawTree[phone];
        return {
          id: phone,
          title: phone,
          children: (node.children || []).map(child => ({
            id: child.meta.id,
            pt: child.meta.pt,
            phone: child.meta.phone.split("-")[0],
            date: child.meta.date,
            url: child.meta.url,
            loggedIn: (() => {
              const name = `${child.meta.phone.split("-")[0]}${child.meta.pt}登录`;
              if (isAccountLoginFlagSet(name)) return true;
              const cookies = document.cookie.split(";");
              for (const c of cookies) {
                const [key, value] = c.trim().split("=");
                if (key == name && value == "true") return true;
              }
              return false;
            })(),
          })),
        };
      });
    },

    verifyLogin(parent) {
      const children = parent.children || [];
      children.forEach(child => {
        this.checkLoginStatus(child);
      });
    },

    checkLoginStatus(i) {
      const taskId = Date.now() + Math.random();
      const partition = "persist:" + i.phone.split("-")[0] + i.pt;
      ipcRenderer.send("getCookie", {
        taskId,
        partition,
        url: i.url,
        pt: i.pt,
        name: `${i.phone.split("-")[0]}${i.pt}登录`,
      });
      this.taskHandlers.set(taskId, data => {
        const flagName = data.flagName || `${i.phone.split("-")[0]}${i.pt}登录`;
        if (data.success) {
          if (data.result) {
            setAccountLoginFlag(flagName, data.loginExpiresAtMs);
            try {
              document.cookie = data.result;
            } catch (e) {
              /* file:// 打包页面对 document.cookie 限制严格，已用 localStorage */
            }
          } else {
            clearAccountLoginFlag(flagName);
          }
        } else {
          clearAccountLoginFlag(flagName);
          console.error(`[${i.phone.split("-")[0]}${i.pt}] 登录状态失败:`, data.error);
        }
      });
      setTimeout(() => {
        this.loadAccounts();
      }, 1000);
    },

    hideLoginDialog() {
      this.showLoginDialog = false;
      setTimeout(() => {
        this.loadAccounts();
      }, 1000);
    },

    reLogin(item) {
      this.loginData = { ...item, partition: "persist:" + item.phone.split("-")[0] + item.pt };
      this.showLoginDialog = true;
    },

    async handleBatchPublish() {
      if (!this.localFilePath) {
        this.$message.warning("未选择视频文件");
        return;
      }
      const checked = this.$refs.tree.getCheckedNodes(true);
      const platforms = checked.filter(item => item.url);
      if (platforms.length === 0) {
        this.$message.warning("请至少选择一个平台");
        return;
      }
      const hasVideohao = platforms.some(this.isVideohaoPlatform);
      if (hasVideohao) {
        const bt2Error = this.validateVideohaoBt2(this.form.bt2);
        if (bt2Error) {
          this.$message.warning(bt2Error);
          return;
        }
      }
      const publishAtError = this.validatePublishAt();
      if (publishAtError) {
        this.$message.warning(publishAtError);
        return;
      }
      const video = this.buildVideoPayload();
      const selectedFile = fileBaseName(this.localFilePath);
      const currentDate = moment().format("YYYY-MM-DD");
      const scheduledAtText = String(this.publishAt || "").trim();
      const scheduledAtMs = this.scheduledPublish ? moment(scheduledAtText, "YYYY-MM-DD HH:mm:ss", true).valueOf() : null;

      platforms.sort((a, b) => {
        if (a.pt.includes("视频号")) return -1;
        if (b.pt.includes("视频号")) return 1;
        return 0;
      });

      const hasBlbl = platforms.some(p => String(p.pt || "").includes("哔哩哔哩"));
      if (hasBlbl && !this.scheduledPublish) {
        this.$alert("哔哩哔哩发布需要手动上传封面，请在弹出的发布窗口中完成封面上传。", "封面提示", {
          confirmButtonText: "我知道了",
          type: "warning",
        });
      }

      for (let p of platforms) {
        const isBlbl = String(p.pt || "").includes("哔哩哔哩");
        const partition = "persist:" + p.phone.split("-")[0] + p.pt;
        const taskId = Date.now() + Math.random();
        const shouldShow = isBlbl ? true : this.thisShow;
        const shouldCloseWindowAfterPublish = shouldShow ? this.closeWindow : true;
        if (this.scheduledPublish) {
          dataRequest({
            type: "add",
            fileName: "pushData",
            item: {
              bookName: video.bookName,
              textOtherName: video.data.textOtherName,
              textType: video.textType,
              pt: p.pt,
              selectedFile,
              bt: video.data.bt1,
              bt2: video.data.bt2,
              bq: video.data.bq,
              address: video.data.address,
              filePath: this.localFilePath,
              useragent: this.ptConfig[p.pt].useragent,
              phone: p.phone,
              partition,
              url: this.ptConfig[p.pt].listIndex,
              uploadUrl: this.ptConfig[p.pt].upload,
              date: currentDate,
              scheduledTask: true,
              scheduledPublishAt: scheduledAtMs,
              scheduledPublishAtText: scheduledAtText,
              publishAttemptCount: 1,
              republishCount: 0,
              publishSuccessCount: 0,
              publishFailCount: 0,
              publishStatus: "scheduled",
              lastPublishMessage: "等待定时发布",
              lastPublishAt: Date.now(),
            },
          });
          continue;
        }
        ipcRenderer.send("puppeteerFile", {
          ...p,
          taskId,
          ...video,
          textOtherName: video.data.textOtherName,
          selectedFile,
          url: this.ptConfig[p.pt].upload,
          // 哔哩哔哩需要人工上传封面，强制打开窗口以便用户操作
          show: shouldShow,
          closeWindowAfterPublish: shouldCloseWindowAfterPublish,
          useragent: this.ptConfig[p.pt].useragent,
          partition,
          filePath: this.localFilePath,
          date: currentDate,
        });

        const republishRecord = this.findRepublishRecord(p.pt, p.phone);
        if (republishRecord && republishRecord.id && republishRecord.date) {
          const oldAttempt = Number(republishRecord.publishAttemptCount) || 1;
          let oldRepublish = Number(republishRecord.republishCount);
          if (!Number.isFinite(oldRepublish) || oldRepublish < 0) {
            oldRepublish = Math.max(0, oldAttempt - 1);
          }
          dataRequest({
            type: "update",
            fileName: "pushData",
            item: {
              id: republishRecord.id,
              date: republishRecord.date,
              bookName: video.bookName,
              textOtherName: video.data.textOtherName,
              selectedFile,
              bt: video.data.bt1,
              bt2: video.data.bt2,
              bq: video.data.bq,
              address: video.data.address,
              filePath: this.localFilePath,
              publishAttemptCount: oldAttempt + 1,
              republishCount: oldRepublish + 1,
              publishStatus: "publishing",
              lastPublishMessage: "等待发布结果",
              lastPublishAt: Date.now(),
            },
          });
        } else {
          dataRequest({
            type: "add",
            fileName: "pushData",
            item: {
              bookName: video.bookName,
              textOtherName: video.data.textOtherName,
              textType: video.textType,
              pt: p.pt,
              selectedFile,
              bt: video.data.bt1,
              bt2: video.data.bt2,
              bq: video.data.bq,
              address: video.data.address,
              filePath: this.localFilePath,
              useragent: this.ptConfig[p.pt].useragent,
              phone: p.phone,
              partition,
              url: this.ptConfig[p.pt].listIndex,
              date: currentDate,
              publishAttemptCount: 1,
              republishCount: 0,
              publishSuccessCount: 0,
              publishFailCount: 0,
              publishStatus: "publishing",
              lastPublishMessage: "等待发布结果",
              lastPublishAt: Date.now(),
            },
          });
        }

        if (p.pt === "视频号") {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }

      if (this.scheduledPublish) {
        ipcRenderer.send("scheduledPublish:refresh");
      }
      this.$message.success(this.scheduledPublish ? `已创建 ${platforms.length} 个平台定时发布任务` : `已提交 ${platforms.length} 个平台发布`);
      this.platformVisible = false;
      this.resetState();
      this.$emit("published");
    },
  },
};
</script>

<style scoped>
.file-line {
  margin-bottom: 16px;
  word-break: break-all;
}
.meta-form {
  margin-bottom: 8px;
}
.bt2-tip {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}
.video-form {
  margin-bottom: 16px;
}
.custom-tree-node {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
}
.login-ok {
  padding-left: 10px;
  cursor: pointer;
}
:deep(.el-dialog__body) {
  padding-top: 10px;
}
:deep(.el-tree-node.is-expanded > .el-tree-node__children) {
  display: flex;
  flex-wrap: wrap;
}
</style>
