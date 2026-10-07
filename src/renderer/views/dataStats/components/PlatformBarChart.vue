<template>
  <div ref="wrap" class="platform-bar-chart">
    <div class="chart-legend">
      <span
        v-for="m in metrics"
        :key="m.key"
        class="legend-item"
        :class="{ off: hiddenKeys[m.key] }"
        @click="toggle(m.key)"
      >
        <i class="legend-dot" :style="{ background: m.color }"></i>
        {{ m.label }}
      </span>
    </div>
    <div class="chart-body" @mousemove="onMove" @mouseleave="hoverIndex = -1">
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
        <!-- hover 组高亮背景 -->
        <rect
          v-if="hoverIndex >= 0"
          :x="padL + hoverIndex * groupW"
          :y="padT"
          :width="groupW"
          :height="innerH"
          class="hover-band"
        />
        <g v-for="(row, gi) in rows" :key="row.platform">
          <rect
            v-for="bar in barsOf(row, gi)"
            :key="bar.key"
            :x="bar.x"
            :y="yPos(bar.v)"
            :width="bar.w"
            :height="Math.max(0, height - padB - yPos(bar.v))"
            :fill="bar.color"
            rx="2"
          />
          <!-- 平台图标 + 名称 -->
          <image
            v-if="ptIcon(row.platform)"
            :href="ptIcon(row.platform)"
            :x="groupCenter(gi) - 24"
            :y="height - padB + 8"
            width="13"
            height="13"
          />
          <text
            :x="groupCenter(gi) - (ptIcon(row.platform) ? 6 : 0)"
            :y="height - padB + 19"
            :text-anchor="ptIcon(row.platform) ? 'start' : 'middle'"
            class="axis-text platform-label"
          >
            {{ row.platform }}
          </text>
        </g>
        <line
          :x1="padL"
          :x2="width - padR"
          :y1="height - padB"
          :y2="height - padB"
          class="axis-line"
        />
      </svg>
      <div v-if="hoverRow" class="chart-tooltip" :style="tooltipStyle">
        <div class="tip-title">{{ hoverRow.platform }}</div>
        <div v-for="m in visibleMetrics" :key="m.key" class="tip-row">
          <i class="legend-dot" :style="{ background: m.color }"></i>
          <span class="tip-name">{{ m.label }}</span>
          <span class="tip-value">{{ formatNumber(hoverRow[m.key]) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { STATS_METRICS } from "../statsUtils";
import { PT_ICONS } from "../ptIcons";

const TICK_COUNT = 4;

export default {
  name: "PlatformBarChart",
  props: {
    // [{ platform, fans, likes, comments, favorites }]
    rows: { type: Array, required: true },
    height: { type: Number, default: 260 },
  },
  data() {
    return {
      width: 720,
      padL: 56,
      padR: 16,
      padT: 12,
      padB: 34,
      hoverIndex: -1,
      hiddenKeys: {},
      metrics: STATS_METRICS,
    };
  },
  computed: {
    innerW() {
      return Math.max(1, this.width - this.padL - this.padR);
    },
    innerH() {
      return Math.max(1, this.height - this.padT - this.padB);
    },
    groupW() {
      return this.innerW / Math.max(1, this.rows.length);
    },
    visibleMetrics() {
      return this.metrics.filter((m) => !this.hiddenKeys[m.key]);
    },
    yMax() {
      let max = 0;
      this.rows.forEach((row) => {
        this.visibleMetrics.forEach((m) => {
          if (row[m.key] > max) max = row[m.key];
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
    hoverRow() {
      return this.hoverIndex >= 0 ? this.rows[this.hoverIndex] : null;
    },
    tooltipStyle() {
      const x = this.padL + this.hoverIndex * this.groupW + this.groupW / 2;
      const flip = x > this.width - 190;
      return {
        left: x + "px",
        transform: flip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
      };
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
    groupCenter(gi) {
      return this.padL + gi * this.groupW + this.groupW / 2;
    },
    barsOf(row, gi) {
      const ms = this.visibleMetrics;
      const n = Math.max(1, ms.length);
      const slot = this.groupW * 0.72;
      const gap = 3;
      const bw = Math.max(3, Math.min(16, slot / n - gap));
      const totalW = n * bw + (n - 1) * gap;
      const startX = this.padL + gi * this.groupW + (this.groupW - totalW) / 2;
      return ms.map((m, si) => ({
        key: m.key,
        color: m.color,
        x: startX + si * (bw + gap),
        w: bw,
        v: row[m.key] || 0,
      }));
    },
    yPos(v) {
      return this.padT + this.innerH * (1 - (v || 0) / this.yMax);
    },
    onMove(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let idx = Math.floor((x - this.padL) / this.groupW);
      idx = Math.max(0, Math.min(this.rows.length - 1, idx));
      this.hoverIndex = idx;
    },
    ptIcon(platform) {
      return PT_ICONS[platform] || "";
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

.platform-bar-chart {
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

::v-deep .axis-line {
  stroke: #dcdfe6;
  stroke-width: 1;
}

::v-deep .hover-band {
  fill: rgba(0, 0, 0, 0.04);
}

::v-deep .axis-text {
  font-size: 11px;
  fill: #909399;
}

::v-deep .platform-label {
  fill: #606266;
}

.chart-tooltip {
  position: absolute;
  top: 16px;
  min-width: 160px;
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
