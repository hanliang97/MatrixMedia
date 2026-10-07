<template>
  <div ref="wrap" class="stats-line-chart">
    <div class="chart-legend">
      <span
        v-for="ds in datasets"
        :key="ds.key"
        class="legend-item"
        :class="{ off: hiddenKeys[ds.key] }"
        @click="toggle(ds.key)"
      >
        <i class="legend-dot" :style="{ background: ds.color }"></i>
        {{ ds.name }}
      </span>
    </div>
    <div
      class="chart-body"
      @mousemove="onMove"
      @mouseleave="hoverIndex = -1"
    >
      <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`">
        <g v-for="(t, i) in yTicks" :key="'y' + i">
          <line
            :x1="padL"
            :x2="width - padR"
            :y1="yPos(t)"
            :y2="yPos(t)"
            class="grid-line"
          />
          <text
            :x="padL - 8"
            :y="yPos(t) + 4"
            text-anchor="end"
            class="axis-text"
          >
            {{ formatTick(t) }}
          </text>
        </g>
        <text
          v-for="(lb, i) in visibleXLabels"
          :key="'x' + i"
          :x="xPos(lb.index)"
          :y="height - 8"
          text-anchor="middle"
          class="axis-text"
        >
          {{ lb.text }}
        </text>
        <path
          v-for="ds in visibleDatasets"
          :key="ds.key"
          :d="linePath(ds)"
          fill="none"
          :stroke="ds.color"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <g v-for="ds in visibleDatasets" :key="'pts' + ds.key">
          <circle
            v-for="(v, i) in ds.values"
            :key="i"
            :cx="xPos(i)"
            :cy="yPos(v)"
            :r="hoverIndex === i ? 4 : 2"
            :fill="ds.color"
          />
        </g>
        <line
          v-if="hoverIndex >= 0"
          :x1="xPos(hoverIndex)"
          :x2="xPos(hoverIndex)"
          :y1="padT"
          :y2="height - padB"
          class="hover-line"
        />
      </svg>
      <div
        v-if="hoverIndex >= 0"
        class="chart-tooltip"
        :style="tooltipStyle"
      >
        <div class="tip-title">{{ labels[hoverIndex] }}</div>
        <div
          v-for="ds in visibleDatasets"
          :key="ds.key"
          class="tip-row"
        >
          <i class="legend-dot" :style="{ background: ds.color }"></i>
          <span class="tip-name">{{ ds.name }}</span>
          <span class="tip-value">{{ formatNumber(ds.values[hoverIndex]) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
const TICK_COUNT = 5;
const MAX_X_LABELS = 8;

export default {
  name: "StatsLineChart",
  props: {
    labels: { type: Array, required: true },
    // [{ key, name, color, values: Number[] }]
    datasets: { type: Array, required: true },
    height: { type: Number, default: 320 },
  },
  data() {
    return {
      width: 720,
      padL: 56,
      padR: 16,
      padT: 16,
      padB: 32,
      hoverIndex: -1,
      hiddenKeys: {},
    };
  },
  computed: {
    innerW() {
      return Math.max(1, this.width - this.padL - this.padR);
    },
    innerH() {
      return Math.max(1, this.height - this.padT - this.padB);
    },
    visibleDatasets() {
      return this.datasets.filter((ds) => !this.hiddenKeys[ds.key]);
    },
    yMax() {
      let max = 0;
      this.visibleDatasets.forEach((ds) => {
        ds.values.forEach((v) => {
          if (v > max) max = v;
        });
      });
      return this.niceCeil(max || 1);
    },
    yTicks() {
      const ticks = [];
      for (let i = 0; i <= TICK_COUNT; i++) {
        ticks.push((this.yMax / TICK_COUNT) * i);
      }
      return ticks;
    },
    visibleXLabels() {
      const n = this.labels.length;
      if (!n) return [];
      const step = Math.max(1, Math.ceil(n / MAX_X_LABELS));
      const out = [];
      for (let i = 0; i < n; i += step) {
        out.push({ index: i, text: this.labels[i] });
      }
      const last = n - 1;
      if (last % step !== 0) out.push({ index: last, text: this.labels[last] });
      return out;
    },
    tooltipStyle() {
      const x = this.xPos(this.hoverIndex);
      // 靠近右边缘时 tooltip 翻到竖线左侧，避免溢出
      const flip = x > this.width - 180;
      return {
        left: x + "px",
        transform: flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
      };
    },
  },
  watch: {
    // 日/周/月切换后数据点数量变化，重置 hover 避免越界
    labels() {
      this.hoverIndex = -1;
    },
  },
  mounted() {
    this.measure();
    if (typeof ResizeObserver !== "undefined" && this.$refs.wrap) {
      this._ro = new ResizeObserver(() => this.measure());
      this._ro.observe(this.$refs.wrap);
    } else {
      window.addEventListener("resize", this.measure);
    }
  },
  beforeDestroy() {
    if (this._ro) this._ro.disconnect();
    window.removeEventListener("resize", this.measure);
  },
  methods: {
    measure() {
      if (this.$refs.wrap) {
        this.width = Math.max(320, this.$refs.wrap.clientWidth);
      }
    },
    toggle(key) {
      this.$set(this.hiddenKeys, key, !this.hiddenKeys[key]);
    },
    xPos(i) {
      const n = this.labels.length;
      if (n <= 1) return this.padL + this.innerW / 2;
      return this.padL + (i / (n - 1)) * this.innerW;
    },
    yPos(v) {
      return this.padT + this.innerH * (1 - (v || 0) / this.yMax);
    },
    linePath(ds) {
      const pts = ds.values
        .map((v, i) => `${this.xPos(i).toFixed(1)},${this.yPos(v).toFixed(1)}`)
        .join(" ");
      return pts ? `M${pts.replace(/ /g, " L")}` : "";
    },
    onMove(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const n = this.labels.length;
      if (!n) return;
      const stepX = n <= 1 ? this.innerW : this.innerW / (n - 1);
      let idx = Math.round((x - this.padL) / stepX);
      idx = Math.max(0, Math.min(n - 1, idx));
      this.hoverIndex = idx;
    },
    niceCeil(v) {
      const pow = Math.pow(10, Math.floor(Math.log10(v)));
      const n = v / pow;
      if (n <= 1) return pow;
      if (n <= 2) return 2 * pow;
      if (n <= 2.5) return 2.5 * pow;
      if (n <= 5) return 5 * pow;
      return 10 * pow;
    },
    formatTick(v) {
      if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + "万";
      if (v >= 1000) return (v / 1000).toFixed(0) + "k";
      return String(Math.round(v));
    },
    formatNumber(v) {
      return Number(v || 0).toLocaleString("zh-CN");
    },
  },
};
</script>

<style lang="scss" scoped>
@import "@/styles/variables.scss";

.stats-line-chart {
  width: 100%;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 8px;
  user-select: none;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  color: #606266;
  cursor: pointer;

  &.off {
    opacity: 0.35;
    text-decoration: line-through;
  }
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  flex-shrink: 0;
}

.chart-body {
  position: relative;
  width: 100%;
}

::v-deep .grid-line {
  stroke: #ebeef5;
  stroke-width: 1;
}

::v-deep .hover-line {
  stroke: #c0c4cc;
  stroke-width: 1;
  stroke-dasharray: 4 3;
}

::v-deep .axis-text {
  font-size: 11px;
  fill: #909399;
}

.chart-tooltip {
  position: absolute;
  top: 24px;
  min-width: 150px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid #ebeef5;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  pointer-events: none;
  z-index: 10;
}

.tip-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}

.tip-row {
  display: flex;
  align-items: center;
  line-height: 20px;
  color: #606266;
}

.tip-name {
  flex: 1;
}

.tip-value {
  font-weight: 600;
  color: #303133;
  margin-left: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
