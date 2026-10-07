"use strict";

/**
 * 数据统计 CLI：复用 dataStats 采集层（页面上下文 fetch，复用分组登录态）。
 * 输出 JSON 到 stdout（MCP runner 与脚本可直接消费）。
 */

import { collectAccount } from "../services/dataStats/collector.js";
import store from "../services/dataStats/store.js";

const normalizeTitle = (s) =>
  String(s || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

export async function runStatsCli({ action, platform, phone, title }) {
  const partition = `persist:${phone}${platform}`;

  if (action === "sync") {
    const startedAt = Date.now();
    try {
      const data = await collectAccount({ partition, platform });
      store.mergeDaily(phone, platform, data.overview, data.fansHistory);
      store.mergeWorks(phone, platform, data.works);
      store.writeMeta(phone, platform, {
        lastCollectAt: Date.now(),
        lastError: "",
        workCount: data.works.length,
      });
      store.appendCollectLog({
        startedAt,
        finishedAt: Date.now(),
        cancelled: false,
        results: [
          {
            group: phone,
            platform,
            success: true,
            workCount: data.works.length,
          },
        ],
      });
      print({
        success: true,
        action: "sync",
        group: phone,
        platform,
        overview: data.overview,
        workCount: data.works.length,
        fansHistoryPoints: data.fansHistory.length,
      });
      return 0;
    } catch (err) {
      const message = (err && err.message) || String(err);
      store.writeMeta(phone, platform, {
        lastCollectAt: Date.now(),
        lastError: message,
      });
      store.appendCollectLog({
        startedAt,
        finishedAt: Date.now(),
        cancelled: false,
        results: [{ group: phone, platform, success: false, error: message }],
      });
      print({ success: false, action: "sync", group: phone, platform, error: message });
      return 1;
    }
  }

  if (action === "get") {
    const acc = store.readAccount(phone, platform);
    const dates = Object.keys(acc.daily || {}).sort();
    const latestDate = dates.length ? dates[dates.length - 1] : null;
    const latest = latestDate ? acc.daily[latestDate] : null;
    print({
      success: Boolean(latest),
      action: "get",
      group: phone,
      platform,
      latestDate,
      latest,
      lastCollectAt: acc.meta.lastCollectAt || null,
      workCount: (acc.works || []).length,
      ...(latest
        ? {}
        : { hint: "本地暂无数据，请先运行 stats-sync 采集" }),
    });
    return latest ? 0 : 1;
  }

  if (action === "work") {
    const { works } = store.readAccount(phone, platform);
    const hit = (works || []).find(
      (w) => normalizeTitle(w.title) === normalizeTitle(title)
    );
    if (!hit) {
      print({
        success: false,
        action: "work",
        group: phone,
        platform,
        title,
        error: `未找到该标题的视频（本库共 ${(works || []).length} 条，可用 stats-sync 更新后重试）`,
      });
      return 1;
    }
    print({
      success: true,
      action: "work",
      group: phone,
      platform,
      work: {
        workId: hit.workId,
        title: hit.title,
        url: hit.url || "",
        publishTime: hit.publishTime || 0,
        play: hit.play,
        like: hit.like,
        comment: hit.comment,
        share: hit.share,
        favorite: hit.favorite,
        fansDelta: hit.fansDelta,
        closedStats: hit.closedStats || null,
        updatedAt: hit.updatedAt || null,
      },
    });
    return 0;
  }

  print({ success: false, error: `未知动作: ${action}` });
  return 2;
}
