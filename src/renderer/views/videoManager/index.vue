<template>
  <div class="container-box">
    <div class="toolbar">
      <el-button type="primary" @click="selectVideoFile">选择视频发布</el-button>
      <el-button type="warning" @click="openQQGroup">加入作者QQ群</el-button>
    </div>

    <LocalVideoPublish ref="localPublishRef" @published="loadRecords" />

    <div class="info-box">
      <template v-for="(item, index) in dataList">
        <el-card v-if="item && item.length" :key="index" class="mb16">
          <div class="card-head">
            <span class="date-label">{{ index }}</span>
            <span class="hint">本地发布记录</span>
          </div>
          <el-table :data="item" border style="width: 100%">
            <el-table-column prop="textOtherName" label="名称" width="120" />
            <el-table-column prop="bt" label="标题" width="160" />
            <el-table-column prop="selectedFile" label="视频文件" width="140" />
            <el-table-column label="平台审核状态" width="200">
              <template slot-scope="scope">
                <div v-for="(sub, si) in scope.row.showAlltype" :key="si" class="status-row">
                  <span class="pt-name" @click="copy(sub.videoLink)">{{ sub.pt }}</span>
                  <span :class="{ fail: !sub.videoLink }" @click="opPt(sub)">{{ sub.videoLink ? "通过" : "未通过" }}</span>
                 
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="phone" label="发布账号" />
            <el-table-column label="发布进度" width="320">
              <template slot-scope="scope">
               
                <div v-for="(sub, si) in scope.row.showAlltype" :key="si" class="progress-row">
                  <span class="pt-name">{{ sub.pt }}</span>
                  <div class="progress-detail">
                    <span class="progress-count">重发 {{ normalizeCount(sub.republishCount) }} 次</span>
                    <span class="progress-count success">成功 {{ normalizeCount(sub.publishSuccessCount) }}</span>
                    <span class="progress-count fail">失败 {{ normalizeCount(sub.publishFailCount) }}</span>
                    <el-tag size="mini" :type="publishStatusType(sub.publishStatus)">{{ publishStatusText(sub.publishStatus) }}</el-tag>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="来源" width="72">
              <template>本地</template>
            </el-table-column>
            <el-table-column label="操作" width="260">
              <template slot-scope="scope">
                <el-button
                  type="primary"
                  size="mini"
                  class="mb8"
                  :loading="isStatusLoading(scope.row)"
                  :disabled="isStatusLoading(scope.row)"
                  @click="handleGetStatus(scope.row)"
                >
                  获取状态
                </el-button>
                <el-popconfirm confirm-button-text="删除" cancel-button-text="取消" icon="el-icon-info" icon-color="red" title="确定删除这条记录吗？" @confirm="handleDelete(scope.row, index, scope.$index)">
                  <el-button slot="reference" type="danger" size="mini">删除</el-button>
                </el-popconfirm>
                <el-button type="warning" size="mini" class="mb8" @click="handleRepublish(scope.row)">
                  重新发布
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </template>
    </div>

    <el-dialog :title="loginData.partition" :visible.sync="showLoginDialog" append-to-body destroy-on-close width="1200px">
      <webview v-if="loginData.url" :src="loginData.url" style="display: flex; width: 100%; height: 650px" webpreferences="javascript=yes" :httpreferrer="loginData.url" nodeintegrationinsubframes disablewebsecurity allowpopups :partition="loginData.partition.split('-')[0]" :key="loginData.partition.split('-')[0]" :useragent="ptConfig[loginData.pt].useragent" />
    </el-dialog>
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
import dataRequest from "@/utils/dataRequest";
import copyToClipboard from "@/utils/copy";
import ptConfig from "@/utils/configUrl";
import LocalVideoPublish from "@/components/LocalVideoPublish.vue";

