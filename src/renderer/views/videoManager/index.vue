<template>
  <div class="page-shell video-manager-page">
    <div class="page-header">
      <h1 class="page-title">视频管理</h1>
      <p class="page-desc">选择视频或目录发布，查看本地发布记录与审核状态</p>
    </div>

    <div class="toolbar section-card el-card is-never-shadow">
      <div class="toolbar-inner">
        <div class="toolbar-left">
          <span class="toolbar-label">发布操作</span>
          <el-button type="primary" @click="selectVideoFile"
            >选择视频发布</el-button
          >
          <el-button type="primary" plain @click="openDirectoryPublish"
            >目录发布</el-button
          >
          <el-button type="success" @click="openArticlePublish"
            >发布文章</el-button
          >
        </div>
        <div class="toolbar-right">
          <span class="toolbar-label">帮助</span>
          <el-button type="warning" plain @click="openFeedback"
            >问题反馈</el-button
          >
          <el-button type="warning" plain @click="openQQGroup"
            >加入作者QQ群</el-button
          >
        </div>
      </div>
    </div>

    <LocalVideoPublish ref="localPublishRef" @published="loadRecords" />
    <LocalArticlePublish ref="articlePublishRef" @published="loadRecords" />

    <div class="info-box">
      <template v-for="(item, index) in dataList">
        <el-card
          v-if="item && item.length"
          :key="index"
          class="section-card record-card"
          shadow="never"
        >
          <div slot="header" class="card-header">
            <span class="date-label">{{ index }}</span>
            <span class="card-sub">本地发布记录</span>
          </div>
          <el-table :data="item" border style="width: 100%">
            <el-table-column prop="bt" label="标题" min-width="180" />
            <el-table-column prop="phone" label="发布分组" min-width="120" />
            <el-table-column label="发布进度" min-width="320">
              <template slot-scope="scope">
                <div
                  v-for="(sub, si) in scope.row.showAlltype"
                  :key="si"
                  class="progress-row"
                >
                  <span class="pt-name">{{ sub.pt }}</span>
                  <div class="progress-detail">
                    <span class="progress-count"
                      >重发 {{ normalizeCount(sub.republishCount) }} 次</span
                    >
                    <span class="progress-count success"
                      >成功 {{ normalizeCount(sub.publishSuccessCount) }}</span
                    >
                    <span class="progress-count fail"
                      >失败 {{ normalizeCount(sub.publishFailCount) }}</span
                    >
                    <el-tag
                      size="mini"
                      :type="publishStatusType(sub.publishStatus)"
                      >{{ publishStatusText(sub.publishStatus) }}</el-tag
                    >
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="260">
              <template slot-scope="scope">
                <el-button
                  v-if="canGetStatus(scope.row)"
                  type="primary"
                  size="mini"
                  class="mb8"
                  :loading="isStatusLoading(scope.row)"
                  :disabled="isStatusLoading(scope.row)"
                  @click="handleGetStatus(scope.row)"
                >
                  获取状态
                </el-button>
                <el-popconfirm
                  confirm-button-text="删除"
                  cancel-button-text="取消"
                  icon="el-icon-info"
                  icon-color="red"
                  title="确定删除这条记录吗？"
                  @confirm="handleDelete(scope.row, index, scope.$index)"
                >
                  <el-button slot="reference" type="danger" size="mini"
                    >删除</el-button
                  >
                </el-popconfirm>
                <el-button
                  v-if="canRepublish(scope.row)"
                  type="warning"
                  size="mini"
                  class="mb8"
                  @click="handleRepublish(scope.row)"
                >
                  重新发布
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </template>
    </div>

    <!-- 旧的 <webview> 登录弹窗已迁移到主进程独立 BrowserWindow -->
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
import dataRequest from "@/utils/dataRequest";
import copyToClipboard from "@/utils/copy";
import ptConfig from "@/utils/configUrl";
import openLoginWindow from "@/utils/openLoginWindow";
import LocalVideoPublish from "@/components/LocalVideoPublish.vue";
import LocalArticlePublish from "@/components/LocalArticlePublish.vue";

