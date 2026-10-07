<template>
  <div class="stats-overview">
    <div class="stat-cards">
      <div v-for="card in cards" :key="card.key" class="stat-card">
        <div class="card-label">{{ card.label }}</div>
        <div class="card-value">{{ formatNumber(card.value) }}</div>
        <div
          class="card-delta"
          :class="{ down: card.delta < 0 }"
        >
          较昨日 {{ card.delta >= 0 ? "+" : "" }}{{ formatNumber(card.delta) }}
        </div>
      </div>
    </div>
    <div class="chart-card">
      <div class="chart-head">
        <span class="chart-title">数据趋势</span>
        <el-radio-group v-model="granularity" size="small">
          <el-radio-button label="day">日</el-radio-button>
          <el-radio-button label="week">周</el-radio-button>
          <el-radio-button label="month">月</el-radio-button>
        </el-radio-group>
      </div>
      <template v-if="rows.length">
        <stats-line-chart
          :labels="chartLabels"
          :datasets="chartDatasets"
          :height="240"
        />
        <div class="chart-foot">{{ rangeHint }}</div>
      </template>
      <div v-else class="chart-empty">
        暂无数据，点击右上角「同步数据」从平台拉取
      </div>
    </div>
  </div>
</template>

<script>
import StatsLineChart from "./StatsLineChart.vue";
import {
  pickDaily,
  pickWeekly,
  pickMonthly,
  STATS_METRICS,
} from "../statsUtils";

const RANGE_HINT = {
  day: "最近 30 天",
  week: "最近一个季度（按周）",
  month: "最近一年（按月）",
};

export default {
  name: "StatsOverview",
  components: { StatsLineChart },
  props: {
    // 日升序数据行：[{ date, label, fans, likes, comments, favorites, ... }]
    rows: { type: Array, default: () => [] },
  },
  data() {
    return {
      granularity: "day",
    };
  },
  computed: {
    cards() {
      const latest = this.rows[this.rows.length - 1] || {};
      const prev = this.rows[this.rows.length - 2] || latest;
      return STATS_METRICS.map((m) => ({
        key: m.key,
        label: m.label,
        value: latest[m.key] || 0,
        delta: (latest[m.key] || 0) - (prev[m.key] || 0),
      }));
    },
    viewRows() {
      if (this.granularity === "week") return pickWeekly(this.rows, 13);
      if (this.granularity === "month") return pickMonthly(this.rows, 12);
      return pickDaily(this.rows, 30);
    },
    chartLabels() {
      return this.viewRows.map((r) => r.label);
    },
    chartDatasets() {
      return STATS_METRICS.map((m) => ({
        key: m.key,
        name: m.label,
        color: m.color,
        values: this.viewRows.map((r) => r[m.key] || 0),
      }));
    },
    rangeHint() {
      return RANGE_HINT[this.granularity] || "";
    },
  },
  methods: {
    formatNumber(v) {
      return Number(v || 0).toLocaleString("zh-CN");
    },
  },
};
</script>

<style lang="scss" scoped>
@import "@/styles/variables.scss";

.stats-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stat-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.stat-card {
  background: #ffffff;
  border: 1px solid $borderColor;
  border-radius: 8px;
  padding: 10px 14px;
}

.card-label {
  font-size: 12px;
  color: #909399;
}

.card-value {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 700;
  color: #303133;
  font-variant-numeric: tabular-nums;
}

.card-delta {
  margin-top: 3px;
  font-size: 11px;
  color: #67c23a;

  &.down {
    color: #f56c6c;
  }
}

.chart-card {
  background: #ffffff;
  border: 1px solid $borderColor;
  border-radius: 8px;
  padding: 12px 14px;
}

.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.chart-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.chart-foot {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  text-align: right;
}

.chart-empty {
  padding: 60px 0;
  text-align: center;
  font-size: 13px;
  color: #909399;
}

@media (max-width: 1100px) {
  .stat-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
