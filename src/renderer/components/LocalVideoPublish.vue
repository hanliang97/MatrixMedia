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
            ref="bqSelect"
            v-model="bqTags"
            multiple
            filterable
            allow-create
            default-first-option
            no-data-text="请输入标签"
            placeholder="输入标签，回车/空格添加；支持批量粘贴 #标签1 #标签2"
            style="width: 100%"
            @paste.native.capture="onBqPaste"
            @keydown.native.capture="onBqKeydown"
          ></el-select>
        </el-form-item>
        <el-form-item label="概括短标题">
          <el-input
            ref="bt2Input"
            v-model="form.bt2"
            placeholder="选填，建议 6～16 字"
            @input="onBt2Input"
            @keydown.native.capture="onBt2Keydown"
          />
          <p class="bt2-tip">
            <strong>微信视频号</strong
            >会将本项用于「概括视频主要内容」，选择视频号时必填，长度需为 6～16
            字，且不能包含特殊标点符号；<br /><strong>小红书</strong
            >会将本项作为正文内容。
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
                v-if="data.proxyDisplay"
                class="platform-leaf-proxy"
                :title="'已配置代理 ' + data.proxyDisplay"
              >
                代理 {{ data.proxyDisplay }}
              </span>
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
        <el-button @click="goBackToMeta">上一步</el-button>
        <el-button @click="platformVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchPublish">发布</el-button>
        <el-button type="primary" @click="handleBatchPublishToDraft"
          >发布到草稿</el-button
        >
      </div>

      <!-- 旧的 <webview> 登录弹窗已迁移到主进程的独立 BrowserWindow，
           避免被小红书等站点的 GuestView 指纹识别后反复跳登录。
           现在点击"重新登录"会通过 openLoginWindow 调用 IPC 弹独立窗口。 -->
    </el-dialog>

    <!-- Directory batch publish dialog -->
    <el-dialog
      title="目录批量发布"
      :close-on-click-modal="false"
      :visible.sync="dirPublishVisible"
      :close-on-press-escape="false"
      width="700px"
      @close="handleDirPublishClose"
    >
      <div
        style="
          margin-bottom: 16px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
        "
      >
        <el-button size="small" @click="chooseBatchDir">
          {{ dirPath ? "重新选择目录" : "选择目录" }}
        </el-button>
        <span
          v-if="dirPath"
          style="font-size: 13px; color: #606266; word-break: break-all"
          >{{ dirPath }}</span
        >
      </div>
      <div
        style="
          margin-bottom: 16px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
        "
      >
        <el-button size="small" @click="chooseBatchXlsx">
          {{ dirXlsxRows.length ? "重新选择声明文件" : "选择声明文件 (xlsx)" }}
        </el-button>
        <el-button size="small" type="text" @click="downloadBatchTemplate"
          >下载模版</el-button
        >
        <span v-if="dirXlsxError" style="color: #f56c6c; font-size: 13px">{{
          dirXlsxError
        }}</span>
        <span
          v-else-if="dirXlsxRows.length"
          style="font-size: 13px; color: #67c23a"
          >已加载 {{ dirXlsxRows.length }} 条记录</span
        >
      </div>

      <el-table
        v-if="dirXlsxRows.length"
        :data="dirXlsxRows"
        size="mini"
        max-height="260"
        style="width: 100%; margin-bottom: 16px"
      >
        <el-table-column
          prop="fileName"
          label="文件名"
          min-width="160"
          show-overflow-tooltip
        />
        <el-table-column
          prop="title"
          label="标题"
          min-width="160"
          show-overflow-tooltip
        />
        <el-table-column
          prop="tags"
          label="标签"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column label="文件状态" width="80">
          <template slot-scope="{ row }">
            <span
              :style="{
                color: dirFileExists(row.fileName) ? '#67c23a' : '#f56c6c',
              }"
            >
              {{ dirFileExists(row.fileName) ? "✓" : "✗" }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <el-form label-width="88px" style="margin-bottom: 8px">
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
        </el-form-item>
      </el-form>

      <div slot="footer" class="dialog-footer">
        <el-button @click="dirPublishVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!dirPath || !dirXlsxRows.length"
          @click="onDirPublishNext"
          >下一步</el-button
        >
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
import moment from "moment";
import dataRequest from "@/utils/dataRequest";
import ptConfig from "@/utils/configUrl";
import openLoginWindow from "@/utils/openLoginWindow";
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
import {
  getAccountProxyDisplay,
  isAccountProxyEnabled,
} from "../../shared/accountProxy.js";
import {
  applyXhsConservativePublishOptions,
  getXhsPlatformStaggerDelayMs,
  isXhsPlatform,
} from "../../shared/xhsPublishPolicy.js";
import { resolveEffectivePublishMode } from "../../shared/accountPublishSettings.js";
import {
  isBt2SelectAllShortcut,
  isVideohaoBt2AllowedChar,
  sanitizeVideohaoBt2Input,
  validateVideohaoBt2 as validateVideohaoBt2Value,
} from "@/utils/localVideoPublishBt2";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      // Directory batch publish state
      dirPublishVisible: false,
      dirPath: "",
      dirXlsxRows: [], // [{fileName, title, tags}]
      dirXlsxError: "",
      dirBatchFiles: [],
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
      // 依赖 checkedPlatformIds（响应式），避免只依赖 $refs 导致 computed 不更新；
      // 再从 treeData 里按 id 还原节点。
      const ids = this.checkedPlatformIds;
      if (!ids || ids.length === 0) return [];
      const idSet = new Set(ids);
      const result = [];
      (this.treeData || []).forEach((group) => {
        (group.children || []).forEach((child) => {
          if (child && child.url && idSet.has(child.id)) result.push(child);
        });
      });
      return result;
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
    /** 把字符串按 # / 空格 / 逗号 / 分号 / 顿号 切成多个标签 */
    _splitBqTokens(raw) {
      if (!raw) return [];
      return (
        String(raw)
          // 在每个 # 前插入空格，保证 "#a#b" 也能切开
          .replace(/#/g, " #")
          .split(/[\s,，、;；]+/)
          .map((s) => s.trim().replace(/^#+/, "").trim())
          .filter(Boolean)
      );
    },
    _pushBqTags(list) {
      if (!Array.isArray(list) || !list.length) return 0;
      const exist = new Set((this.bqTags || []).map((t) => String(t)));
      let added = 0;
      for (const t of list) {
        const v = String(t || "").trim();
        if (!v) continue;
        if (exist.has(v)) continue;
        this.bqTags.push(v);
        exist.add(v);
        added += 1;
      }
      return added;
    },
    /** 清空 el-select 内部正在输入的搜索词 */
    _clearBqInput() {
      this.$nextTick(() => {
        const root = this.$refs.bqSelect && this.$refs.bqSelect.$el;
        if (!root) return;
        const input = root.querySelector("input.el-select__input");
        if (!input) return;
        input.value = "";
        // 同步 el-select 内部 query 状态
        input.dispatchEvent(new Event("input", { bubbles: true }));
        try {
          const sel = this.$refs.bqSelect;
          if (sel) sel.query = "";
        } catch (_) {
          /* ignore */
        }
      });
    },
    onBqPaste(e) {
      try {
        const cd = e.clipboardData || window.clipboardData;
        if (!cd) return;
        const text = cd.getData("text") || "";
        if (!text) return;
        const tokens = this._splitBqTokens(text);
        // 只有单个普通词（没有 # / 分隔符）就走原始粘贴流程
        if (tokens.length <= 1 && !/[#\s,，、;；]/.test(text)) return;
        e.preventDefault();
        e.stopPropagation();
        this._pushBqTags(tokens);
        this._clearBqInput();
      } catch (_) {
        /* ignore，回落到默认行为 */
      }
    },
    onBqKeydown(e) {
      // 只拦截空格键
      if (e.key !== " " && e.code !== "Space" && e.keyCode !== 32) return;
      const target = e.target;
      if (!target || target.tagName !== "INPUT") return;
      const raw = String(target.value || "");
      const tokens = this._splitBqTokens(raw);
      if (!tokens.length) {
        // 空内容按空格，直接阻止留下空白
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._pushBqTags(tokens);
      this._clearBqInput();
    },
    open(filePath) {
      if (!filePath) return;
      this.localFilePath = filePath;
      const defaultTitle = fileStem(filePath);
      this.bqTags = [];
      this.resetPlatformStatementState();
      this.form = { title: defaultTitle, bt1: "", bt2: "" };
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
      let fallback = 0;
      targets.forEach((node) => {
        const opts = getCreativeStatementOptionsForPlatform(node.pt);
        const matched = opts.find((opt) => opt.value === batchValue);
        if (matched) {
          next[node.id] = matched.value;
          applied += 1;
        } else {
          // 当前批量值在该平台没有对应选项时，回退到「无标注」，
          // 保证每个支持声明的子账号都有一个明确的声明值，不会留空。
          next[node.id] = CREATIVE_STATEMENT_DEFAULT;
          fallback += 1;
        }
      });
      this.platformStatements = next;
      if (applied === 0 && fallback === 0) {
        if (!silent) this.$message.warning("当前批量声明不适用于已勾选平台");
        return;
      }
      if (!silent) {
        if (fallback > 0) {
          this.$message.success(
            `已为 ${applied} 个账号设置创作声明，${fallback} 个不支持已回退为「无标注」`
          );
        } else {
          this.$message.success(`已为 ${applied} 个账号设置创作声明`);
        }
      }
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
      return validateVideohaoBt2Value(value);
    },
    warnBt2SpecialPunctuation() {
      this.$message.warning("概括短标题不能包含特殊标点符号");
    },
    onBt2Input(value) {
      const nextValue = sanitizeVideohaoBt2Input(value);
      if (nextValue === value) return;
      this.form.bt2 = nextValue;
      this.warnBt2SpecialPunctuation();
    },
    onBt2Keydown(e) {
      if (isBt2SelectAllShortcut(e)) {
        const target = e.target;
        if (target && typeof target.select === "function") {
          e.preventDefault();
          e.stopPropagation();
          target.select();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = String(e.key || "");
      if (key.length !== 1 || isVideohaoBt2AllowedChar(key)) return;
      e.preventDefault();
      e.stopPropagation();
      this.warnBt2SpecialPunctuation();
    },

    onMetaNext() {
      if (!this.form.bt1 || !this.form.bt1.trim()) {
        this.$message.warning("请填写标题");
        return;
      }
      const nextBt2 = sanitizeVideohaoBt2Input(this.form.bt2);
      if (nextBt2 !== this.form.bt2) {
        this.form.bt2 = nextBt2;
        this.warnBt2SpecialPunctuation();
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
    goBackToMeta() {
      this.platformVisible = false;
      this.metaVisible = true;
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
      this.form = { title: "", bt1: "", bt2: "" };
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.republishContext = null;
      this.republishTextOtherName = "";
      this.dirBatchFiles = [];
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
            proxyDisplay: getAccountProxyDisplay(child.meta.proxy),
            proxyEnabled: isAccountProxyEnabled(child.meta.proxy),
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

    async reLogin(item) {
      const partition = "persist:" + item.phone.split("-")[0] + item.pt;
      try {
        const result = await openLoginWindow({ ...item, partition });
        if (result && result.ok === false) {
          this.$message.error(result.message || "打开登录窗口失败");
        } else if (result && result.reused) {
          this.$message.info("已切换到已打开的登录窗口");
        }
      } catch (e) {
        this.$message.error(
          "打开登录窗口失败：" + (e && e.message ? e.message : e)
        );
      }
      // 旧逻辑里 hideLoginDialog 会在 dialog 关闭后调 loadAccounts；
      // 这里手动延时调一次，让 cookie 落地后刷新登录状态。
      setTimeout(() => {
        if (typeof this.loadAccounts === "function") this.loadAccounts();
      }, 2000);
    },

    async handleBatchPublish() {
      return this.submitBatchPublish("publish");
    },

    async handleBatchPublishToDraft() {
      return this.submitBatchPublish("draft");
    },

    async submitBatchPublish(mode = "publish") {
      const isDraftMode = mode === "draft";
      // Directory batch mode
      if (this.dirBatchFiles && this.dirBatchFiles.length > 0) {
        return this.submitDirBatchPublish(mode);
      }
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
      let submitted = 0;
      let draftSubmitted = 0;
      let scheduledSubmitted = 0;

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
        const effectiveMode = resolveEffectivePublishMode(isDraftMode, p);
        if (this.scheduledPublish && !effectiveMode.publishToDraft) {
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
                publishMode: effectiveMode.publishMode,
                publishToDraft: effectiveMode.publishToDraft,
                publishStatus: "scheduled",
                lastPublishMessage: "等待定时发布",
                lastPublishAt: Date.now(),
              },
            })
          );
          submitted++;
          scheduledSubmitted++;
          continue;
        }
        // 用 JSON 兜底序列化，去掉 Vue 响应式代理 / 不可克隆对象，
        // 避免 Electron IPC 抛 "object could not be cloned" 导致页面会话提前关闭。
        const publishPayload = applyXhsConservativePublishOptions({
          ...p,
          taskId,
          ...video,
          textOtherName: video.data.textOtherName,
          selectedFile,
          publishMode: effectiveMode.publishMode,
          publishToDraft: effectiveMode.publishToDraft,
          url: this.ptConfig[p.pt].upload,
          show: shouldShow,
          closeWindowAfterPublish: shouldCloseWindowAfterPublish,
          useragent: this.ptConfig[p.pt].useragent,
          partition,
          filePath: this.localFilePath,
          date: currentDate,
        });
        ipcRenderer.send(
          "puppeteerFile",
          JSON.parse(JSON.stringify(publishPayload))
        );

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
              creativeStatement: video.data.creativeStatement,
              filePath: this.localFilePath,
              publishAttemptCount: oldAttempt + 1,
              republishCount: oldRepublish + 1,
              publishMode: effectiveMode.publishMode,
              publishToDraft: effectiveMode.publishToDraft,
              publishStatus: effectiveMode.publishToDraft
                ? "drafting"
                : "publishing",
              lastPublishMessage: effectiveMode.publishToDraft
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
              creativeStatement: video.data.creativeStatement,
              filePath: this.localFilePath,
              useragent: this.ptConfig[p.pt].useragent,
              phone: p.phone,
              partition,
              url: this.ptConfig[p.pt].listIndex,
              date: currentDate,
              publishMode: effectiveMode.publishMode,
              publishToDraft: effectiveMode.publishToDraft,
              publishAttemptCount: 1,
              republishCount: 0,
              publishSuccessCount: 0,
              publishFailCount: 0,
              publishStatus: effectiveMode.publishToDraft
                ? "drafting"
                : "publishing",
              lastPublishMessage: effectiveMode.publishToDraft
                ? "等待保存草稿结果"
                : "等待发布结果",
              lastPublishAt: Date.now(),
            },
          });
        }

        if (isXhsPlatform(p.pt)) {
          await sleep(getXhsPlatformStaggerDelayMs());
        } else if (p.pt === "视频号") {
          await sleep(4000);
        }
        submitted++;
        if (effectiveMode.publishToDraft) draftSubmitted++;
      }

      if (this.scheduledPublish && !isDraftMode) {
        await Promise.all(scheduledWriteTasks);
        ipcRenderer.send("scheduledPublish:refresh");
      }
      if (submitted === 0) {
        this.$message.warning("没有提交新的发布任务");
        return;
      }
      let successMessage = `已提交 ${submitted} 个平台发布`;
      if (draftSubmitted === submitted) {
        successMessage = `已提交 ${submitted} 个平台保存草稿`;
      } else if (scheduledSubmitted === submitted) {
        successMessage = `已创建 ${submitted} 个平台定时发布任务`;
      }
      this.$message.success(successMessage);
      this.platformVisible = false;
      this.resetState();
      this.$emit("published");
    },

    openDirectory() {
      this.dirPath = "";
      this.dirXlsxRows = [];
      this.dirXlsxError = "";
      this.scheduledPublish = false;
      this.publishAt = "";
      this.dirPublishVisible = true;
    },

    handleDirPublishClose() {
      this.dirPath = "";
      this.dirXlsxRows = [];
      this.dirXlsxError = "";
    },

    async chooseBatchDir() {
      const result = await ipcRenderer.invoke("dialog:openBatchDir");
      if (result) {
        this.dirPath = result;
      }
    },

    async chooseBatchXlsx() {
      const result = await ipcRenderer.invoke("dialog:openBatchXlsx");
      if (!result) return;
      if (result.error) {
        this.dirXlsxError = "xlsx 解析失败: " + result.error;
        this.dirXlsxRows = [];
        return;
      }
      this.dirXlsxError = "";
      this.dirXlsxRows = result;
    },

    async downloadBatchTemplate() {
      const result = await ipcRenderer.invoke("dialog:downloadBatchTemplate");
      if (result && result.ok) {
        this.$message.success("模版已下载到: " + result.path);
      } else {
        this.$message.error(
          "模版下载失败: " +
            (result && result.error ? result.error : "未知错误")
        );
      }
    },

    dirFileExists(fileName) {
      // We can only check existence via the path we have; actual fs check is main-process side.
      // For display purposes: just show true if dirPath is set (we trust the user).
      // A proper check would require another IPC call which is overkill for a preview indicator.
      // Simple heuristic: always show checkmark if dirPath is set, since we can't do fs from renderer.
      return !!this.dirPath;
    },

    async onDirPublishNext() {
      if (!this.dirPath) {
        this.$message.warning("请先选择目录");
        return;
      }
      if (!this.dirXlsxRows.length) {
        this.$message.warning("请先选择声明文件");
        return;
      }
      const publishAtError = this.validatePublishAt();
      if (publishAtError) {
        this.$message.warning(publishAtError);
        return;
      }
      // Filter rows to only those with a fileName
      const filteredRows = this.dirXlsxRows.filter(
        (r) => r.fileName && r.fileName.trim()
      );
      if (!filteredRows.length) {
        this.$message.warning("xlsx 中没有有效的文件名行");
        return;
      }

      // 用 main 进程对每个 fileName 做："文件存在性 + 后缀自动补全 + 大小写匹配"
      // 任意一条匹配不到都直接阻断，避免发布时拿着不存在的 filePath 卡死。
      const resolveRes = await ipcRenderer.invoke("resolveBatchFiles", {
        dirPath: this.dirPath,
        fileNames: filteredRows.map((r) => r.fileName),
      });
      if (!resolveRes || resolveRes.error) {
        this.$message.error(
          "校验文件失败: " + ((resolveRes && resolveRes.error) || "未知错误")
        );
        return;
      }
      const missing = resolveRes.results.filter((r) => !r.exists);
      if (missing.length) {
        this.$message.error(
          `以下文件在目录中不存在（前 5 个）: ${missing
            .slice(0, 5)
            .map((m) => m.fileName)
            .join("、")}${
            missing.length > 5 ? ` 等共 ${missing.length} 个` : ""
          }`
        );
        return;
      }
      // 把解析后的完整 filePath 回填到 dirBatchFiles，submitDirBatchPublish 不再做 path.join。
      const pathToByName = new Map(
        resolveRes.results.map((r) => [r.fileName, r])
      );
      this.dirBatchFiles = filteredRows.map((row) => {
        const resolved = pathToByName.get(row.fileName);
        return {
          ...row,
          fileName: resolved
            ? resolved.matchedFileName || row.fileName
            : row.fileName,
          resolvedPath: resolved ? resolved.resolvedPath : "",
        };
      });

      this.dirPublishVisible = false;
      this.loadAccounts();
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

    async submitDirBatchPublish(mode = "publish") {
      const isDraftMode = mode === "draft";
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

      const currentDate = moment().format("YYYY-MM-DD");
      const scheduledAtText = String(this.publishAt || "").trim();
      const scheduledAtMs = this.scheduledPublish
        ? moment(scheduledAtText, "YYYY-MM-DD HH:mm:ss", true).valueOf()
        : null;

      const path = require("path");
      let submitted = 0;
      let draftSubmitted = 0;
      let scheduledSubmitted = 0;
      const scheduledWriteTasks = [];

      for (const fileRow of this.dirBatchFiles) {
        // 优先使用 onDirPublishNext 里 IPC 解析好的真实路径（已做存在性 + 后缀补全）。
        // 兜底：老入口或刷新后 resolvedPath 丢失时，回退到 dirPath + fileName 拼接。
        const filePath =
          fileRow.resolvedPath || path.join(this.dirPath, fileRow.fileName);
        const stem = fileRow.fileName.replace(/\.[^/.]+$/, "");
        const bt1 = (fileRow.title || stem).trim();
        const bt2 = bt1;
        // tags: comma-separated -> space-separated with # prefix for hashtag platforms
        const rawTags = String(fileRow.tags || "").trim();
        const tagList = rawTags
          ? rawTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const bookName = bt1;
        const selectedFile = fileRow.fileName;
        const textOtherName = stem;

        if (hasVideohao) {
          const bt2Error = this.validateVideohaoBt2(bt2);
          if (bt2Error) {
            this.$message.warning(`文件 ${fileRow.fileName}: ${bt2Error}`);
            return;
          }
        }

        platforms.sort((a, b) => {
          if (a.pt.includes("视频号")) return -1;
          if (b.pt.includes("视频号")) return 1;
          return 0;
        });

        for (const p of platforms) {
          const partition = "persist:" + p.phone.split("-")[0] + p.pt;
          const taskId = Date.now() + Math.random();
          const shouldShow = this.thisShow;
          const shouldCloseWindowAfterPublish = shouldShow
            ? this.closeWindow
            : true;
          const creativeStatement = this.getPlatformStatement(p.id);
          const effectiveMode = resolveEffectivePublishMode(isDraftMode, p);

          // Format bq for this platform
          const hashtagPlatforms = new Set(["视频号", "抖音", "快手"]);
          let bq;
          if (hashtagPlatforms.has(p.pt)) {
            bq = tagList
              .map((t) => (t.startsWith("#") ? t : "#" + t))
              .join(" ");
          } else {
            bq = tagList.map((t) => t.replace(/^#/, "")).join(" ");
          }

          if (this.scheduledPublish && !effectiveMode.publishToDraft) {
            scheduledWriteTasks.push(
              dataRequest({
                type: "add",
                fileName: "pushData",
                item: {
                  bookName,
                  textOtherName,
                  textType: "local",
                  pt: p.pt,
                  selectedFile,
                  bt: bt1,
                  bt2,
                  bq,
                  creativeStatement,
                  filePath,
                  useragent: this.ptConfig[p.pt].useragent,
                  phone: p.phone,
                  partition,
                  url: this.ptConfig[p.pt].listIndex,
                  uploadUrl: this.ptConfig[p.pt].upload,
                  date: currentDate,
                  scheduledTask: true,
                  scheduledPublishAt: scheduledAtMs,
                  scheduledPublishAtText: scheduledAtText,
                  publishMode: effectiveMode.publishMode,
                  publishToDraft: effectiveMode.publishToDraft,
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
            submitted++;
            scheduledSubmitted++;
            continue;
          }

          const publishPayload = applyXhsConservativePublishOptions({
            ...p,
            taskId,
            bookName,
            textType: "local",
            data: {
              textOtherName,
              bt1,
              bt2,
              bq,
              bdText: "",
              creativeStatement,
            },
            textOtherName,
            selectedFile,
            publishMode: effectiveMode.publishMode,
            publishToDraft: effectiveMode.publishToDraft,
            url: this.ptConfig[p.pt].upload,
            show: shouldShow,
            closeWindowAfterPublish: shouldCloseWindowAfterPublish,
            useragent: this.ptConfig[p.pt].useragent,
            partition,
            filePath,
            date: currentDate,
          });
          ipcRenderer.send(
            "puppeteerFile",
            JSON.parse(JSON.stringify(publishPayload))
          );

          dataRequest({
            type: "add",
            fileName: "pushData",
            item: {
              bookName,
              textOtherName,
              textType: "local",
              pt: p.pt,
              selectedFile,
              bt: bt1,
              bt2,
              bq,
              creativeStatement,
              filePath,
              useragent: this.ptConfig[p.pt].useragent,
              phone: p.phone,
              partition,
              url: this.ptConfig[p.pt].listIndex,
              uploadUrl: this.ptConfig[p.pt].upload,
              date: currentDate,
              publishMode: effectiveMode.publishMode,
              publishToDraft: effectiveMode.publishToDraft,
              publishAttemptCount: 1,
              republishCount: 0,
              publishSuccessCount: 0,
              publishFailCount: 0,
              publishStatus: effectiveMode.publishToDraft
                ? "drafting"
                : "publishing",
              lastPublishMessage: effectiveMode.publishToDraft
                ? "等待保存草稿结果"
                : "等待发布结果",
              lastPublishAt: Date.now(),
            },
          });

          submitted++;
          if (isXhsPlatform(p.pt)) {
            await sleep(getXhsPlatformStaggerDelayMs());
          } else if (p.pt === "视频号") {
            await sleep(4000);
          }
          if (effectiveMode.publishToDraft) draftSubmitted++;
        }
      }

      if (this.scheduledPublish && !isDraftMode) {
        await Promise.all(scheduledWriteTasks);
        ipcRenderer.send("scheduledPublish:refresh");
      }

      if (submitted === 0) {
        this.$message.warning("没有提交新的发布任务");
        return;
      }
      let successMessage = `已提交 ${submitted} 个目录批量发布任务`;
      if (draftSubmitted === submitted) {
        successMessage = `已提交 ${submitted} 个目录批量保存草稿任务`;
      } else if (scheduledSubmitted === submitted) {
        successMessage = `已创建 ${submitted} 个目录批量定时发布任务`;
      }
      this.$message.success(successMessage);
      this.platformVisible = false;
      this.dirBatchFiles = [];
      this.dirPath = "";
      this.dirXlsxRows = [];
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
.platform-leaf-proxy {
  margin-right: 4px;
  font-size: 12px;
  color: #409eff;
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
