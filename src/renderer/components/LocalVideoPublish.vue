<template>
  <div>
    <el-dialog
      title="填写发布内容"
      :close-on-click-modal="false"
      :visible.sync="metaVisible"
      :close-on-press-escape="false"
      width="560px"
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
            <el-button size="mini" type="text" style="margin-left: 10px" @click.stop="verifyLogin(data)">验证登录</el-button>
          </template>
          <template v-else>
            <span>{{ data.pt }}</span>
            <span style="margin-left: 10px" :style="{ color: data.loggedIn ? 'green' : 'red' }">
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
        bq: "",
      },
      thisShow: false,
      closeWindow: true,
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
    ipcRenderer.on("getCookie-done", (event, data) => {
      const { taskId } = data;
      const handler = this.taskHandlers.get(taskId);
      if (handler) {
        handler(data);
        this.taskHandlers.delete(taskId);
      }
    });
  },
  methods: {
    open(filePath) {
      if (!filePath) return;
      this.localFilePath = filePath;
      const defaultTitle = fileStem(filePath);
      this.form = { title: defaultTitle, bt1: "", bq: "" };
      this.thisShow = false;
      this.closeWindow = true;
      this.metaVisible = true;
    },

    defaultBookName() {
      return fileStem(this.localFilePath) || "";
    },

    buildVideoPayload() {
      const bookName = (this.form.title && this.form.title.trim()) || this.defaultBookName();
      return {
        bookName,
        textType: "local",
        data: {
          textOtherName: fileStem(this.localFilePath),
          bt1: this.form.bt1.trim(),
          bt2: this.form.bt1.trim(),
          bq: (this.form.bq || "").trim(),
          bdText: "",
        },
      };
    },

    onMetaNext() {
      if (!this.form.bt1 || !this.form.bt1.trim()) {
        this.$message.warning("请填写标题");
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
      this.form = { title: "", bt1: "", bq: "" };
      this.thisShow = false;
      this.closeWindow = true;
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
              const cookies = document.cookie.split(";");
              let bool = false;
              for (const c of cookies) {
                const [key, value] = c.trim().split("=");
                if (key == name && value == "true") {
                  bool = true;
                }
              }
              return bool;
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
        if (data.success) {
          document.cookie = data.result;
        } else {
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
      const video = this.buildVideoPayload();
      const selectedFile = fileBaseName(this.localFilePath);

      const checked = this.$refs.tree.getCheckedNodes(true);
      const platforms = checked.filter(item => item.url);
      if (platforms.length === 0) {
        this.$message.warning("请至少选择一个平台");
        return;
      }

      platforms.sort((a, b) => {
        if (a.pt.includes("视频号")) return -1;
        if (b.pt.includes("视频号")) return 1;
        return 0;
      });

      for (let p of platforms) {
        const partition = "persist:" + p.phone.split("-")[0] + p.pt;
        const taskId = Date.now() + Math.random();
        ipcRenderer.send("puppeteerFile", {
          ...p,
          taskId,
          ...video,
          url: this.ptConfig[p.pt].upload,
          show: this.thisShow,
          closeWindowAfterPublish: this.thisShow ? this.closeWindow : true,
          useragent: this.ptConfig[p.pt].useragent,
          partition,
          filePath: this.localFilePath,
        });

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
            useragent: this.ptConfig[p.pt].useragent,
            phone: p.phone,
            partition,
            url: this.ptConfig[p.pt].listIndex,
            date: moment().format("YYYY-MM-DD"),
          },
        });

        if (p.pt === "视频号") {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }

      this.$message.success(`已提交 ${platforms.length} 个平台发布`);
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
.video-form {
  margin-bottom: 16px;
}
.custom-tree-node {
  display: flex;
  align-items: center;
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
}
</style>
