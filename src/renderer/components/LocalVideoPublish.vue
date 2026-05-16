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
          <el-input
            v-model="form.title"
            placeholder="默认与视频文件名一致，可改"
          />
        </el-form-item>
        <el-form-item label="视频标题">
          <el-input v-model="form.bt1" placeholder="发布时使用的标题" />
        </el-form-item>

        <el-form-item label="视频标签">
          <el-select
            v-model="bqTags"
            multiple
            filterable
            allow-create
            default-first-option
            no-data-text="请输入标签"
            placeholder="输入标签，回车添加为条目"
            style="width: 100%"
          ></el-select>
        </el-form-item>
        <el-form-item label="概括短标题">
          <el-input v-model="form.bt2" placeholder="选填，建议 6～16 字" />
          <p class="bt2-tip">
            <strong>微信视频号</strong
            >会将本项用于「概括视频主要内容」，选择视频号时必填，长度需为 6～16
            字，且不能包含特殊标点符号；<br /><strong>小红书</strong
            >会将本项作为正文内容。
          </p>
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" placeholder="选填" />
          <p class="bt2-tip">
            仅<strong>百家号</strong>会用到本项：对应发布页「地址」。其它平台忽略；若不填则不填写。
          </p>
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
          <p class="bt2-tip">
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
      title="选择账号并发布"
      :close-on-click-modal="false"
      :visible.sync="platformVisible"
      :close-on-press-escape="false"
      width="800px"
      @close="handlePlatformClose"
    >
      <el-form class="video-form">
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

      <el-divider content-position="left">账号平台选择</el-divider>

      <div v-if="treeData.length > 0" class="platform-tree-toolbar">
        <el-checkbox
          :indeterminate="checkAllIndeterminate"
          v-model="checkAllPlatforms"
          @change="handleCheckAllPlatforms"
        >
          全选
        </el-checkbox>
        <span class="batch-statement-wrap">
          <span class="batch-statement-label">批量声明</span>
          <el-select
            v-model="batchCreativeStatement"
            class="batch-statement-select"
            popper-class="statement-select-dropdown"
            size="small"
            placeholder="选择声明"
          >
            <el-option
              v-for="opt in batchStatementOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
              @click.native="onBatchStatementOptionClick(opt.value)"
            />
          </el-select>
          <el-button
            type="text"
            size="small"
            :disabled="checkedPlatformNodes.length === 0"
            @click="applyBatchCreativeStatement"
          >
            应用到已勾选
          </el-button>
        </span>
      </div>

      <el-tree
        v-if="treeData.length > 0"
        ref="tree"
        :data="treeData"
        node-key="id"
        show-checkbox
        default-expand-all
        :props="defaultProps"
        @check="onTreeCheck"
      >
        <span
          class="custom-tree-node"
          :class="{ 'platform-leaf-node': !!data.url }"
          slot-scope="{ data }"
        >
          <template v-if="!data.url">
            <span>{{ data.title }}</span>
            <el-button
              size="mini"
              type="text"
              style="margin-left: 5px"
              @click.stop="verifyLogin(data)"
              >验证登录</el-button
            >
          </template>
          <template v-else>
            <div class="platform-leaf-main">
              <span class="platform-leaf-name">{{ data.pt }}</span>
              <span
                class="platform-leaf-login"
                :style="{ color: data.loggedIn ? 'green' : 'red' }"
              >
                <span
                  v-if="data.loggedIn"
                  class="login-ok"
                  @click="reLogin(data)"
                  >登录√</span
                >
                <span v-else @click="reLogin(data)">❌重新登录</span>
              </span>
            </div>
            <div
              v-if="
                platformSupportsCreativeStatement(data.pt) &&
                isPlatformNodeChecked(data.id)
              "
              class="platform-statement-row"
            >
              <el-select
                :value="getPlatformStatement(data.id)"
                size="mini"
                class="platform-statement-select"
                popper-class="statement-select-dropdown"
                :title="getPlatformStatementDisplay(data)"
                @input="setPlatformStatement(data.id, $event)"
              >
                <el-option
                  v-for="opt in getStatementOptionsForNode(data)"
                  :key="opt.value"
                  :label="getStatementOptionPlatformLabel(opt, data.pt)"
                  :value="opt.value"
                />
              </el-select>
            </div>
          </template>
        </span>
      </el-tree>
      <el-empty
        v-if="treeData.length === 0"
        description="请先在右上角添加媒体平台账号"
      />

      <div slot="footer" class="dialog-footer">
        <el-button @click="platformVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchPublish">发布</el-button>
        <el-button type="primary" @click="handleBatchPublishToDraft"
          >发布到草稿</el-button
        >
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
import {
  CREATIVE_STATEMENT_DEFAULT,
  CREATIVE_STATEMENT_OPTIONS,
  getCreativeStatementOptionsForPlatform,
  getCreativeStatementPlatformKey,
  getCreativeStatementShortLabel,
  normalizeCreativeStatement,
  platformSupportsCreativeStatement,
} from "../../shared/creativeStatement.js";

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

