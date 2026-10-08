"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  ENTITY_LIST_CONFIG,
  normalizeSphEntityOptions,
  pickEntityRows,
  shouldFetchNextEntityPage,
  buildSphEntityPageBody,
  sphEntityEnvelopeError,
  collectSphEntityOptions,
} = require("../src/shared/sphEntityOptions");

/* ---------------- 归一化 ---------------- */

// data.list 标准形态：名称 + 小程序名副标题
const first = normalizeSphEntityOptions({
  errCode: 0,
  data: {
    list: [
      { name: "泳陷错恋", appName: "某某小程序", coverUrl: "http://c" },
      { title: "回家路", wxaAppName: "另一小程序" },
      { name: "泳陷错恋", appName: "重复" },
      { appName: "无名称丢弃" },
    ],
  },
});
assert.strictEqual(first.length, 2);
assert.strictEqual(first[0].name, "泳陷错恋");
assert.strictEqual(first[0].title, "泳陷错恋");
assert.strictEqual(first[0].subTitle, "某某小程序");
assert.strictEqual(first[0].cover, "http://c");
assert.strictEqual(first[1].subTitle, "另一小程序");
assert.ok(first[0].raw, "保留 raw 便于排查");

// 兼容其它行容器键与根级平铺
assert.strictEqual(
  pickEntityRows({ data: { dramaList: [{ name: "A" }] } }).length,
  1
);
assert.strictEqual(
  pickEntityRows({ data: { componentList: [{ name: "A" }] } }).length,
  1
);
assert.strictEqual(pickEntityRows({ list: [{ name: "A" }] }).length, 1);
assert.strictEqual(pickEntityRows(null).length, 0);
assert.strictEqual(pickEntityRows({ data: {} }).length, 0);

/* ---------------- 翻页判断 ---------------- */

assert.strictEqual(shouldFetchNextEntityPage({}, 0, 20), false, "空页停止");
assert.strictEqual(shouldFetchNextEntityPage({}, 5, 20), false, "不满页停止");
assert.strictEqual(
  shouldFetchNextEntityPage({ data: { continueFlag: 0 } }, 20, 20),
  false,
  "continueFlag=0 停止"
);
assert.strictEqual(
  shouldFetchNextEntityPage({ data: { continueFlag: 1 } }, 20, 20),
  true,
  "continueFlag=1 继续"
);
assert.strictEqual(shouldFetchNextEntityPage({}, 20, 20), true, "满页无标记继续");

/* ---------------- 请求体 / 信封 ---------------- */

assert.deepStrictEqual(buildSphEntityPageBody(2, 20, 123), {
  currentPage: 2,
  pageSize: 20,
  timestamp: "123",
  _log_finder_uin: "",
  _log_finder_id: "",
  rawKeyBuff: "",
  pluginSessionId: null,
  scene: 7,
  reqScene: 7,
});
assert.strictEqual(sphEntityEnvelopeError({ errCode: 0 }), "");
assert.strictEqual(sphEntityEnvelopeError({}), "", "无 errCode 字段视为正常");
assert.strictEqual(
  sphEntityEnvelopeError({ errCode: 100002, errMsg: "session expired" }),
  "session expired"
);

/* ---------------- 分页合并编排 ---------------- */

(async () => {
  // 正常翻页：第 1 页满页（continueFlag=1），第 2 页不满页 → 共 3 条
  const seenPages = [];
  let r = await collectSphEntityOptions(
    async (currentPage) => {
      seenPages.push(currentPage);
      if (currentPage === 1) {
        return {
          errCode: 0,
          data: {
            continueFlag: 1,
            list: [{ name: "短剧A" }, { name: "短剧B" }],
          },
        };
      }
      return { errCode: 0, data: { list: [{ name: "短剧C" }] } };
    },
    { pageSize: 2 }
  );
  assert.deepStrictEqual(
    r.entities.map((item) => item.name),
    ["短剧A", "短剧B", "短剧C"]
  );
  assert.deepStrictEqual(seenPages, [1, 2], "按 currentPage 翻页");
  assert.strictEqual(r.envelopeError, "");

  // 满页但无新增 → 防死循环（平台忽略页码重复返回）
  let calls = 0;
  r = await collectSphEntityOptions(
    async () => {
      calls += 1;
      return { errCode: 0, data: { list: [{ name: "同一条" }] } };
    },
    { pageSize: 1 }
  );
  assert.strictEqual(r.entities.length, 1);
  assert.ok(calls <= 3, `无新增应提前停止（实际请求 ${calls} 次）`);

  // 跨页去重
  r = await collectSphEntityOptions(
    async (currentPage) =>
      currentPage === 1
        ? { data: { continueFlag: 1, list: [{ name: "A" }, { name: "B" }] } }
        : { data: { list: [{ name: "B" }, { name: "C" }] } },
    { pageSize: 2 }
  );
  assert.deepStrictEqual(
    r.entities.map((item) => item.name),
    ["A", "B", "C"],
    "跨页按名称去重"
  );

  // 信封错误透传
  r = await collectSphEntityOptions(async () => ({
    errCode: 100002,
    errMsg: "session expired",
  }));
  assert.strictEqual(r.envelopeError, "session expired");
  assert.strictEqual(r.entities.length, 0);

  // 字段未识别 → 回传首行键便于诊断
  r = await collectSphEntityOptions(async () => ({
    errCode: 0,
    data: { list: [{ 剧名: "新模式字段" }] },
  }));
  assert.strictEqual(r.entities.length, 0);
  assert.deepStrictEqual(r.unknownRowKeys, ["剧名"]);

  // maxPages 上限保护
  let maxCalls = 0;
  r = await collectSphEntityOptions(
    async (currentPage) => {
      maxCalls += 1;
      return { data: { list: [{ name: `剧${currentPage}` }] } };
    },
    { pageSize: 1, maxPages: 3 }
  );
  assert.strictEqual(maxCalls, 3, "到达 maxPages 停止");
  assert.strictEqual(r.entities.length, 3);

  /* ---------------- 接口配置 ---------------- */

  assert.ok(
    ENTITY_LIST_CONFIG.drama.path.includes("search_drama_component"),
    "短剧走已验证的 search_drama_component"
  );
  assert.ok(
    ENTITY_LIST_CONFIG.series.path.includes("search_series_component"),
    "剧集走同族 series 接口（待真实账号验证）"
  );
  assert.strictEqual(ENTITY_LIST_CONFIG.drama.ipcChannel, "sph:list-dramas");
  assert.strictEqual(ENTITY_LIST_CONFIG.series.ipcChannel, "sph:list-series");

  console.log("test-sph-entity-options passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
