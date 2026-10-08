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
  pickEntityTotalCount,
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
// 平台分页长度参差不齐（实测 100/98/86/19/7 条混排），不满页不能判定到底
assert.strictEqual(shouldFetchNextEntityPage({}, 5, 20), true, "不满页但非空：继续");
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

/* ---------------- 平台自报总数 ---------------- */

assert.strictEqual(
  pickEntityTotalCount({ data: { totalCount: 289 } }),
  289,
  "data.totalCount"
);
assert.strictEqual(pickEntityTotalCount({ totalCount: 12 }), 12, "根级 totalCount");
assert.strictEqual(pickEntityTotalCount({ data: {} }), 0, "无字段返回 0");
assert.strictEqual(pickEntityTotalCount({ data: { totalCount: 0 } }), 0, "0 视为未知");
assert.strictEqual(pickEntityTotalCount(null), 0, "空输入安全");

/* ---------------- 请求体 / 信封 ---------------- */

// 无关键词：不带 queryString（等价于取默认列表）
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

// 带关键词：queryString 是平台真实的服务端搜索参数
// （从发布页 JS 的 loadList 挖出：searchKey ? {queryString: searchKey, ...} : {...}）
assert.deepStrictEqual(buildSphEntityPageBody(1, 20, 123, "全家中毒"), {
  currentPage: 1,
  pageSize: 20,
  timestamp: "123",
  _log_finder_uin: "",
  _log_finder_id: "",
  rawKeyBuff: "",
  pluginSessionId: null,
  scene: 7,
  reqScene: 7,
  queryString: "全家中毒",
});
// 首尾空白会被裁掉；纯空白视作无关键词
assert.strictEqual(
  buildSphEntityPageBody(1, 20, 123, "  泳陷  ").queryString,
  "泳陷",
  "关键词两侧空白裁掉"
);
assert.strictEqual(
  "queryString" in buildSphEntityPageBody(1, 20, 123, "   "),
  false,
  "纯空白不带 queryString"
);
assert.strictEqual(
  "queryString" in buildSphEntityPageBody(1, 20, 123, null),
  false,
  "null 不带 queryString"
);
assert.strictEqual(
  buildSphEntityPageBody(1, 20, 123, "a").rawKeyBuff,
  "",
  "rawKeyBuff 是游标，不是关键词，恒为空串"
);

// sceneType：剧集传 3，短剧不传
assert.strictEqual(
  buildSphEntityPageBody(1, 20, 123, "", 3).sceneType,
  3,
  "剧集带 sceneType=3"
);
assert.strictEqual(
  "sceneType" in buildSphEntityPageBody(1, 20, 123, "", undefined),
  false,
  "短剧不带 sceneType"
);
assert.deepStrictEqual(
  buildSphEntityPageBody(1, 20, 123, "我", 3),
  {
    currentPage: 1,
    pageSize: 20,
    timestamp: "123",
    _log_finder_uin: "",
    _log_finder_id: "",
    rawKeyBuff: "",
    pluginSessionId: null,
    scene: 7,
    reqScene: 7,
    queryString: "我",
    sceneType: 3,
  },
  "剧集搜索同时带 queryString 与 sceneType"
);
assert.strictEqual(sphEntityEnvelopeError({ errCode: 0 }), "");
assert.strictEqual(sphEntityEnvelopeError({}), "", "无 errCode 字段视为正常");
assert.strictEqual(
  sphEntityEnvelopeError({ errCode: 100002, errMsg: "session expired" }),
  "session expired"
);

/* ---------------- 分页合并编排 ---------------- */

