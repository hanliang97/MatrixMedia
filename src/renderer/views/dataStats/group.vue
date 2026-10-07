<template>
  <div class="data-stats-group-page">
    <div class="page-head">
      <img v-if="ptIcon" class="pt-icon" :src="ptIcon" alt="" />
      <div class="head-text">
        <h2 class="page-title">{{ groupName }} · {{ platform }}</h2>
        <p v-if="lastCollectText" class="page-desc">上次同步：{{ lastCollectText }}</p>
      </div>
      <div class="head-actions">
        <el-button size="small" icon="el-icon-document" @click="openLogs">
          拉取记录
        </el-button>
        <el-button
          type="primary"
          size="small"
          icon="el-icon-refresh"
          :loading="syncing"
          @click="syncThis"
        >
          {{ syncing ? "同步中…" : "同步数据" }}
        </el-button>
      </div>
    </div>
    <collect-log-dialog :visible.sync="logVisible" :logs="logs" />
    <el-tabs v-model="activeTab" class="group-tabs">
      <el-tab-pane label="数据" name="stats">
        <stats-overview v-if="activeTab === 'stats'" :rows="rows" />
      </el-tab-pane>
      <el-tab-pane label="发布数据增长" name="growth">
        <publish-growth
          v-if="activeTab === 'growth'"
          :works="works"
          :syncing="syncing"
          :last-collect-at="meta.lastCollectAt"
          @sync="syncThis"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
import StatsOverview from "./components/StatsOverview.vue";
import PublishGrowth from "./components/PublishGrowth.vue";
import CollectLogDialog from "./components/CollectLogDialog.vue";
import { PT_ICONS } from "./ptIcons";
import { dailyToRows } from "./statsUtils";
import {
  buildCollectAccounts,
  collectAccounts,
  getAccountStats,
  getCollectLogs,
} from "@/utils/statsApi";

export default {
  name: "DataStatsGroup",
  components: { StatsOverview, PublishGrowth, CollectLogDialog },
  data() {
    return {
      activeTab: "stats",
      daily: {},
      works: [],
      meta: {},
      syncing: false,
      logVisible: false,
      logs: [],
    };
  },
  computed: {
    groupName() {
      return (this.$route.meta && this.$route.meta.phone) || "未命名分组";
    },
    platform() {
      return (this.$route.meta && this.$route.meta.pt) || "";
    },
    ptIcon() {
      return PT_ICONS[this.platform] || "";
    },
    rows() {
      return dailyToRows(this.daily);
    },
    lastCollectText() {
      if (!this.meta.lastCollectAt) return "";
      const d = new Date(this.meta.lastCollectAt);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
        d.getHours()
      )}:${p(d.getMinutes())}`;
    },
  },
  created() {
    this.refresh();
  },
  methods: {
    async refresh() {
      const data = await getAccountStats(this.groupName, this.platform);
      this.daily = data.daily || {};
      this.works = data.works || [];
      this.meta = data.meta || {};
    },
    async openLogs() {
      const all = await getCollectLogs();
      // 平台页只看本账号相关的记录（其它账号行灰显太多，直接过滤任务里无关行）
      this.logs = all
        .map((log) => ({
          ...log,
          results: (log.results || []).filter(
            (r) => r.group === this.groupName && r.platform === this.platform
          ),
        }))
        .filter((log) => log.results.length > 0);
      this.logVisible = true;
    },
    async syncThis() {
      if (this.syncing) return;
      const accounts = buildCollectAccounts(
        (g, p) => g === this.groupName && p === this.platform
      );
      if (!accounts.length) {
        this.$message.warning("该账号不存在或不参与统计");
        return;
      }
      this.syncing = true;
      try {
        const res = await collectAccounts(accounts);
        const first = (res.results || [])[0];
        if (first && first.success) {
          this.$message.success("数据已同步");
        } else {
          this.$message.warning((first && first.error) || res.error || "同步失败");
        }
      } finally {
        this.syncing = false;
        await this.refresh();
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.data-stats-group-page {
  padding: 20px;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.pt-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.page-title {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.page-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: #909399;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.group-tabs {
  margin-top: 8px;
}
</style>
