<template>
  <div>
    <el-dialog
      title="填写文章内容"
      :close-on-click-modal="false"
      :visible.sync="metaVisible"
      :close-on-press-escape="false"
      width="800px"
      @close="handleMetaClose"
    >
      <el-form label-width="96px" class="meta-form">
        <el-form-item label="文章标题">
          <el-input v-model="form.title" placeholder="请输入文章标题" />
        </el-form-item>
        <el-form-item label="正文">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            placeholder="请输入正文，或选择 .md/.txt 文章文件"
          />
        </el-form-item>
        <el-form-item label="文章文件">
          <el-button size="mini" @click="selectArticleFile"
            >选择 .md/.txt 文件</el-button
          >
          <span v-if="articleFilePath" class="file-name">{{
            articleFileName
          }}</span>
        </el-form-item>
        <el-form-item label="封面图片">
          <el-button size="mini" @click="selectCoverImage"
            >选择封面图片</el-button
          >
          <span v-if="coverPath" class="file-name">{{ coverFileName }}</span>
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="form.category" placeholder="默认 前端" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="tags"
            multiple
            filterable
            allow-create
            default-first-option
            no-data-text="请输入标签"
            placeholder="输入标签，回车添加为条目"
            style="width: 100%"
          ></el-select>
        </el-form-item>
        <el-form-item label="摘要">
          <el-input
            v-model="form.summary"
            type="textarea"
            :rows="3"
            placeholder="选填"
          />
        </el-form-item>
        <el-form-item label="定时发布">
          <el-switch
            v-model="scheduledPublish"
            active-text="定时"
            inactive-text="立即"
          />
        </el-form-item>
        <el-form-item v-if="scheduledPublish" label="发布时间">
          <el-date-picker
            v-model="publishAt"
            type="datetime"
            value-format="yyyy-MM-dd HH:mm:ss"
            placeholder="选择年月日时分秒"
            style="width: 260px"
          />
          <p class="form-tip">
            定时任务会立即进入发布历史，到点后自动发布；如果程序关闭错过时间，会显示任务过期。
          </p>
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button @click="metaVisible = false">取消</el-button>
        <el-button type="primary" @click="onMetaNext">下一步</el-button>
      </div>
    </el-dialog>

    <el-dialog
      title="选择掘金账号并发布"
      :close-on-click-modal="false"
      :visible.sync="platformVisible"
      :close-on-press-escape="false"
      width="800px"
      @close="handlePlatformClose"
    >
      <el-form class="article-form">
        <el-form-item label="是否显示自动化发布过程">
          <el-switch
            v-model="thisShow"
            active-text="显示"
            inactive-text="不显示"
          />
        </el-form-item>
        <el-form-item v-if="thisShow" label="发布完是否关闭窗口">
          <el-switch
            v-model="closeWindow"
            active-text="关闭"
            inactive-text="不关闭"
          />
        </el-form-item>
      </el-form>

      <el-divider content-position="left">掘金账号选择</el-divider>

      <el-tree
        v-if="treeData.length > 0"
        ref="tree"
        :data="treeData"
        node-key="id"
        show-checkbox
        default-expand-all
        :props="defaultProps"
      >
        <span class="custom-tree-node" slot-scope="{ data }">
          <template v-if="!data.url">
            <span>{{ data.title }}</span>
            <el-button
              size="mini"
              type="text"
              class="verify-button"
              @click.stop="verifyLogin(data)"
              >验证登录</el-button
            >
          </template>
          <template v-else>
            <span>{{ data.pt }}</span>
            <span
              class="login-state"
              :style="{ color: data.loggedIn ? 'green' : 'red' }"
            >
              <span v-if="data.loggedIn" class="login-ok" @click="reLogin(data)"
                >登录√</span
              >
              <span v-else @click="reLogin(data)">❌重新登录</span>
            </span>
          </template>
        </span>
      </el-tree>
      <el-empty
        v-if="treeData.length === 0"
        description="请先添加掘金平台账号"
      />

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

function formatTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .join(" ");
}

export default {
  name: "LocalArticlePublish",
  data() {
    return {
      ptConfig,
      metaVisible: false,
      platformVisible: false,
      articleFilePath: "",
      coverPath: "",
      form: {
        title: "",
        content: "",
        category: "前端",
        summary: "",
      },
      tags: ["前端", "electron"],
      thisShow: false,
      closeWindow: true,
      scheduledPublish: false,
      publishAt: "",
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
    articleFileName() {
      return fileBaseName(this.articleFilePath);
    },
    coverFileName() {
      return fileBaseName(this.coverPath);
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
    open() {
      this.resetState();
      this.metaVisible = true;
    },

    async selectArticleFile() {
      const path = await ipcRenderer.invoke("dialog:openArticleFile");
      if (!path) return;
      this.articleFilePath = path;
      if (!this.form.title || !this.form.title.trim()) {
        this.form.title = fileStem(path);
      }
    },

    async selectCoverImage() {
      const path = await ipcRenderer.invoke("dialog:openImageFile");
      if (path) {
        this.coverPath = path;
      }
    },

    buildArticlePayload() {
      const title = this.form.title.trim();
      return {
        bookName: title,
        textType: "article",
        data: {
          title,
          content: this.form.content,
          articleFilePath: this.articleFilePath,
          coverPath: this.coverPath,
          category: this.form.category.trim() || "前端",
          tags: formatTags(this.tags),
          summary: this.form.summary.trim(),
        },
        textOtherName: title,
        selectedFile: fileBaseName(this.articleFilePath),
      };
    },

    validateArticleMeta() {
      if (!this.form.title || !this.form.title.trim()) {
        return "请填写文章标题";
      }
      if (
        (!this.form.content || !this.form.content.trim()) &&
        !this.articleFilePath
      ) {
        return "请填写正文或选择文章文件";
      }
      return this.validatePublishAt();
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

    onMetaNext() {
      const error = this.validateArticleMeta();
      if (error) {
        this.$message.warning(error);
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
      this.articleFilePath = "";
      this.coverPath = "";
      this.form = {
        title: "",
        content: "",
        category: "前端",
        summary: "",
      };
      this.tags = ["前端", "electron"];
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.showLoginDialog = false;
      this.loginData = {};
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
      return Object.keys(rawTree)
        .map((phone) => {
          const node = rawTree[phone] || {};
          const children = (node.children || [])
            .filter(
              (child) =>
                child &&
                child.meta &&
                String(child.meta.pt || "").trim() === "掘金"
            )
            .map((child) => {
              const phoneText = child.meta.phone.split("-")[0];
              const flagName = `${phoneText}${child.meta.pt}登录`;
              return {
                id: child.meta.id,
                pt: child.meta.pt,
                phone: phoneText,
                date: child.meta.date,
                url: child.meta.url,
                loggedIn: (() => {
                  if (isAccountLoginFlagSet(flagName)) return true;
                  const cookies = document.cookie.split(";");
                  for (const c of cookies) {
                    const [key, value] = c.trim().split("=");
                    if (key == flagName && value == "true") return true;
                  }
                  return false;
                })(),
              };
            });
          return {
            id: phone,
            title: phone,
            children,
          };
        })
        .filter((group) => group.children.length > 0);
    },

    verifyLogin(parent) {
      const children = parent.children || [];
      children.forEach((child) => {
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
      this.taskHandlers.set(taskId, (data) => {
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
          console.error(
            `[${i.phone.split("-")[0]}${i.pt}] 登录状态失败:`,
            data.error
          );
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
      this.loginData = {
        ...item,
        partition: "persist:" + item.phone.split("-")[0] + item.pt,
      };
      this.showLoginDialog = true;
    },

    buildPushRecord(article, p, partition, currentDate, extra = {}) {
      return {
        bookName: article.bookName,
        textOtherName: article.textOtherName,
        textType: "article",
        pt: p.pt,
        selectedFile: article.selectedFile,
        bt: article.data.title,
        bq: article.data.tags,
        content: article.data.content,
        articleFilePath: article.data.articleFilePath,
        coverPath: article.data.coverPath,
        category: article.data.category,
        summary: article.data.summary,
        useragent: this.ptConfig[p.pt].useragent,
        phone: p.phone,
        partition,
        url: this.ptConfig[p.pt].listIndex,
        uploadUrl: this.ptConfig[p.pt].upload,
        date: currentDate,
        publishMode: "publish",
        publishAttemptCount: 1,
        republishCount: 0,
        publishSuccessCount: 0,
        publishFailCount: 0,
        publishStatus: "publishing",
        lastPublishMessage: "等待发布结果",
        lastPublishAt: Date.now(),
        ...extra,
      };
    },

    async handleBatchPublish() {
      const error = this.validateArticleMeta();
      if (error) {
        this.$message.warning(error);
        return;
      }
      const checked = this.$refs.tree ? this.$refs.tree.getCheckedNodes(true) : [];
      const platforms = checked.filter(
        (item) => item.url && String(item.pt || "").trim() === "掘金"
      );
      if (platforms.length === 0) {
        this.$message.warning("请选择掘金账号");
        return;
      }

      const article = this.buildArticlePayload();
      const currentDate = moment().format("YYYY-MM-DD");
      const scheduledAtText = String(this.publishAt || "").trim();
      const scheduledAtMs = this.scheduledPublish
        ? moment(scheduledAtText, "YYYY-MM-DD HH:mm:ss", true).valueOf()
        : null;
      const scheduledWritePromises = [];

      for (let p of platforms) {
        const partition = "persist:" + p.phone.split("-")[0] + p.pt;
        const taskId = Date.now() + Math.random();
        const shouldShow = this.thisShow;
        const shouldCloseWindowAfterPublish = shouldShow
          ? this.closeWindow
          : true;

        if (this.scheduledPublish) {
          scheduledWritePromises.push(
            dataRequest({
              type: "add",
              fileName: "pushData",
              item: this.buildPushRecord(article, p, partition, currentDate, {
                scheduledTask: true,
                scheduledPublishAt: scheduledAtMs,
                scheduledPublishAtText: scheduledAtText,
                publishStatus: "scheduled",
                lastPublishMessage: "等待定时发布",
              }),
            })
          );
          continue;
        }

        ipcRenderer.send("puppeteerFile", {
          ...p,
          taskId,
          ...article,
          publishMode: "publish",
          url: this.ptConfig[p.pt].upload,
          show: shouldShow,
          closeWindowAfterPublish: shouldCloseWindowAfterPublish,
          useragent: this.ptConfig[p.pt].useragent,
          partition,
          date: currentDate,
        });

        dataRequest({
          type: "add",
          fileName: "pushData",
          item: this.buildPushRecord(article, p, partition, currentDate),
        });
      }

      if (this.scheduledPublish) {
        await Promise.all(scheduledWritePromises);
        ipcRenderer.send("scheduledPublish:refresh");
      }
      const successMessage = this.scheduledPublish
        ? `已创建 ${platforms.length} 个掘金账号定时发布任务`
        : `已提交 ${platforms.length} 个掘金账号发布`;
      this.$message.success(successMessage);
      this.platformVisible = false;
      this.resetState();
      this.$emit("published");
    },
  },
};
</script>

<style scoped>
.meta-form {
  margin-bottom: 8px;
}

.file-name {
  display: inline-block;
  margin-left: 10px;
  color: #606266;
  word-break: break-all;
}

.form-tip {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}

.article-form {
  margin-bottom: 16px;
}

.custom-tree-node {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
}

.verify-button,
.login-state {
  margin-left: 5px;
}

.login-ok {
  padding-left: 10px;
  cursor: pointer;
}
</style>
