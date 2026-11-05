/**
 * 数据统计渲染层 API：封装主进程采集/读取 IPC。
 */
import { ipcRenderer } from "electron";
import {
  buildAccountPartitionOf,
  recordAccountKeyOf,
} from "../../shared/accountIdentity.js";

/** 不参与统计的平台（无数据接口） */
const STATS_EXCLUDED = new Set(["番茄视频", "掘金"]);

/**
 * 从 localStorage 账号树组装可采集账号列表。
 * @param {(group: string, platform: string) => boolean} [filter] 可选过滤（如只采集某分组某平台）
 * @returns [{ group, platform, partition }]
 */
export function buildCollectAccounts(filter) {
  let tree = {};
  try {
    tree = JSON.parse(localStorage.getItem("accountTree") || "{}");
  } catch (e) {
    return [];
  }
  const accounts = [];
  const seenPartitions = new Set();
  for (const [group, node] of Object.entries(tree)) {
    const children = (node && node.children) || [];
    for (const child of children) {
      const pt = (child.meta && child.meta.pt) || child.path;
      if (!pt || STATS_EXCLUDED.has(pt)) continue;
      if (filter && !filter(group, pt)) continue;
      // partition 按账号记录的 accountKey 拼装（与登录窗口一致，
      // 老数据回退历史 phone "-" 前缀规则）；同一平台账号跨分组共享
      // 登录态，partition 去重后只采一次
      const meta = child.meta || {};
      const partition = buildAccountPartitionOf(meta, pt);
      if (seenPartitions.has(partition)) continue;
      seenPartitions.add(partition);
      accounts.push({
        group,
        platform: pt,
        partition,
        accountKey: recordAccountKeyOf(meta),
      });
    }
  }
  return accounts;
}

export function collectAccounts(accounts) {
  return ipcRenderer.invoke("stats:collect", { accounts });
}

export function cancelCollect() {
  return ipcRenderer.invoke("stats:cancel");
}

export function getAccountStats(group, platform) {
  return ipcRenderer.invoke("stats:get-data", { group, platform });
}

export function getOverviewStats() {
  return ipcRenderer.invoke("stats:get-overview");
}

export function getCollectLogs() {
  return ipcRenderer.invoke("stats:get-logs");
}

/** 订阅采集进度；返回取消订阅函数 */
export function onStatsProgress(handler) {
  const listener = (_event, data) => handler(data);
  ipcRenderer.on("stats:progress", listener);
  return () => ipcRenderer.removeListener("stats:progress", listener);
}