export default {
  name: "VideoManager",
  components: {
    LocalVideoPublish,
    LocalArticlePublish,
  },
  data() {
    return {
      // 抖音获取发布状态的class名称
      statusCalss: ".video-card-zQ02ng",
      ptConfig,
      dataList: {},
      taskHandlers: new Map(),
      statusLoadingMap: {},
      loginData: {},
      showLoginDialog: false,
    };
  },
  mounted() {
    this._onPuppeteerDone = (event, data) => {
      const { taskId } = data;
      const handler = this.taskHandlers.get(taskId);
      if (handler) {
        handler(data);
        this.taskHandlers.delete(taskId);
      } else {
        this.syncPublishProgress(data);
      }
    };
    ipcRenderer.on("puppeteerFile-done", this._onPuppeteerDone);
  },
  beforeDestroy() {
    ipcRenderer.removeListener("puppeteerFile-done", this._onPuppeteerDone);
  },
  activated() {
    this.loadRecords();
  },
  methods: {
    copy: copyToClipboard,
    getStatusRowKey(row) {
      if (!row) return "";
      return [
        row.textOtherName || "",
        String(row.phone || "").split("-")[0],
        row.selectedFile || "",
      ].join("-");
    },
    isStatusLoading(row) {
      const key = this.getStatusRowKey(row);
      return !!this.statusLoadingMap[key];
    },
    async handleGetStatus(row) {
      if (!this.canGetStatus(row) || this.isStatusLoading(row)) return;
      const canContinue = await this.confirmAndInterruptUploadingTasks();
      if (!canContinue) return;
      const key = this.getStatusRowKey(row);
      this.$set(this.statusLoadingMap, key, true);
      this.getStatus(row.showAlltype).catch((err) => {
        console.error("获取状态失败:", err);
      });
      setTimeout(() => {
        this.$set(this.statusLoadingMap, key, false);
        this.$alert("状态获取处理中，请等待 1-2 分钟后再查看结果。", "声明", {
          confirmButtonText: "知道了",
          type: "warning",
        });
      }, 10000);
    },
    canGetStatus(row) {
      if (!row) return false;
      if (row.textType !== "article") return true;
      return (row.showAlltype || [row]).some(
        (item) => item && item.textType === "article" && item.pt === "掘金"
      );
    },
    isUploadingPublishStatus(status) {
      return ["publishing", "drafting"].includes(String(status || ""));
    },
    getUploadingPublishRecords() {
      const recordMap = new Map();
      Object.values(this.dataList || {}).forEach((rows) => {
        (rows || []).forEach((row) => {
          (row.showAlltype || []).forEach((sub) => {
            if (
              sub &&
              sub.id &&
              sub.date &&
              this.isUploadingPublishStatus(sub.publishStatus)
            ) {
              recordMap.set(`${sub.date}-${sub.id}`, sub);
            }
          });
        });
      });
      return Array.from(recordMap.values());
    },
    async confirmAndInterruptUploadingTasks() {
      const records = this.getUploadingPublishRecords();
      if (records.length === 0) return true;
      try {
        await this.$confirm(
          `当前存在 ${records.length} 个发布中任务。获取状态会中断上传，确认后会将全部上传中任务标记为失败，并主动打断上传任务。是否继续？`,
          "获取状态",
          {
            confirmButtonText: "确认中断并获取状态",
            cancelButtonText: "取消",
            type: "warning",
          }
        );
      } catch (_) {
        return false;
      }
      ipcRenderer.send("puppeteerFile:cancelAll", {
        reason: "获取状态已中断上传",
      });
      await Promise.all(
        records.map((item) =>
          dataRequest({
            type: "update",
            fileName: "pushData",
            item: {
              id: item.id,
              date: item.date,
              publishStatus: "failed",
              publishFailCount: this.normalizeCount(item.publishFailCount) + 1,
              lastPublishMessage: "获取状态已中断上传",
              lastPublishAt: Date.now(),
            },
          })
        )
      );
      this.loadRecords();
      this.$message.warning("已中断上传任务，并将上传中记录标记为失败。");
      return true;
    },
    normalizeCount(v) {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    },
    publishStatusType(status) {
      if (status === "success") return "success";
      if (status === "fail" || status === "failed" || status === "expired")
        return "danger";
      if (status === "scheduled" || status === "skipped") return "info";
      if (status === "draft") return "info";
      return "warning";
    },
    publishStatusText(status) {
      if (status === "success") return "成功";
      if (status === "fail" || status === "failed") return "失败";
      if (status === "scheduled") return "等待定时发布";
      if (status === "skipped") return "已跳过";
      if (status === "expired") return "任务过期";
      if (status === "draft") return "已保存草稿";
      if (status === "drafting") return "保存草稿中";
      return "发布中";
    },
    isPublishFailed(row) {
      if (!row) return false;
      if (
        ["fail", "failed", "expired"].includes(String(row.publishStatus || ""))
      )
        return true;
      if (
        Number(row.publishFailCount) > 0 &&
        Number(row.publishSuccessCount) === 0
      )
        return true;
      if (String(row.lastPublishMessage || "").includes("失败")) return true;
      if (String(row.lastPublishMessage || "").includes("过期")) return true;
      return false;
    },
    canRepublish(row) {
      return row && (row.textType === "local" || row.textType === "article");
    },
    async handleRepublish(row) {
      const details = (row && row.showAlltype) || [];
      if (!details.length) {
        this.$message.warning("当前记录没有可重发的平台");
        return;
      }
      if (row.textType === "article") {
        const sample = details[0] || {};
        const failedTargets = details.filter(this.isPublishFailed).map((v) => ({
          pt: v.pt,
          phone: String(v.phone || "").split("-")[0],
        }));
        const ok = this.$refs.articlePublishRef.openRepublish({
          sample,
          records: details.map((v) => ({
            id: v.id,
            date: v.date,
            pt: v.pt,
            phone: String(v.phone || "").split("-")[0],
            publishAttemptCount: Number(v.publishAttemptCount) || 1,
            republishCount: Number(v.republishCount),
          })),
          failedTargets,
        });
        if (!ok) return;
        if (failedTargets.length === 0) {
          this.$message.info(
            "未检测到失败平台，已打开发布弹窗，请手动勾选需要重发的平台。"
          );
        }
        return;
      }
      let filePath = details.map((v) => v && v.filePath).find(Boolean);
      const remoteFileUrl = details
        .map((v) => v && v.remoteFileUrl)
        .find(Boolean);
      const localFileExists =
        filePath && (await ipcRenderer.invoke("fs:existsSync", filePath));
      if (!filePath || (!localFileExists && !remoteFileUrl)) {
        if (!localFileExists && filePath) {
          this.$message.info("本地视频文件已不存在，请重新选择视频文件。");
        } else {
          this.$message.info("历史记录缺少视频路径，请先重新选择视频文件。");
        }
        filePath = await ipcRenderer.invoke("dialog:openVideoFile");
        if (!filePath) {
          this.$message.warning("未选择视频文件，已取消重发。");
          return;
        }
      } else if (!localFileExists && remoteFileUrl) {
        // 本地文件已删除但有远程 URL，先下载到本地再重发
        try {
          await this.$confirm(
            "本地视频文件已清理，是否从远程地址重新下载？",
            "重新发布",
            {
              confirmButtonText: "重新下载",
              cancelButtonText: "手动选择文件",
              distinguishCancelAndClose: true,
              type: "warning",
            }
          );
          const loading = this.$loading({
            lock: true,
            text: "正在下载远程视频…",
            background: "rgba(0, 0, 0, 0.7)",
          });
          try {
            filePath = await ipcRenderer.invoke(
              "publish:downloadRemoteFile",
              remoteFileUrl
            );
            this.$message.success("远程视频下载完成");
          } catch (dlErr) {
            this.$message.error(
              "远程视频下载失败: " + (dlErr.message || dlErr)
            );
            return;
          } finally {
            loading.close();
          }
        } catch (action) {
          if (action === "close") {
            this.$message.info("已取消重发。");
            return;
          }
          // 用户选择手动选择文件
          filePath = await ipcRenderer.invoke("dialog:openVideoFile");
          if (!filePath) {
            this.$message.warning("未选择视频文件，已取消重发。");
            return;
          }
        }
      } else {
        let shouldChooseNewVideo = false;
        try {
          await this.$confirm("是否重新选择视频文件后再重发？", "重新发布", {
            confirmButtonText: "重新选择视频",
            cancelButtonText: "沿用原视频",
            distinguishCancelAndClose: true,
            type: "warning",
          });
          shouldChooseNewVideo = true;
        } catch (action) {
          if (action === "close") {
            this.$message.info("已取消重发。");
            return;
          }
        }
        if (shouldChooseNewVideo) {
          const selectedPath = await ipcRenderer.invoke("dialog:openVideoFile");
          if (!selectedPath) {
            this.$message.warning("未选择视频文件，已取消重发。");
            return;
          }
          filePath = selectedPath;
        }
      }

      const sample = details[0] || {};
      const failedTargets = details.filter(this.isPublishFailed).map((v) => ({
        pt: v.pt,
        phone: String(v.phone || "").split("-")[0],
      }));

      const ok = this.$refs.localPublishRef.openRepublish({
        filePath,
        textOtherName: sample.textOtherName || "",
        form: {
          title: sample.bookName || sample.textOtherName || "",
          bt1: sample.bt || "",
          bt2: sample.bt2 || sample.bt || "",
          bq: sample.bq || "",
          creativeStatement: sample.creativeStatement,
        },
        records: details.map((v) => ({
          id: v.id,
          date: v.date,
          pt: v.pt,
          phone: String(v.phone || "").split("-")[0],
          publishAttemptCount: Number(v.publishAttemptCount) || 1,
          republishCount: Number(v.republishCount),
        })),
        failedTargets,
      });
      if (!ok) return;
      if (failedTargets.length === 0) {
        this.$message.info(
          "未检测到失败平台，已打开发布弹窗，请手动勾选需要重发的平台。"
        );
      }
    },
    getFileName(filePath) {
      if (!filePath) return "";
      const s = String(filePath).replace(/\\/g, "/");
      const arr = s.split("/");
      return arr[arr.length - 1] || "";
    },
    fillPublishStats(row) {
      const copyRow = { ...row };
      const attemptCount = Number(copyRow.publishAttemptCount) || 1;
      copyRow.publishAttemptCount = attemptCount;
      copyRow.republishCount = Number(copyRow.republishCount);
      if (
        !Number.isFinite(copyRow.republishCount) ||
        copyRow.republishCount < 0
      ) {
        copyRow.republishCount = Math.max(0, attemptCount - 1);
      }
      copyRow.publishSuccessCount = this.normalizeCount(
        copyRow.publishSuccessCount
      );
      copyRow.publishFailCount = this.normalizeCount(copyRow.publishFailCount);
      copyRow.publishStatus = copyRow.publishStatus || "publishing";
      return copyRow;
    },
    recordValue(value) {
      return String(value || "");
    },
    getRecordPhone(row) {
      return String((row && row.phone) || "").split("-")[0];
    },
    getArticleField(row, key) {
      if (!row) return "";
      if (row[key] !== undefined && row[key] !== null)
        return this.recordValue(row[key]);
      const data = row.data || {};
      return this.recordValue(data[key]);
    },
    getArticleTags(row) {
      if (!row) return "";
      const data = row.data || {};
      return this.recordValue(row.bq || row.tags || data.bq || data.tags);
    },
    buildArticleMergeKey(row) {
      return [
        this.recordValue(row && row.textOtherName),
        this.recordValue(row && row.textType),
        this.getRecordPhone(row),
        this.recordValue(row && row.partition),
        this.recordValue(row && row.selectedFile),
        this.getArticleField(row, "content"),
        this.getArticleField(row, "articleFilePath"),
        this.getArticleField(row, "coverPath"),
        this.getArticleField(row, "category"),
        this.getArticleTags(row),
        this.getArticleField(row, "summary"),
      ].join("\u0001");
    },
    isSameArticlePublishRecord(record, target) {
      return (
        this.buildArticleMergeKey(record) === this.buildArticleMergeKey(target)
      );
    },
    findLocalPublishRecord(donePayload) {
      const textType = donePayload.textType || "local";
      const textOtherName =
        donePayload.textOtherName ||
        (donePayload.data && donePayload.data.textOtherName) ||
        "";
      const selectedFile =
        donePayload.selectedFile || this.getFileName(donePayload.filePath);
      const pt = donePayload.pt;
      const phone = String(donePayload.phone || "").split("-")[0];
      const dateKeys = Object.keys(this.dataList || {});
      for (const dateKey of dateKeys) {
        const dayRows = this.dataList[dateKey] || [];
        for (const row of dayRows) {
          const details = row.showAlltype || [];
          for (const sub of details) {
            const subPhone = String(sub.phone || "").split("-")[0];
            if (textType === "article") {
              if (
                sub.textType === "article" &&
                sub.pt === pt &&
                this.isSameArticlePublishRecord(sub, donePayload)
              ) {
                return { date: dateKey, row: sub };
              }
              continue;
            }
            if (
              sub.textType === textType &&
              sub.pt === pt &&
              sub.textOtherName === textOtherName &&
              sub.selectedFile === selectedFile &&
              subPhone === phone
            ) {
              return { date: dateKey, row: sub };
            }
          }
        }
      }
      return null;
    },
    async syncPublishProgress(donePayload) {
      if (!donePayload || !["local", "article"].includes(donePayload.textType))
        return;
      if (donePayload.interrupted) return;
      if (
        !donePayload.pt ||
        String(donePayload.pt).includes("状态") ||
        String(donePayload.pt).includes("登录")
      )
        return;
      const target = this.findLocalPublishRecord(donePayload);
      if (!target || !target.row || !target.row.id) return;
      const row = this.fillPublishStats(target.row);
      if (donePayload.skipped) {
        await dataRequest({
          type: "update",
          fileName: "pushData",
          item: {
            id: row.id,
            date: target.date,
            publishStatus: "skipped",
            lastPublishMessage:
              donePayload.message || "用户关闭窗口，已跳过发布",
            lastPublishAt: Date.now(),
          },
        });
        this.loadRecords();
        return;
      }
      const success = !!donePayload.status;
      const isDraftMode =
        donePayload.publishMode === "draft" ||
        donePayload.publishToDraft === true;
      await dataRequest({
        type: "update",
        fileName: "pushData",
        item: {
          id: row.id,
          date: target.date,
          publishSuccessCount: success
            ? row.publishSuccessCount + 1
            : row.publishSuccessCount,
          publishFailCount: success
            ? row.publishFailCount
            : row.publishFailCount + 1,
          publishMode: isDraftMode ? "draft" : row.publishMode || "publish",
          publishStatus: success
            ? isDraftMode
              ? "draft"
              : "success"
            : "failed",
          lastPublishMessage:
            donePayload.message ||
            (success
              ? isDraftMode
                ? "保存草稿成功"
                : "发布成功"
              : "发布失败"),
          lastPublishAt: Date.now(),
        },
      });
      this.loadRecords();
    },
    openFeedback() {
      window.open("https://wj.qq.com/s2/26701780/6de3/", "_blank");
    },
    openQQGroup() {
      window.open(
        "https://qm.qq.com/cgi-bin/qm/qr?k=NLsaKNd7gqbOeW_JXNg7bRreFtcLKXmp&jump_from=webapi&authKey=Nd/DrSrJWaH+Nip9gEIGse4LdHWpLkp8bVfcKwinOk4hI8XfNTDvGf/smQgZvWHT",
        "_blank"
      );
    },
    async selectVideoFile() {
      const path = await ipcRenderer.invoke("dialog:openVideoFile");
      if (path) {
        this.$refs.localPublishRef.open(path);
      }
    },
    async openDirectoryPublish() {
      this.$refs.localPublishRef.openDirectory();
    },
    openArticlePublish() {
      this.$refs.articlePublishRef.open();
    },

    loadRecords() {
      dataRequest({
        type: "get",
        fileName: "pushData",
      }).then((r) => {
        this.initDataFiltered(r.data || {});
      });
    },

    initDataFiltered(data) {
      const tempObj = {};
      this.dataList = {};
      for (const key in data) {
        const tempData = {};
        const list = data[key] || [];
        list.forEach((row) => {
          if (!["local", "article"].includes(row.textType)) return;
          const mergeKey =
            row.textType === "article"
              ? this.buildArticleMergeKey(row)
              : row.textOtherName +
                "-" +
                row.textType +
                this.getRecordPhone(row) +
                row.selectedFile;
          if (!tempData[mergeKey]) {
            const copyRow = this.fillPublishStats(
              JSON.parse(JSON.stringify(row))
            );
            copyRow.showAlltype = [
              this.fillPublishStats(JSON.parse(JSON.stringify(row))),
            ];
            tempData[mergeKey] = copyRow;
          } else {
            tempData[mergeKey].showAlltype.push(
              this.fillPublishStats(JSON.parse(JSON.stringify(row)))
            );
          }
        });
        if (Object.keys(tempData).length) {
          tempObj[key] = tempData;
        }
      }
      for (const key in tempObj) {
        const v = Object.values(tempObj[key]).reverse();
        this.$set(this.dataList, key, v);
      }
    },

    async opPt(item) {
      try {
        const result = await openLoginWindow(item);
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
    },

    getStatus(arr) {
      const isJuejinArticle = (item) =>
        item && item.textType === "article" && item.pt === "掘金";
      const targets = (arr || []).filter(
        (item) => item && (item.textType !== "article" || isJuejinArticle(item))
      );
      const arrAll = new Promise((resolve) => {
        let acLen = 0;
        let acLen2 = 0;
        const total = targets.length;
        if (total === 0) {
          resolve();
          return;
        }
        targets.forEach((item) => {
          if (!item.videoLink) {
            const taskId = Date.now() + Math.random();
            // JSON 兜底序列化，避免 Vue 响应式代理 / 不可克隆对象触发 IPC 错误
            ipcRenderer.send(
              "puppeteerFile",
              JSON.parse(
                JSON.stringify({
                  show: false,
                  taskId,
                  ...item,
                  title: item.title || item.bt || item.textOtherName || "",
                  pt: item.pt + "状态",
                  statusCalss: (this.statusCalss || "").trim(),
                })
              )
            );
            this.taskHandlers.set(taskId, (data) => {
              acLen++;
              const statusUrl =
                data.url ||
                (isJuejinArticle(item) && this.ptConfig[item.pt]
                  ? this.ptConfig[item.pt].listIndex
                  : "");
              if (statusUrl && data.status) {
                acLen2++;
                const payload = JSON.parse(JSON.stringify(item));
                delete payload.showAlltype;
                dataRequest({
                  type: "update",
                  fileName: "pushData",
                  item: {
                    ...payload,
                    status: true,
                    videoLink: statusUrl,
                  },
                });
              } else {
                console.log("获取视频链接失败:", item);
              }
              if (acLen === total) {
                resolve();
              }
            });
          } else {
            acLen++;
            if (acLen === total) {
              resolve();
            }
          }
        });
      });
      return new Promise((resolve) => {
        arrAll.then(() => {
          dataRequest({
            type: "get",
            fileName: "pushData",
          }).then((r) => {
            this.initDataFiltered(r.data || {});
            resolve();
          });
        });
      });
    },

    handleDelete(item, dateKey, idx) {
      const promises = item.showAlltype.map((v) =>
        dataRequest({
          type: "delete",
          fileName: "pushData",
          item: {
            id: v.id,
            date: dateKey,
          },
        })
      );
      Promise.all(promises).then(() => {
        this.dataList[dateKey].splice(idx, 1);
        if (this.dataList[dateKey].length === 0) {
          this.$delete(this.dataList, dateKey);
        }
      });
    },
  },
};
</script>

<style lang="scss" scoped>
@import "@/styles/variables.scss";

.toolbar {
  margin-bottom: 16px;
  padding: 16px 20px;
  background: $cardBg;
  border: 1px solid $borderColor;
  border-radius: 4px;
}

.toolbar-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.toolbar-label {
  font-size: 13px;
  color: #909399;
  margin-right: 4px;
}

.info-box {
  min-height: 120px;
}

.record-card {
  ::v-deep .el-card__body {
    padding-top: 0;
  }
}

.mb8 {
  margin-bottom: 8px;
}

.date-label {
  color: #303133;
  font-weight: 600;
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.progress-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.progress-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 300px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.progress-count {
  font-size: 12px;
  color: #666;
}

.progress-count.success {
  color: #2e8b57;
}

.progress-count.fail {
  cursor: default;
}

.pt-name {
  cursor: pointer;
  width: 60%;
  word-break: break-all;
}

.fail {
  color: #c00;
  cursor: pointer;
}
</style>
