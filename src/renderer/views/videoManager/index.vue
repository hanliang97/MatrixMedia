<template>
  <div class="container-box">
    <div class="toolbar">
      <el-button type="primary" @click="selectVideoFile">选择视频发布</el-button>
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
                <div
                  v-for="(sub, si) in scope.row.showAlltype"
                  :key="si"
                  class="status-row"
                >
                  <span class="pt-name" @click="copy(sub.videoLink)">{{ sub.pt }}</span>
                  <span
                    :class="{ fail: !sub.videoLink }"
                    @click="opPt(sub)"
                  >{{ sub.videoLink ? "通过" : "未通过" }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="phone" label="发布账号" />
            <el-table-column label="来源" width="72">
              <template>本地</template>
            </el-table-column>
            <el-table-column label="操作" width="200">
              <template slot-scope="scope">
                <el-button type="primary" size="mini" class="mb8" @click="getStatus(scope.row.showAlltype)">
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
                  <el-button slot="reference" type="danger" size="mini">删除</el-button>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </template>
    </div>

    <el-dialog
      :title="loginData.partition"
      :visible.sync="showLoginDialog"
      append-to-body
      destroy-on-close
      width="1200px"
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
      ptConfig,
      dataList: {},
      taskHandlers: new Map(),
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
          const mergeKey =
            row.textOtherName + "-" + row.textType + row.phone.split("-")[0] + row.selectedFile;
          if (!tempData[mergeKey]) {
            const copyRow = JSON.parse(JSON.stringify(row));
            copyRow.showAlltype = [JSON.parse(JSON.stringify(row))];
            tempData[mergeKey] = copyRow;
          } else {
            tempData[mergeKey].showAlltype.push(JSON.parse(JSON.stringify(row)));
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
