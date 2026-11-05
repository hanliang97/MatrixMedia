"use strict";

/**
 * 验证头条作品列表翻页终止条件（dataStats/adapters.js → ADAPTERS.头条.collectScript）：
 *
 * 1. 首屏 has_more 缺失/false 但 offset 游标有值时继续翻页（修复前只采首屏 10 条，
 *    作品数与评论/点赞/收藏总量随之被截断）
 * 2. 游标不再推进（服务端重复返回同一 offset）时立即终止，不空转请求
 * 3. 空页终止（首屏就为空）
 * 4. 全量翻页后作品数与评论/点赞/收藏总量按全部作品累加
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
    // 页面上下文的 fetch：首页聚合固定返回，作品列表按 offset 取桩数据
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
        const offset = new URL(url, "https://mp.toutiao.com").searchParams.get("offset");
        const build = pages[String(offset)];
        if (!build) throw new Error("未预期的分页请求 offset=" + offset);
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
  // 1. 首屏 has_more=false，但 offset 游标还在推进 → 继续翻页，直到游标缺失
  {
    const { result, calls } = await runCollect({
      "0": () => ({ data: Array.from({ length: 10 }, (_, i) => item(i, 3)), offset: "1700000000000", has_more: false }),
      "1700000000000": () => ({ data: Array.from({ length: 10 }, (_, i) => item(10 + i, 3)), offset: "1690000000000", has_more: false }),
      "1690000000000": () => ({ data: Array.from({ length: 5 }, (_, i) => item(20 + i, 3)) }),
    });
    assert.strictEqual(calls.length, 3, "应翻满三页，实际请求 " + calls.length + " 次");
    assert.strictEqual(result.works.length, 25, "应采到 25 条作品");
    assert.strictEqual(result.overview.comments, 75, "评论总量应为全部作品累加");
    assert.strictEqual(result.overview.likes, 50, "点赞总量应为全部作品累加");
    assert.strictEqual(result.overview.favorites, 25, "收藏总量应为全部作品累加");
    assert.strictEqual(result.overview.fans, 5, "粉丝数来自首页聚合");
    assert.strictEqual(result.overview.plays, 4967, "播放阅读来自首页聚合");
    console.log("[通过] has_more=false + 游标推进 → 翻满全部页");
  }

  // 2. 游标不推进（服务端重复返回同一 offset）→ 立即终止，避免空转
  {
    const { result, calls } = await runCollect({
      "0": () => ({ data: Array.from({ length: 10 }, (_, i) => item(i, 1)), offset: "500" }),
      "500": () => ({ data: Array.from({ length: 10 }, (_, i) => item(10 + i, 1)), offset: "500" }),
    });
    assert.strictEqual(calls.length, 2, "游标不再推进时应立即终止，实际请求 " + calls.length + " 次");
    assert.strictEqual(result.works.length, 20, "应保留已采到的 20 条作品");
    assert.strictEqual(result.overview.comments, 20);
    console.log("[通过] 游标不再推进 → 立即终止");
  }

  // 3. 空页终止（首屏无作品）
  {
    const { result, calls } = await runCollect({
      "0": () => ({ data: [], offset: "1700000000000" }),
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(result.works.length, 0);
    assert.strictEqual(result.overview.comments, 0);
    console.log("[通过] 空页终止");
  }

  // 4. 首页聚合缺 statistic 时按未登录抛错（保持既有行为，别静默写入 0）
  {
    const script = collectScript;
    const sandbox = {
      console,
      fetch: async () => ({ status: 200, text: async () => JSON.stringify({ data: {} }) }),
      localStorage: { getItem: () => JSON.stringify({ user_unique_id: "1" }) },
      setTimeout: (fn) => setImmediate(fn),
    };
    let err = null;
    try {
      await vm.runInNewContext(script, sandbox);
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
