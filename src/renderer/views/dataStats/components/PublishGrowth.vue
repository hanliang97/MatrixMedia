<template>
  <div class="publish-growth">
    <div class="growth-toolbar">
      <el-button
        type="primary"
        size="medium"
        icon="el-icon-refresh"
        class="sync-btn"
        :loading="syncing"
        @click="$emit('sync')"
      >
        {{ syncing ? "同步中…" : "同步当前页发布数据" }}
      </el-button>
      <span v-if="lastSyncText" class="last-sync">上次同步：{{ lastSyncText }}</span>
    </div>
    <div class="growth-tip">
      每次发布新视频后，自动回填上一条视频在此期间的增长（封闭统计）；最新一条显示当前累计值，待下次发布后封闭。
    </div>
    <el-table :data="pageRows" border stripe class="growth-table">
      <el-table-column type="index" label="#" width="56" :index="indexOffset" />
      <el-table-column label="视频标题" min-width="160">
        <template #default="{ row }">
          <span class="work-title" :title="row.title">{{ row.title }}</span>
        </template>
      </el-table-column>
      <el-table-column label="发布日期" width="150">
        <template #default="{ row }">{{ fmtTime(row.publishTime) }}</template>
      </el-table-column>
      <el-table-column label="播放" width="100" align="right">
        <template #default="{ row }">
          <span class="num">{{ showNum(displayOf(row).play) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="点赞" width="100" align="right">
        <template #default="{ row }">
          <span class="num">{{ showNum(displayOf(row).like) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="收藏" width="100" align="right">
        <template #default="{ row }">
          <span class="num">{{ showNum(displayOf(row).favorite) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="分享" width="100" align="right">
        <template #default="{ row }">
          <span class="num">{{ showNum(displayOf(row).share) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="评论" width="100" align="right">
        <template #default="{ row }">
          <span class="num">{{ showNum(displayOf(row).comment) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="关注变化" width="100" align="right">
        <template #default="{ row }">
          <span
            v-if="displayOf(row).fansDelta != null"
            class="num"
            :class="{ down: displayOf(row).fansDelta < 0 }"
          >
            {{ displayOf(row).fansDelta > 0 ? "+" : "" }}{{ displayOf(row).fansDelta }}
          </span>
          <span v-else class="num muted">-</span>
        </template>
      </el-table-column>
      <template #empty>
        <span class="empty-text">暂无作品数据，点击上方「同步当前页发布数据」</span>
      </template>
    </el-table>
    <div class="growth-pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="works.length"
        :page-size="pageSize"
        :current-page.sync="page"
      />
    </div>
  </div>
</template>

<script>
const PAGE_SIZE = 10;

export default {
  name: "PublishGrowth",
  props: {
    works: { type: Array, default: () => [] },
    syncing: { type: Boolean, default: false },
    lastCollectAt: { type: Number, default: 0 },
  },
  data() {
    return {
      pageSize: PAGE_SIZE,
      page: 1,
    };
  },
  computed: {
    pageRows() {
      const start = (this.page - 1) * this.pageSize;
      return this.works.slice(start, start + this.pageSize);
    },
    lastSyncText() {
      if (!this.lastCollectAt) return "";
      const d = new Date(this.lastCollectAt);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
        d.getHours()
      )}:${p(d.getMinutes())}`;
    },
  },
  methods: {
    indexOffset(i) {
      return (this.page - 1) * this.pageSize + i + 1;
    },
    // 已封闭（下一作品发布）用封闭值，否则用当前累计值
    displayOf(row) {
      return row.closedStats || row;
    },
    fmtTime(ms) {
      if (!ms) return "-";
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
        d.getHours()
      )}:${p(d.getMinutes())}`;
    },
    showNum(v) {
      return v == null ? "-" : Number(v).toLocaleString("zh-CN");
    },
  },
};
</script>

<style lang="scss" scoped>
@import "@/styles/variables.scss";

.publish-growth {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.growth-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sync-btn {
  min-width: 200px;
}

.last-sync {
  font-size: 12px;
  color: #909399;
}

.growth-tip {
  font-size: 12px;
  line-height: 1.7;
  color: #606266;
  background: #f4f4f5;
  border-radius: 4px;
  padding: 8px 12px;
}

.growth-table {
  width: 100%;
}

.work-title {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.num {
  font-variant-numeric: tabular-nums;

  &.down {
    color: #f56c6c;
  }

  &.muted {
    color: #c0c4cc;
  }
}

.growth-pager {
  display: flex;
  justify-content: flex-end;
}

.empty-text {
  font-size: 13px;
  color: #909399;
}
</style>