export default {
  name: "VideoManager",
  components: {
    LocalVideoPublish,
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
      return [row.textOtherName || "", String(row.phone || "").split("-")[0], row.selectedFile || ""].join("-");
    },
    isStatusLoading(row) {
      const key = this.getStatusRowKey(row);
      return !!this.statusLoadingMap[key];
    },
    async handleGetStatus(row) {
      if (!row || this.isStatusLoading(row)) return;
      const key = this.getStatusRowKey(row);
      this.$set(this.statusLoadingMap, key, true);
      this.getStatus(row.showAlltype).catch(err => {
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
    normalizeCount(v) {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    },
    publishStatusType(status) {
      if (status === "success") return "success";
      if (status === "fail" || status === "failed" || status === "expired") return "danger";
      if (status === "scheduled") return "info";
      if (status === "draft") return "info";
      return "warning";
    },
    publishStatusText(status) {
      if (status === "success") return "成功";
      if (status === "fail" || status === "failed") return "失败";
      if (status === "scheduled") return "等待定时发布";
      if (status === "expired") return "任务过期";
      if (status === "draft") return "已保存草稿";
      if (status === "drafting") return "保存草稿中";
      return "发布中";
    },
    isPublishFailed(row) {
      if (!row) return false;
      if (["fail", "failed", "expired"].includes(String(row.publishStatus || ""))) return true;
      if (Number(row.publishFailCount) > 0 && Number(row.publishSuccessCount) === 0) return true;
      if (String(row.lastPublishMessage || "").includes("失败")) return true;
      if (String(row.lastPublishMessage || "").includes("过期")) return true;
      return false;
    },
    async handleRepublish(row) {
      const details = (row && row.showAlltype) || [];
      if (!details.length) {
        this.$message.warning("当前记录没有可重发的平台");
        return;
      }
      let filePath = details.map(v => v && v.filePath).find(Boolean);
      if (!filePath) {
        this.$message.info("历史记录缺少视频路径，请先重新选择视频文件。");
        filePath = await ipcRenderer.invoke("dialog:openVideoFile");
        if (!filePath) {
          this.$message.warning("未选择视频文件，已取消重发。");
          return;
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
      const failedTargets = details
        .filter(this.isPublishFailed)
        .map(v => ({
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
          address: sample.address || "",
        },
        records: details.map(v => ({
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
        this.$message.info("未检测到失败平台，已打开发布弹窗，请手动勾选需要重发的平台。");
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
      if (!Number.isFinite(copyRow.republishCount) || copyRow.republishCount < 0) {
        copyRow.republishCount = Math.max(0, attemptCount - 1);
      }
      copyRow.publishSuccessCount = this.normalizeCount(copyRow.publishSuccessCount);
      copyRow.publishFailCount = this.normalizeCount(copyRow.publishFailCount);
      copyRow.publishStatus = copyRow.publishStatus || "publishing";
      return copyRow;
    },
    findLocalPublishRecord(donePayload) {
      const textOtherName = donePayload.textOtherName || (donePayload.data && donePayload.data.textOtherName) || "";
      const selectedFile = donePayload.selectedFile || this.getFileName(donePayload.filePath);
      const pt = donePayload.pt;
      const phone = String(donePayload.phone || "").split("-")[0];
      const dateKeys = Object.keys(this.dataList || {});
      for (const dateKey of dateKeys) {
        const dayRows = this.dataList[dateKey] || [];
        for (const row of dayRows) {
          const details = row.showAlltype || [];
          for (const sub of details) {
            const subPhone = String(sub.phone || "").split("-")[0];
            if (
              sub.textType === "local" &&
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
      if (!donePayload || donePayload.textType !== "local") return;
      if (!donePayload.pt || String(donePayload.pt).includes("状态") || String(donePayload.pt).includes("登录")) return;
      const target = this.findLocalPublishRecord(donePayload);
      if (!target || !target.row || !target.row.id) return;
      const row = this.fillPublishStats(target.row);
      const success = !!donePayload.status;
      const isDraftMode = donePayload.publishMode === "draft" || donePayload.publishToDraft === true;
      await dataRequest({
        type: "update",
        fileName: "pushData",
        item: {
          id: row.id,
          date: target.date,
          publishSuccessCount: success ? row.publishSuccessCount + 1 : row.publishSuccessCount,
          publishFailCount: success ? row.publishFailCount : row.publishFailCount + 1,
          publishMode: isDraftMode ? "draft" : row.publishMode || "publish",
          publishStatus: success ? (isDraftMode ? "draft" : "success") : "failed",
          lastPublishMessage: donePayload.message || (success ? (isDraftMode ? "保存草稿成功" : "发布成功") : "发布失败"),
          lastPublishAt: Date.now(),
        },
      });
      this.loadRecords();
    },
    openQQGroup() {
      window.open("https://qm.qq.com/cgi-bin/qm/qr?k=NLsaKNd7gqbOeW_JXNg7bRreFtcLKXmp&jump_from=webapi&authKey=Nd/DrSrJWaH+Nip9gEIGse4LdHWpLkp8bVfcKwinOk4hI8XfNTDvGf/smQgZvWHT", "_blank");
    },
    async selectVideoFile() {
      const path = await ipcRenderer.invoke("dialog:openVideoFile");
      if (path) {
        this.$refs.localPublishRef.open(path);
      }
    },

    loadRecords() {
      dataRequest({
        type: "get",
        fileName: "pushData",
      }).then(r => {
        this.initDataFiltered(r.data || {});
      });
    },

    initDataFiltered(data) {
      const tempObj = {};
      this.dataList = {};
      for (const key in data) {
        const tempData = {};
        const list = data[key] || [];
        list.forEach(row => {
          if (row.textType !== "local") return;
          const mergeKey = row.textOtherName + "-" + row.textType + row.phone.split("-")[0] + row.selectedFile;
          if (!tempData[mergeKey]) {
            const copyRow = this.fillPublishStats(JSON.parse(JSON.stringify(row)));
            copyRow.showAlltype = [this.fillPublishStats(JSON.parse(JSON.stringify(row)))];
            tempData[mergeKey] = copyRow;
          } else {
            tempData[mergeKey].showAlltype.push(this.fillPublishStats(JSON.parse(JSON.stringify(row))));
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

    opPt(item) {
      this.loginData = item;
      this.showLoginDialog = true;
    },

    getStatus(arr) {
      const arrAll = new Promise(resolve => {
        let acLen = 0;
        let acLen2 = 0;
        const total = arr.length;
        if (total === 0) {
          resolve();
          return;
        }
        arr.forEach(item => {
          if (!item.videoLink) {
            const taskId = Date.now() + Math.random();
            ipcRenderer.send("puppeteerFile", {
              show: false,
              taskId,
              ...item,
              pt: item.pt + "状态",
              statusCalss: (this.statusCalss || "").trim(),
            });
            this.taskHandlers.set(taskId, data => {
              acLen++;
              if (data.url && data.status) {
                acLen2++;
                const payload = JSON.parse(JSON.stringify(item));
                delete payload.showAlltype;
                dataRequest({
                  type: "update",
                  fileName: "pushData",
                  item: {
                    ...payload,
                    status: !!data.url,
                    videoLink: data.url,
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
      return new Promise(resolve => {
        arrAll.then(() => {
          dataRequest({
            type: "get",
            fileName: "pushData",
          }).then(r => {
            this.initDataFiltered(r.data || {});
            resolve();
          });
        });
      });
    },

    handleDelete(item, dateKey, idx) {
      const promises = item.showAlltype.map(v =>
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
.container-box {
  height: calc(100vh - 100px);
  overflow-y: auto;
  padding: 20px;
}

.toolbar {
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-box {
  min-height: 200px;
}

.mb16 {
  margin-bottom: 16px;
}

.mb8 {
  margin-bottom: 8px;
}

.card-head {
  display: flex;
  align-items: center;
  padding-bottom: 10px;
}

.date-label {
  color: #c00;
  margin-right: 12px;
}

.hint {
  font-size: 13px;
  color: #666;
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
