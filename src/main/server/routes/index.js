var express = require("express");
const { changeData } = require("../utils");
const { isTrustedLocalRequest } = require("../requestGuard");

var router = express.Router();

router.get("/", function (req, res) {
  res.send("<h1>MatrixMedia API</h1>");
});

router.get("/test", function (req, res) {
  res.json({
    success: true,
    message: "ok",
  });
});

router.get("/platforms", async function (req, res) {
  try {
    const { getVideoPublishPlatformList } = await import(
      "../../../shared/publishPlatforms.js"
    );
    const ptConfig = (await import("../../config/ptConfig.js")).default;
    res.json({
      success: true,
      platforms: getVideoPublishPlatformList(ptConfig),
    });
  } catch (error) {
    console.error("[HTTP /platforms]", error);
    res.status(500).json({
      success: false,
      message: error && error.message ? error.message : String(error),
    });
  }
});

router.get("/creative-statements", async function (req, res) {
  try {
    const { getCreativeStatementApiSpec } = await import(
      "../../../shared/creativeStatement.js"
    );
    res.json({
      success: true,
      ...getCreativeStatementApiSpec(),
    });
  } catch (error) {
    console.error("[HTTP /creative-statements]", error);
    res.status(500).json({
      success: false,
      message: error && error.message ? error.message : String(error),
    });
  }
});

router.post("/changeData", function (req, res) {
  // 信任条件见 requestGuard：命中 Origin 白名单，或携带本次启动的
  // 随机令牌（打包后 file:// 页面不发送 Origin，必须靠令牌通过）。
  // 无 Origin 也无令牌的本地脚本 / 外部网站请求一律 403。
  if (!isTrustedLocalRequest(req)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json(changeData({ ...req.body }));
});

router.post("/publish", async function (req, res) {
  try {
    const { parseMultiPublishRequest } = await import(
      "../../cli/parsePublishArgs.js"
    );
    const publishService = await import("../../services/publishVideo.js");

    const parsed = parseMultiPublishRequest(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: parsed.error,
      });
    }

    const result = parsed.multi
      ? await publishService.runMultiPlatformPublish(parsed.value)
      : await publishService.runSingleFilePublish(parsed.value);

    const success = result.success === true || result.exitCode === 0;
    const httpStatus =
      result.exitCode === 2 && !parsed.multi ? 400 : success ? 200 : 200;

    const response = { ...result };
    response.success = success;
    if (parsed.skipped && parsed.skipped.length > 0) {
      response.skipped = parsed.skipped;
    }

    return res.status(httpStatus).json(response);
  } catch (error) {
    console.error("[HTTP /publish]", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: error && error.message ? error.message : String(error),
    });
  }
});

/* ---------------- 数据统计（采集层） ---------------- */

const { PLATFORM_ALIASES } = require("../../../shared/publishPlatforms.js");

const STATS_PLATFORMS = new Set([
  "抖音",
  "视频号",
  "哔哩哔哩",
  "百家号",
  "头条",
  "快手",
  "小红书",
]);

function resolveStatsParams(req) {
  const src = req.method === "GET" ? req.query : req.body || {};
  const phone = String(src.phone || "").trim();
  const rawPt = String(src.pt || src.platform || "").trim();
  // 支持短码（dy/sph/blbl/bjh/tt/ks/xhs）与中文名
  const pt = PLATFORM_ALIASES[rawPt] || PLATFORM_ALIASES[rawPt.toLowerCase()] || rawPt;
  return { phone, pt, title: src.title ? String(src.title) : "" };
}

/** GET /stats?phone=<分组>&pt=<平台> —— 读本地快照中的账号粉丝数据 */
router.get("/stats", function (req, res) {
  if (!isTrustedLocalRequest(req)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const { phone, pt } = resolveStatsParams(req);
  if (!phone || !STATS_PLATFORMS.has(pt)) {
    return res.status(400).json({
      success: false,
      message: `参数错误：需要 phone 与 pt（${[...STATS_PLATFORMS].join("/")}）`,
    });
  }
  try {
    const store = require("../../services/dataStats/store.js");
    const acc = store.readAccount(phone, pt);
    const dates = Object.keys(acc.daily || {}).sort();
    const latestDate = dates.length ? dates[dates.length - 1] : null;
    res.json({
      success: Boolean(latestDate),
      group: phone,
      platform: pt,
      latestDate,
      latest: latestDate ? acc.daily[latestDate] : null,
      lastCollectAt: acc.meta.lastCollectAt || null,
      workCount: (acc.works || []).length,
      ...(latestDate ? {} : { hint: "本地暂无数据，请先调用 POST /stats/sync 采集" }),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: String(error && error.message || error) });
  }
});

/** POST /stats/sync { phone, pt } —— 主动采集该账号最新数据并写库 */
router.post("/stats/sync", async function (req, res) {
  if (!isTrustedLocalRequest(req)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const { phone, pt } = resolveStatsParams(req);
  if (!phone || !STATS_PLATFORMS.has(pt)) {
    return res.status(400).json({
      success: false,
      message: `参数错误：需要 phone 与 pt（${[...STATS_PLATFORMS].join("/")}）`,
    });
  }
  const startedAt = Date.now();
  try {
    const { collectAccount } = require("../../services/dataStats/collector.js");
    const store = require("../../services/dataStats/store.js");
    const data = await collectAccount({
      partition: `persist:${phone}${pt}`,
      platform: pt,
    });
    store.mergeDaily(phone, pt, data.overview, data.fansHistory);
    store.mergeWorks(phone, pt, data.works);
    store.writeMeta(phone, pt, {
      lastCollectAt: Date.now(),
      lastError: "",
      workCount: data.works.length,
    });
    store.appendCollectLog({
      startedAt,
      finishedAt: Date.now(),
      cancelled: false,
      results: [
        { group: phone, platform: pt, success: true, workCount: data.works.length },
      ],
    });
    res.json({
      success: true,
      group: phone,
      platform: pt,
      overview: data.overview,
      workCount: data.works.length,
      fansHistoryPoints: data.fansHistory.length,
    });
  } catch (error) {
    const message = String((error && error.message) || error);
    try {
      const store = require("../../services/dataStats/store.js");
      store.writeMeta(phone, pt, { lastCollectAt: Date.now(), lastError: message });
      store.appendCollectLog({
        startedAt,
        finishedAt: Date.now(),
        cancelled: false,
        results: [{ group: phone, platform: pt, success: false, error: message }],
      });
    } catch (_) { /* ignore */ }
    res.status(200).json({ success: false, group: phone, platform: pt, error: message });
  }
});

/** GET /stats/work?phone=<分组>&pt=<平台>&title=<标题> —— 按标题查视频发布数据 */
router.get("/stats/work", function (req, res) {
  if (!isTrustedLocalRequest(req)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const { phone, pt, title } = resolveStatsParams(req);
  if (!phone || !STATS_PLATFORMS.has(pt) || !title) {
    return res.status(400).json({
      success: false,
      message: "参数错误：需要 phone、pt 与 title",
    });
  }
  try {
    const store = require("../../services/dataStats/store.js");
    const { works } = store.readAccount(phone, pt);
    const norm = (s) => String(s || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
    const hit = (works || []).find((w) => norm(w.title) === norm(title));
    if (!hit) {
      return res.json({
        success: false,
        message: `未找到该标题的视频（本库共 ${(works || []).length} 条，可先 sync 更新后重试）`,
      });
    }
    res.json({
      success: true,
      group: phone,
      platform: pt,
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
  } catch (error) {
    res.status(500).json({ success: false, message: String(error && error.message || error) });
  }
});

module.exports = router;