function parseBqToTags(raw) {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** 话题平台依赖「#词」；标签多选无 # 时自动补上，已带 # 的不重复添加 */
function formatBqFromTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .join(" ");
}

export default {
  name: "LocalVideoPublish",
  data() {
    return {
      ptConfig,
      metaVisible: false,
      platformVisible: false,
      localFilePath: "",
      bqTags: [],
      platformStatements: {},
      checkedPlatformIds: [],
      checkAllPlatforms: false,
      checkAllIndeterminate: false,
      batchCreativeStatement: CREATIVE_STATEMENT_DEFAULT,
      form: {
        title: "",
        bt1: "",
        bt2: "",
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
    batchStatementOptions() {
      return CREATIVE_STATEMENT_OPTIONS;
    },
    checkedPlatformNodes() {
      if (!this.$refs.tree) return [];
      return this.$refs.tree
        .getCheckedNodes(true)
        .filter((item) => item && item.url);
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
    platformSupportsCreativeStatement,
    open(filePath) {
      if (!filePath) return;
      this.localFilePath = filePath;
      const defaultTitle = fileStem(filePath);
      this.bqTags = [];
      this.resetPlatformStatementState();
      this.form = { title: defaultTitle, bt1: "", bt2: "", address: "" };
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
        address: (form.address || "").trim(),
      };
      this.bqTags = parseBqToTags(form.bq);
      this.resetPlatformStatementState();
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.republishTextOtherName = payload.textOtherName || fileStem(filePath);
      this.republishContext = {
        records: Array.isArray(payload.records) ? payload.records : [],
        failedTargets: Array.isArray(payload.failedTargets)
          ? payload.failedTargets
          : [],
      };
      this.metaVisible = false;
      this.loadAccounts();
      this.platformVisible = true;
      this.$nextTick(() => {
        const checkedKeys = this.resolveRepublishCheckedKeys(
          this.republishContext.failedTargets
        );
        if (this.$refs.tree) {
          this.$refs.tree.setCheckedKeys(checkedKeys);
        }
        this.applyRepublishPlatformStatements(form.creativeStatement);
        this.onTreeCheck();
      });
      return true;
    },
    resolveRepublishCheckedKeys(failedTargets = []) {
      if (!Array.isArray(failedTargets) || failedTargets.length === 0)
        return [];
      const keys = [];
      const targetSet = new Set(
        failedTargets.map(
          (v) =>
            `${String(v.pt || "").trim()}__${
              String(v.phone || "").split("-")[0]
            }`
        )
      );
      (this.treeData || []).forEach((group) => {
        (group.children || []).forEach((child) => {
          const key = `${String(child.pt || "").trim()}__${
            String(child.phone || "").split("-")[0]
          }`;
          if (targetSet.has(key)) {
            keys.push(child.id);
          }
        });
      });
      return keys;
    },
    findRepublishRecord(pt, phone) {
      if (
        !this.republishContext ||
        !Array.isArray(this.republishContext.records)
      )
        return null;
      const p = String(phone || "").split("-")[0];
      return this.republishContext.records.find(
        (item) =>
          String(item.pt || "") === String(pt || "") &&
          String(item.phone || "").split("-")[0] === p
      );
    },

    defaultBookName() {
      return fileStem(this.localFilePath) || "";
    },

    buildVideoPayload() {
      const bookName =
        (this.form.title && this.form.title.trim()) || this.defaultBookName();
      const bt1 = this.form.bt1.trim();
      const bt2 = (this.form.bt2 && this.form.bt2.trim()) || bt1;
      return {
        bookName,
        textType: "local",
        data: {
          textOtherName:
            this.republishTextOtherName || fileStem(this.localFilePath),
          bt1,
          bt2,
          bq: formatBqFromTags(this.bqTags),
          bdText: "",
          address: this.form.address.trim(),
        },
      };
    },
    buildPlatformVideoPayload(platformNode, baseVideo) {
      return {
        ...baseVideo,
        data: {
          ...baseVideo.data,
          creativeStatement: this.getPlatformStatement(platformNode.id),
        },
      };
    },
    resetPlatformStatementState() {
      this.platformStatements = {};
      this.checkedPlatformIds = [];
      this.checkAllPlatforms = false;
      this.checkAllIndeterminate = false;
      this.batchCreativeStatement = CREATIVE_STATEMENT_DEFAULT;
    },
    getAllPlatformLeafNodes() {
      const leaves = [];
      (this.treeData || []).forEach((group) => {
        (group.children || []).forEach((child) => {
          if (child && child.url) leaves.push(child);
        });
      });
      return leaves;
    },
    initPlatformStatementsForLeaves(leaves, defaultValue) {
      const next = { ...this.platformStatements };
      leaves.forEach((node) => {
        if (!next[node.id]) {
          next[node.id] = normalizeCreativeStatement(defaultValue);
        }
      });
      this.platformStatements = next;
    },
    applyRepublishPlatformStatements(fallbackValue) {
      const fallback = normalizeCreativeStatement(fallbackValue);
      const next = { ...this.platformStatements };
      this.getAllPlatformLeafNodes().forEach((node) => {
        const rec = this.findRepublishRecord(node.pt, node.phone);
        if (rec && rec.creativeStatement) {
          next[node.id] = normalizeCreativeStatement(rec.creativeStatement);
        } else if (!next[node.id]) {
          next[node.id] = fallback;
        }
      });
      this.platformStatements = next;
    },
    handleCheckAllPlatforms(checked) {
      if (!this.$refs.tree) return;
      const keys = checked
        ? this.getAllPlatformLeafNodes().map((n) => n.id)
        : [];
      this.$refs.tree.setCheckedKeys(keys);
      this.initPlatformStatementsForLeaves(this.getAllPlatformLeafNodes());
      this.onTreeCheck();
    },
    onTreeCheck() {
      if (!this.$refs.tree) return;
      const checkedLeaves = this.$refs.tree
        .getCheckedNodes(true)
        .filter((n) => n && n.url);
      this.checkedPlatformIds = checkedLeaves.map((n) => n.id);
      this.initPlatformStatementsForLeaves(checkedLeaves);
      const allLeaves = this.getAllPlatformLeafNodes();
      const total = allLeaves.length;
      const count = checkedLeaves.length;
      this.checkAllPlatforms = total > 0 && count === total;
      this.checkAllIndeterminate = count > 0 && count < total;
    },
    isPlatformNodeChecked(id) {
      return this.checkedPlatformIds.includes(id);
    },
    getPlatformStatement(id) {
      return normalizeCreativeStatement(
        this.platformStatements[id] || CREATIVE_STATEMENT_DEFAULT
      );
    },
    setPlatformStatement(id, value) {
      this.$set(this.platformStatements, id, normalizeCreativeStatement(value));
    },
    getStatementOptionsForNode(data) {
      return getCreativeStatementOptionsForPlatform(data.pt);
    },
    getStatementOptionPlatformLabel(opt, pt) {
      const key = getCreativeStatementPlatformKey(pt);
      if (key && opt.platformLabels && opt.platformLabels[key]) {
        return opt.platformLabels[key];
      }
      return opt.label;
    },
    getPlatformStatementDisplay(data) {
      return getCreativeStatementShortLabel(
        this.getPlatformStatement(data.id),
        data.pt
      );
    },
    applyBatchCreativeStatement(options = {}) {
      const { silent = false } = options;
      const batchValue = normalizeCreativeStatement(
        this.batchCreativeStatement
      );
      const targets = this.checkedPlatformNodes.filter((node) =>
        platformSupportsCreativeStatement(node.pt)
      );
      if (targets.length === 0) {
        if (!silent)
          this.$message.warning("已勾选账号中没有支持创作声明的平台");
        return;
      }
      const next = { ...this.platformStatements };
      let applied = 0;
      targets.forEach((node) => {
        const opts = getCreativeStatementOptionsForPlatform(node.pt);
        const matched = opts.find((opt) => opt.value === batchValue);
        if (!matched) return;
        next[node.id] = matched.value;
        applied += 1;
      });
      this.platformStatements = next;
      if (applied === 0) {
        if (!silent) this.$message.warning("当前批量声明不适用于已勾选平台");
        return;
      }
      if (!silent)
        this.$message.success(`已为 ${applied} 个账号设置创作声明`);
    },
    // 用户点了批量声明下拉的任意选项（包括"二次选中相同值"），
    // 都强制覆盖所有已勾选支持平台账号的声明值。
    onBatchStatementOptionClick(value) {
      this.batchCreativeStatement = normalizeCreativeStatement(value);
      this.applyBatchCreativeStatement({ silent: true });
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
        this.resetPlatformStatementState();
        this.initPlatformStatementsForLeaves(this.getAllPlatformLeafNodes());
        if (this.$refs.tree) {
          this.$refs.tree.setCheckedKeys([]);
        }
        this.onTreeCheck();
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
      this.bqTags = [];
      this.resetPlatformStatementState();
      this.form = { title: "", bt1: "", bt2: "", address: "" };
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
      return Object.keys(rawTree).map((phone) => {
        const node = rawTree[phone];
        return {
          id: phone,
          title: phone,
          children: (node.children || []).map((child) => ({
            id: child.meta.id,
            pt: child.meta.pt,
            phone: child.meta.phone.split("-")[0],
            date: child.meta.date,
            url: child.meta.url,
            loggedIn: (() => {
              const name = `${child.meta.phone.split("-")[0]}${
                child.meta.pt
              }登录`;
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

    async handleBatchPublish() {
      return this.submitBatchPublish("publish");
    },

    async handleBatchPublishToDraft() {
      return this.submitBatchPublish("draft");
    },

    async submitBatchPublish(mode = "publish") {
      const isDraftMode = mode === "draft";
      if (!this.localFilePath) {
        this.$message.warning("未选择视频文件");
        return;
      }
      const checked = this.$refs.tree.getCheckedNodes(true);
      const platforms = checked.filter((item) => item.url);
      if (platforms.length === 0) {
        this.$message.warning("请至少选择一个平台");
        return;
      }
      if (
        isDraftMode &&
        platforms.some((p) => String(p.pt || "").includes("头条"))
      ) {
        this.$message.warning("暂无头条草稿");
        return;
      }
      if (isDraftMode && this.scheduledPublish) {
        this.$message.warning("发布到草稿不支持定时发布，请关闭定时发布后再试");
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
      if (!isDraftMode) {
        const publishAtError = this.validatePublishAt();
        if (publishAtError) {
          this.$message.warning(publishAtError);
          return;
        }
      }
      const baseVideo = this.buildVideoPayload();
      const selectedFile = fileBaseName(this.localFilePath);
      const currentDate = moment().format("YYYY-MM-DD");
      const scheduledAtText = String(this.publishAt || "").trim();
      const scheduledAtMs = this.scheduledPublish
        ? moment(scheduledAtText, "YYYY-MM-DD HH:mm:ss", true).valueOf()
        : null;

      platforms.sort((a, b) => {
        if (a.pt.includes("视频号")) return -1;
        if (b.pt.includes("视频号")) return 1;
        return 0;
      });

      const scheduledWriteTasks = [];
      for (let p of platforms) {
        const partition = "persist:" + p.phone.split("-")[0] + p.pt;
        const taskId = Date.now() + Math.random();
        const shouldShow = this.thisShow;
        const shouldCloseWindowAfterPublish = shouldShow
          ? this.closeWindow
          : true;
        const video = this.buildPlatformVideoPayload(p, baseVideo);
        if (this.scheduledPublish && !isDraftMode) {
          scheduledWriteTasks.push(
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
                creativeStatement: video.data.creativeStatement,
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
            })
          );
          continue;
        }
        // 用 JSON 兜底序列化，去掉 Vue 响应式代理 / 不可克隆对象，
        // 避免 Electron IPC 抛 "object could not be cloned" 导致页面会话提前关闭。
        ipcRenderer.send("puppeteerFile", JSON.parse(JSON.stringify({
          ...p,
          taskId,
          ...video,
          textOtherName: video.data.textOtherName,
          selectedFile,
          publishMode: isDraftMode ? "draft" : "publish",
          publishToDraft: isDraftMode,
          url: this.ptConfig[p.pt].upload,
          show: shouldShow,
          closeWindowAfterPublish: shouldCloseWindowAfterPublish,
          useragent: this.ptConfig[p.pt].useragent,
          partition,
          filePath: this.localFilePath,
          date: currentDate,
        })));

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
              creativeStatement: video.data.creativeStatement,
              filePath: this.localFilePath,
              publishAttemptCount: oldAttempt + 1,
              republishCount: oldRepublish + 1,
              publishMode: isDraftMode ? "draft" : "publish",
              publishStatus: isDraftMode ? "drafting" : "publishing",
              lastPublishMessage: isDraftMode
                ? "等待保存草稿结果"
                : "等待发布结果",
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
              creativeStatement: video.data.creativeStatement,
              filePath: this.localFilePath,
              useragent: this.ptConfig[p.pt].useragent,
              phone: p.phone,
              partition,
              url: this.ptConfig[p.pt].listIndex,
              date: currentDate,
              publishMode: isDraftMode ? "draft" : "publish",
              publishAttemptCount: 1,
              republishCount: 0,
              publishSuccessCount: 0,
              publishFailCount: 0,
              publishStatus: isDraftMode ? "drafting" : "publishing",
              lastPublishMessage: isDraftMode
                ? "等待保存草稿结果"
                : "等待发布结果",
              lastPublishAt: Date.now(),
            },
          });
        }

        if (p.pt === "视频号") {
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
      }

      if (this.scheduledPublish && !isDraftMode) {
        await Promise.all(scheduledWriteTasks);
        ipcRenderer.send("scheduledPublish:refresh");
      }
      let successMessage = `已提交 ${platforms.length} 个平台发布`;
      if (isDraftMode) {
        successMessage = `已提交 ${platforms.length} 个平台保存草稿`;
      } else if (this.scheduledPublish) {
        successMessage = `已创建 ${platforms.length} 个平台定时发布任务`;
      }
      this.$message.success(successMessage);
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
.platform-tree-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.batch-statement-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.batch-statement-label {
  font-size: 13px;
  color: #606266;
}
.batch-statement-select {
  width: 200px;
}
.custom-tree-node {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
}
.custom-tree-node.platform-leaf-node {
  flex-direction: column;
  align-items: stretch;
  width: 120px;
  min-width: 120px;
  box-sizing: border-box;
}
.platform-leaf-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.platform-leaf-name {
  margin-right: 4px;
}
.platform-statement-row {
  width: 100%;
  margin-top: 6px;
}
.platform-statement-select {
  width: 100%;
}
:deep(.platform-statement-select .el-input) {
  width: 100%;
}
:deep(.platform-statement-select .el-input__inner) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.login-ok {
  padding-left: 10px;
  cursor: pointer;
}
:deep(.el-dialog__body) {
  padding-top: 10px;
}
:deep(.el-tree-node__content) {
  height: auto;
  min-height: 26px;
  align-items: flex-start;
  padding-top: 3px;
  padding-bottom: 3px;
}
:deep(.el-tree-node__content > .el-checkbox) {
  margin-top: 2px;
}
:deep(.el-tree-node.is-expanded > .el-tree-node__children) {
  display: flex;
  flex-wrap: wrap;
}
</style>

<style>
.statement-select-dropdown {
  min-width: 260px !important;
}
.statement-select-dropdown .el-select-dropdown__item {
  height: auto;
  line-height: 1.45;
  padding-top: 8px;
  padding-bottom: 8px;
  white-space: normal;
}
</style>