(async () => {
  // 正常翻页：第 1 页满页（continueFlag=1），第 2 页不满页仍继续，第 3 页空页停止
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
      if (currentPage === 2) {
        // 不满页（1 < pageSize=2）：平台分页长度参差不齐，这里必须继续
        return { errCode: 0, data: { list: [{ name: "短剧C" }] } };
      }
      return { errCode: 0, data: { list: [] } };
    },
    { pageSize: 2, maxPages: 10 }
  );
  assert.deepStrictEqual(
    r.entities.map((item) => item.name),
    ["短剧A", "短剧B", "短剧C"]
  );
  assert.deepStrictEqual(seenPages, [1, 2, 3], "不满页继续，空页才停止");
  assert.strictEqual(r.envelopeError, "");

  // 平台自报 totalCount 时精确收口，不浪费空请求
  const cappedPages = [];
  r = await collectSphEntityOptions(
    async (currentPage) => {
      cappedPages.push(currentPage);
      return {
        errCode: 0,
        data: { totalCount: 2, list: [{ name: `剧${currentPage}A` }, { name: `剧${currentPage}B` }] },
      };
    },
    { pageSize: 2, maxPages: 10 }
  );
  assert.deepStrictEqual(cappedPages, [1], "收满 totalCount 即停止");
  assert.strictEqual(r.totalCount, 2);

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
    { pageSize: 2, maxPages: 10 }
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
  // 抓包结论：剧集没有独立路径，与短剧共用同一接口，靠 sceneType 区分
  assert.strictEqual(
    ENTITY_LIST_CONFIG.series.path,
    ENTITY_LIST_CONFIG.drama.path,
    "剧集与短剧共用同一接口路径"
  );
  assert.strictEqual(
    ENTITY_LIST_CONFIG.series.sceneType,
    3,
    "剧集用 kSceneType_SelfOperatedNativeDrama=3"
  );
  assert.strictEqual(
    ENTITY_LIST_CONFIG.drama.sceneType,
    undefined,
    "短剧不带 sceneType"
  );
  assert.strictEqual(ENTITY_LIST_CONFIG.drama.ipcChannel, "sph:list-dramas");
  assert.strictEqual(ENTITY_LIST_CONFIG.series.ipcChannel, "sph:list-series");

  /* ---------------- 下拉结果清理契约 ----------------
   * 这些规则来自 GUI 侧（LocalVideoPublish.vue）的搜索下拉，
   * 用最小 harness 复刻同一套行为，锁住「清空必须清掉下拉」这条易回归的约定。
   */

  const makeEntityVm = () => ({
    platformEntityOptions: {},
    platformEntitySearched: {},
    platformEntitySeq: {},
    platformEntityLoading: {},
    platformVideoLinks: {},
    $set(obj, k, v) {
      obj[k] = v;
    },
    $delete(obj, k) {
      delete obj[k];
    },
    $message: { warning() {}, error() {}, info() {} },
    entityOptionsKey(data) {
      return `${data.id}:mini_drama`;
    },
    setPlatformVideoLinkValue(nodeId, platform, value) {
      this.$set(this.platformVideoLinks, nodeId, {
        type: "mini_drama",
        value: String(value || "").trim(),
      });
    },
    getPlatformVideoLinkValue(nodeId) {
      return (this.platformVideoLinks[nodeId] || {}).value || "";
    },
    nextPlatformEntitySeq(key) {
      const seq = (Number(this.platformEntitySeq[key]) || 0) + 1;
      this.$set(this.platformEntitySeq, key, seq);
      return seq;
    },
    clearPlatformEntityOptions(row) {
      if (!row) return;
      const key = this.entityOptionsKey(row);
      this.nextPlatformEntitySeq(key);
      this.$set(this.platformEntityOptions, key, []);
      this.$set(this.platformEntitySearched, key, false);
      this.$set(this.platformEntityLoading, key, false);
    },
    onEntityValueChange(row, value) {
      const text = String(value == null ? "" : value);
      this.setPlatformVideoLinkValue(row.id, row.pt, text);
      if (!text.trim()) {
        this.clearPlatformEntityOptions(row);
      }
    },
    async searchPlatformEntityOptions(row, query, fetchImpl) {
      const key = this.entityOptionsKey(row);
      const keyword = String(query == null ? "" : query).trim();
      if (!keyword) {
        this.clearPlatformEntityOptions(row);
        return;
      }
      const seq = this.nextPlatformEntitySeq(key);
      this.$set(this.platformEntityLoading, key, true);
      this.$set(this.platformEntityOptions, key, []);
      const result = await fetchImpl(keyword);
      if (this.platformEntitySeq[key] !== seq) return;
      this.$set(this.platformEntityOptions, key, (result && result.entities) || []);
      this.$set(this.platformEntitySearched, key, true);
      if (this.platformEntitySeq[key] === seq) {
        this.$set(this.platformEntityLoading, key, false);
      }
    },
  });

  const ROW = { id: "node1", pt: "视频号", phone: "sph" };
  const KEY = "node1:mini_drama";
  const okFetch = (names) => async () => ({
    ok: true,
    entities: names.map((name) => ({ name })),
  });

  // 点 clearable 的 × → 下拉结果必须一起清掉（否则残留上一次候选）
  let evm = makeEntityVm();
  evm.platformEntityOptions[KEY] = [{ name: "残留项" }];
  evm.platformEntitySearched[KEY] = true;
  evm.clearPlatformEntityOptions(ROW);
  evm.onEntityValueChange(ROW, "");
  assert.strictEqual(evm.platformEntityOptions[KEY].length, 0, "× 清空后下拉应无残留");
  assert.strictEqual(evm.platformEntitySearched[KEY], false, "× 清空后 searched 应重置");
  assert.strictEqual(evm.getPlatformVideoLinkValue(ROW.id), "");

  // 删空输入 → 同样要清掉
  evm = makeEntityVm();
  evm.platformEntityOptions[KEY] = [{ name: "残留项" }];
  evm.onEntityValueChange(ROW, "");
  assert.strictEqual(evm.platformEntityOptions[KEY].length, 0, "删空输入后下拉应无残留");
  evm = makeEntityVm();
  evm.platformEntityOptions[KEY] = [{ name: "残留项" }];
  evm.onEntityValueChange(ROW, "   ");
  assert.strictEqual(evm.platformEntityOptions[KEY].length, 0, "纯空白也算清空");

  // 选中候选项 → 下拉必须保留（不能误清）
  evm = makeEntityVm();
  evm.platformEntityOptions[KEY] = [{ name: "泳陷错恋" }];
  evm.onEntityValueChange(ROW, "泳陷错恋");
  assert.strictEqual(evm.platformEntityOptions[KEY].length, 1, "选中后下拉应保留");
  assert.strictEqual(evm.getPlatformVideoLinkValue(ROW.id), "泳陷错恋");

  // 空关键词 → 清空且不发请求
  evm = makeEntityVm();
  evm.platformEntityOptions[KEY] = [{ name: "残留项" }];
  let fetched = false;
  await evm.searchPlatformEntityOptions(ROW, "", async () => {
    fetched = true;
    return { ok: true, entities: [] };
  });
  assert.strictEqual(fetched, false, "空关键词不应发起请求");
  assert.strictEqual(evm.platformEntityOptions[KEY].length, 0);

  // 乱序返回 → 旧结果被丢弃（以最后一次输入为准）
  evm = makeEntityVm();
  const slow = evm.searchPlatformEntityOptions(
    ROW,
    "旧词",
    () => new Promise((r) => setTimeout(() => r({ ok: true, entities: [{ name: "旧结果" }] }), 120))
  );
  const fast = evm.searchPlatformEntityOptions(
    ROW,
    "新词",
    () => new Promise((r) => setTimeout(() => r({ ok: true, entities: [{ name: "新结果" }] }), 10))
  );
  await Promise.all([slow, fast]);
  assert.deepStrictEqual(
    evm.platformEntityOptions[KEY].map((item) => item.name),
    ["新结果"],
    "过期结果不应覆盖最新输入"
  );

  // 搜索失败 → 不残留旧结果
  evm = makeEntityVm();
  evm.platformEntityOptions[KEY] = [{ name: "旧结果" }];
  await evm.searchPlatformEntityOptions(ROW, "新词", async () => ({ ok: false, error: "失败" }));
  assert.strictEqual(evm.platformEntityOptions[KEY].length, 0, "失败时下拉应为空");

  // 清空后在途响应不得复活下拉（review 反馈的竞态）
  evm = makeEntityVm();
  let releaseInFlight;
  const inFlight = evm.searchPlatformEntityOptions(
    ROW,
    "泳陷",
    () => new Promise((r) => { releaseInFlight = () => r({ ok: true, entities: [{ name: "泳陷错恋" }] }); })
  );
  await Promise.resolve(); // 让请求进入在途状态
  evm.clearPlatformEntityOptions(ROW); // 用户点 ×
  assert.strictEqual(evm.platformEntityOptions[KEY].length, 0, "清空后下拉应为空");
  releaseInFlight(); // 在途响应此刻才返回
  await inFlight;
  assert.strictEqual(
    evm.platformEntityOptions[KEY].length,
    0,
    "清空后到达的在途响应不得复活下拉"
  );
  assert.strictEqual(evm.platformEntitySearched[KEY], false, "searched 不应被在途响应置回 true");

  // 清空后重新输入同一个关键词：旧的在途响应仍不得覆盖
  evm = makeEntityVm();
  let releaseStale;
  const stale = evm.searchPlatformEntityOptions(
    ROW,
    "泳陷",
    () => new Promise((r) => { releaseStale = () => r({ ok: true, entities: [{ name: "旧响应" }] }); })
  );
  await Promise.resolve();
  evm.clearPlatformEntityOptions(ROW);
  const fresh = evm.searchPlatformEntityOptions(ROW, "泳陷", okFetch(["新响应"]));
  await fresh;
  releaseStale();
  await stale;
  assert.deepStrictEqual(
    evm.platformEntityOptions[KEY].map((item) => item.name),
    ["新响应"],
    "清空后重输同一关键词，旧响应仍须被序号令牌拦下"
  );

  console.log("test-sph-entity-options passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
