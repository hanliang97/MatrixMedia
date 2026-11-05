"use strict";

/**
 * 验证头条作品列表采集行为（dataStats/adapters.js → ADAPTERS.头条.collectScript）：
 *
 * 1. 请求必须带 count=200（count=10 只拿首屏 10 条，作品数与评论/点赞/收藏总量被截断，
 *    且首屏最新作品评论多为 0，界面评论总数会显示成 0）
 * 2. has_more=false 时立即终止，不空转请求
 * 3. has_more=true 且游标推进时继续翻页（超 200 篇作品的账号），游标不推进时立即终止
 * 4. 空页终止（首屏就为空）
 * 5. 首页聚合缺 statistic 时按未登录抛错
 *
 * 脚本本身跑在平台页面上下文里（依赖 fetch / localStorage），这里用 vm 沙箱模拟。
 */

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "dataStatsAdapters.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/dataStats/adapters.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const { ADAPTERS } = require(bundle);
const collectScript = ADAPTERS.头条.collectScript();

/** 造一条 feed 作品（结构与 mp_provider 返回一致） */
function item(index, commentCount) {
  return {
    assembleCell: {
      itemCell: {
        articleBase: {
          gidStr: "g" + index,
          title: "作品" + index,
          publishTime: 1700000000 + index,
        },
        itemCounter: {
          readCount: 100,
          diggCount: 2,
          commentCount,
          repinCount: 1,
        },
      },
    },
  };
}

/**
 * 在 vm 沙箱里跑一次采集。
 * pages: { "<offset>": () => ({ data: [...], offset?: string|number, has_more?: boolean }) }
 */
async function runCollect(pages) {
  const calls = [];
  const sandbox = {
    console,
    fetch: async (url) => {
      calls.push(url);
      let json;
      if (url.includes("home/merge_v2")) {
        json = {
          data: {
            statistic: {
              data: { total_subscribe_count: 5, total_read_play_count: 4967 },
            },
          },
        };
      } else {
        const u = new URL(url, "https://mp.toutiao.com");
        const build = pages[u.searchParams.get("offset")];
        if (!build) throw new Error("未预期的分页请求 offset=" + u.searchParams.get("offset"));
        json = build();
      }
      return { status: 200, text: async () => JSON.stringify(json) };
    },
    localStorage: {
      getItem: () => JSON.stringify({ user_unique_id: "1234567890" }),
    },
    // 采集脚本每页之间有 800ms 限速等待，测试里直接放行
    setTimeout: (fn) => setImmediate(fn),
  };

  const result = await vm.runInNewContext(collectScript, sandbox);
  return { result, calls: calls.filter((u) => u.includes("mp_provider")) };
}

(async () => {
  // 1. 大 count + has_more=false：一次请求拉全，评论总量按全部作品累加
  {
    const { result, calls } = await runCollect({
      "0": () => ({ data: Array.from({ length: 56 }, (_, i) => item(i, 3)), offset: "1791770476686", has_more: false }),
    });
    assert.strictEqual(calls.length, 1, "has_more=false 应只请求一次，实际 " + calls.length + " 次");
    assert.ok(/[?&]count=200(&|$)/.test(calls[0]), "列表请求必须带 count=200，实际：" + calls[0]);
    assert.ok(!/[?&]count=10(&|$)/.test(calls[0]), "不应再使用 count=10");
    assert.strictEqual(result.works.length, 56, "应采到全部 56 条作品");
    assert.strictEqual(result.overview.comments, 168, "评论总量应为全部作品累加");
    assert.strictEqual(result.overview.likes, 112, "点赞总量应为全部作品累加");
    assert.strictEqual(result.overview.favorites, 56, "收藏总量应为全部作品累加");
    assert.strictEqual(result.overview.fans, 5, "粉丝数来自首页聚合");
    assert.strictEqual(result.overview.plays, 4967, "播放阅读来自首页聚合");
    console.log("[通过] count=200 + has_more=false → 一次拉全并正确累加");
  }

  // 2. 超 200 篇作品的账号：has_more=true 且游标推进 → 继续翻页
  {
    const { result, calls } = await runCollect({
      "0": () => ({ data: Array.from({ length: 200 }, (_, i) => item(i, 1)), offset: "1710000000000", has_more: true }),
      "1710000000000": () => ({ data: Array.from({ length: 12 }, (_, i) => item(200 + i, 2)), offset: "1700000000000", has_more: false }),
    });
    assert.strictEqual(calls.length, 2, "游标推进且 has_more=true 时应继续翻页，实际 " + calls.length + " 次");
    assert.strictEqual(result.works.length, 212, "应采到 212 条作品");
    assert.strictEqual(result.overview.comments, 200 + 24, "评论总量应按两页全部作品累加");
    console.log("[通过] has_more=true + 游标推进 → 继续翻页");
  }

  // 3. 游标不推进（服务端重复返回同一 offset）→ 立即终止，避免空转
  {
    const { result, calls } = await runCollect({
      "0": () => ({ data: Array.from({ length: 200 }, (_, i) => item(i, 1)), offset: "500", has_more: true }),
      "500": () => ({ data: Array.from({ length: 200 }, (_, i) => item(200 + i, 1)), offset: "500", has_more: true }),
    });
    assert.strictEqual(calls.length, 2, "游标不再推进时应立即终止，实际 " + calls.length + " 次");
    assert.strictEqual(result.works.length, 400, "应保留已采到的 400 条作品");
    assert.strictEqual(result.overview.comments, 400);
    console.log("[通过] 游标不再推进 → 立即终止");
  }

  // 4. 空页终止（首屏无作品）
  {
    const { result, calls } = await runCollect({
      "0": () => ({ data: [], offset: "1700000000000", has_more: true }),
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(result.works.length, 0);
    assert.strictEqual(result.overview.comments, 0);
    console.log("[通过] 空页终止");
  }

  // 5. 首页聚合缺 statistic 时抛错（保持既有行为，别静默写入 0）
  {
    const sandbox = {
      console,
      fetch: async () => ({ status: 200, text: async () => JSON.stringify({ data: {} }) }),
      localStorage: { getItem: () => JSON.stringify({ user_unique_id: "1" }) },
      setTimeout: (fn) => setImmediate(fn),
    };
    let err = null;
    try {
      await vm.runInNewContext(collectScript, sandbox);
    } catch (e) {
      err = e;
    }
    assert.ok(err && /merge_v2/.test(err.message), "缺 statistic 应抛错，实际：" + (err && err.message));
    console.log("[通过] 首页聚合异常时抛错");
  }

  console.log("\n全部用例通过");
})().catch((e) => {
  console.error("[失败]", e && e.message);
  process.exit(1);
});
