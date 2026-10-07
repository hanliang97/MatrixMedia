<template>
  <el-dialog
    :visible.sync="innerVisible"
    title="拉取记录"
    width="720px"
    append-to-body
    custom-class="collect-log-dialog"
  >
    <el-table
      :data="rows"
      border
      stripe
      size="small"
      max-height="480"
      :span-method="spanMethod"
      :row-class-name="rowClassName"
    >
      <el-table-column label="时间" width="170">
        <template #default="{ row }">
          <div class="time-cell">
            <div>{{ fmtTime(row.startedAt) }}</div>
            <div class="time-sub">{{ taskSummary(row) }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="分组" width="110" prop="group" />
      <el-table-column label="平台" width="110">
        <template #default="{ row }">
          <span class="platform-cell">
            <img v-if="ptIcon(row.platform)" class="pt-icon" :src="ptIcon(row.platform)" alt="" />
            {{ row.platform }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.success ? 'success' : 'danger'" size="mini">
            {{ row.success ? "成功" : "失败" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="详情" min-width="180">
        <template #default="{ row }">
          <span v-if="row.success" class="ok-text">{{ row.workCount }} 个作品</span>
          <span
            v-else
            class="error-text clickable"
            :title="row.error"
            @click="copyError(row.error)"
          >
            {{ row.error }}
          </span>
        </template>
      </el-table-column>
      <template #empty>
        <span class="empty-text">暂无拉取记录</span>
      </template>
    </el-table>
  </el-dialog>
</template>

<script>
import { PT_ICONS } from "../ptIcons";
import copyToClipboard from "@/utils/copy";

export default {
  name: "CollectLogDialog",
  props: {
    visible: { type: Boolean, default: false },
    // 采集任务日志（新的在前）：[{ startedAt, finishedAt, cancelled, results: [{group, platform, success, error?, workCount?}] }]
    logs: { type: Array, default: () => [] },
  },
  computed: {
    innerVisible: {
      get() {
        return this.visible;
      },
      set(v) {
        this.$emit("update:visible", v);
      },
    },
    // 展开为「任务 × 平台」行，时间列按任务合并
    rows() {
      const rows = [];
      for (const log of this.logs) {
        const results = log.results || [];
        results.forEach((r, idx) => {
          rows.push({
            key: `${log.startedAt}-${idx}`,
            startedAt: log.startedAt,
            cancelled: log.cancelled,
            total: results.length,
            successCount: results.filter((x) => x.success).length,
            ...r,
            taskRowspan: idx === 0 ? results.length : 0,
          });
        });
      }
      return rows;
    },
  },
  methods: {
    spanMethod({ row, columnIndex }) {
      if (columnIndex !== 0) return undefined;
      if (row.taskRowspan > 0) return { rowspan: row.taskRowspan, colspan: 1 };
      return { rowspan: 0, colspan: 0 };
    },
    rowClassName({ row }) {
      return row.success ? "" : "fail-row";
    },
    taskSummary(row) {
      const fail = row.total - row.successCount;
      const parts = [`共${row.total}项`];
      if (fail > 0) parts.push(`${fail} 失败`);
      if (row.cancelled) parts.push("已取消");
      return parts.join(" · ");
    },
    fmtTime(ms) {
      if (!ms) return "-";
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
        d.getHours()
      )}:${p(d.getMinutes())}`;
    },
    ptIcon(platform) {
      return PT_ICONS[platform] || "";
    },
    copyError(text) {
      if (!text) return;
      copyToClipboard(String(text));
      this.$message.success("错误信息已复制");
    },
  },
};
</script>

<style lang="scss" scoped>
.time-cell {
  line-height: 1.5;
}

.time-sub {
  font-size: 11px;
  color: #909399;
}

.platform-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.pt-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.ok-text {
  color: #67c23a;
}

.error-text {
  color: #f56c6c;
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;

  &.clickable {
    cursor: pointer;
    border-bottom: 1px dashed #f56c6c;
  }
}

::v-deep .fail-row > td {
  background-color: #fef0f0 !important;
}

.empty-text {
  font-size: 13px;
  color: #909399;
}
</style>
