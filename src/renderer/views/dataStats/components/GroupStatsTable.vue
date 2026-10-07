<template>
  <el-table
    :data="rows"
    border
    stripe
    class="group-stats-table"
    :span-method="spanMethod"
    :row-class-name="rowClassName"
    @row-click="onRowClick"
  >
    <el-table-column label="分组" width="140">
      <template #default="{ row }">
        <span class="group-name">{{ row.group }}</span>
      </template>
    </el-table-column>
    <el-table-column label="平台" width="150">
      <template #default="{ row }">
        <span v-if="row.isGroupTotal" class="total-label">分组总计</span>
        <span v-else class="platform-cell">
          <img v-if="ptIcon(row.platform)" class="pt-icon" :src="ptIcon(row.platform)" alt="" />
          <span class="platform-link">{{ row.platform }}</span>
        </span>
      </template>
    </el-table-column>
    <el-table-column label="粉丝总数" align="right" min-width="110">
      <template #default="{ row }">
        <span class="num">{{ showNum(row.fans) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="点赞总数" align="right" min-width="110">
      <template #default="{ row }">
        <span class="num">{{ showNum(row.likes) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="评论总数" align="right" min-width="110">
      <template #default="{ row }">
        <span class="num">{{ showNum(row.comments) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="收藏总数" align="right" min-width="110">
      <template #default="{ row }">
        <span class="num">{{ showNum(row.favorites) }}</span>
      </template>
    </el-table-column>
    <template #empty>
      <span class="empty-text">暂无数据，点击右上角「同步全部数据」从平台拉取</span>
    </template>
  </el-table>
</template>

<script>
import { PT_ICONS } from "../ptIcons";
import { compareGroups } from "../../../../shared/accountGroupOrder.js";

/** 不参与统计的平台 */
const EXCLUDED = new Set(["番茄视频", "掘金"]);

export default {
  name: "GroupStatsTable",
  props: {
    // [{ group, platform, meta, latest }] —— latest 为该账号最新日快照（可能为 null）
    accounts: { type: Array, default: () => [] },
  },
  computed: {
    rows() {
      // 账号树分组顺序（与侧边栏一致）
      let tree = {};
      try {
        tree = JSON.parse(localStorage.getItem("accountTree") || "{}");
      } catch (e) {
        tree = {};
      }
      const orderOf = (phone) => tree[phone] && tree[phone].meta && tree[phone].meta.groupOrder;

      // 以账号树为骨架（未采集的平台也显示，值为 -），再按分组排序
      const groups = [];
      for (const [phone, node] of Object.entries(tree)) {
        const pts = ((node && node.children) || [])
          .map((c) => (c.meta && c.meta.pt) || c.path)
          .filter((pt) => pt && !EXCLUDED.has(pt));
        if (pts.length) {
          groups.push({ phone, groupOrder: orderOf(phone), pts });
        }
      }
      groups.sort((a, b) => compareGroups(a.phone, a.groupOrder, b.phone, b.groupOrder));

      const latestOf = new Map(
        this.accounts.map((a) => [`${a.group}/${a.platform}`, a.latest])
      );
      const rows = [];
      for (const g of groups) {
        const total = { fans: 0, likes: 0, comments: 0, favorites: 0 };
        let hasData = false;
        g.pts.forEach((pt, idx) => {
          const snap = latestOf.get(`${g.phone}/${pt}`);
          if (snap) {
            hasData = true;
            for (const k of Object.keys(total)) total[k] += Number(snap[k]) || 0;
          }
          rows.push({
            key: `${g.phone}/${pt}`,
            group: g.phone,
            platform: pt,
            // 分组列合并范围 = 平台明细行 + 末尾分组总计行
            groupRowspan: idx === 0 ? g.pts.length + 1 : 0,
            ...(snap || {}),
          });
        });
        rows.push({
          key: `${g.phone}/__total__`,
          group: g.phone,
          platform: "",
          isGroupTotal: true,
          groupRowspan: 0,
          ...(hasData ? total : {}),
        });
      }
      return rows;
    },
  },
  methods: {
    // 第一列（分组名）按分组纵向合并：组内首行撑满，其余行隐藏
    spanMethod({ row, columnIndex }) {
      if (columnIndex !== 0) return undefined;
      if (row.groupRowspan > 0) return { rowspan: row.groupRowspan, colspan: 1 };
      return { rowspan: 0, colspan: 0 };
    },
    rowClassName({ row }) {
      return row.isGroupTotal ? "group-total-row" : "clickable-row";
    },
    // 点击明细行跳转到对应「分组 × 平台」统计页；总计行不跳转
    onRowClick(row) {
      if (row.isGroupTotal) return;
      const path = `/data-stats/group/${row.group}/${row.platform}`;
      if (this.$route.path !== path) {
        this.$router.push(path).catch(() => {});
      }
    },
    ptIcon(platform) {
      return PT_ICONS[platform] || "";
    },
    showNum(v) {
      return v == null ? "-" : Number(v).toLocaleString("zh-CN");
    },
  },
};
</script>

<style lang="scss" scoped>
.group-stats-table {
  width: 100%;
}

.group-name {
  font-weight: 600;
  color: #303133;
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

.num {
  font-variant-numeric: tabular-nums;
}

.total-label {
  font-weight: 600;
  color: #303133;
}

::v-deep .clickable-row {
  cursor: pointer;
}

.platform-link {
  color: #409eff;

  &:hover {
    text-decoration: underline;
  }
}

::v-deep .group-total-row {
  font-weight: 600;

  & > td {
    background-color: #f0f4f8 !important;
  }

  .num {
    color: #303133;
  }
}

.empty-text {
  font-size: 13px;
  color: #909399;
}
</style>
