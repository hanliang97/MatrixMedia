"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function main() {
  const helper = dataUrl(fs.readFileSync(path.join(root, "src/shared/productLinkInput.js"), "utf8"));
  const source = fs.readFileSync(path.join(root, "src/shared/videoLink.js"), "utf8")
    .replace('"./productLinkInput.js"', JSON.stringify(helper));
  const links = await import(dataUrl(source));
  const build = links.buildVideoLinkOption;
  const url = "https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=000900719925474099312345";
  const dy = build("抖音", "product", url, { shortTitle: "视频同款香薰" });
  assert.equal(dy.ok, true);
  assert.equal(dy.value.value, url);
  assert.equal(dy.value.shortTitle, "视频同款香薰");
  assert.equal(dy.value.failurePolicy, "stop");
  assert.equal(dy.value.selectionMode, "product_url");
  for (const shortTitle of ["", " ", "一二三四五六七八九十超", "香薰\n", "香\u0000薰"]) {
    assert.equal(build("抖音", "product", url, { shortTitle }).ok, false);
  }
  assert.equal(build("抖音", "product", url, { shortTitle: "一二三四五六七八九十" }).ok, true);
  assert.equal(build("抖音", "product", "10000591263144", { shortTitle: "商品" }).ok, false);
  assert.equal(build("抖音", "product", "javascript:alert(1)", { shortTitle: "商品" }).ok, false);
  assert.equal(build("抖音", "product", url).ok, false);
  const productName = "【3瓶装】测试商品 完整名称 60ml";
  const ks = build("快手", "product", productName);
  assert.equal(ks.ok, true);
  assert.equal(ks.value.value, productName);
  assert.equal(ks.value.selectionMode, "exact_product_name");
  assert.equal(ks.value.inputKind, "product_name");
  assert.equal(ks.value.failurePolicy, "stop");
  for (const invalid of ["", "\n商品", "商品\t", "长".repeat(201), 123]) {
    assert.equal(build("快手", "product", invalid).ok, false);
  }
  assert.equal(build("视频号", "product", "001234567890123456789").value.value, "001234567890123456789");
  assert.equal(build("视频号", "product", productName).ok, false);
  assert.equal(build("视频号", "product", "1").value.failurePolicy, "save_draft");
  assert.equal(build("视频号", "mini_drama", "测试短剧").ok, true);
  for (const pt of ["抖音", "快手", "视频号", "其他平台"]) {
    assert.equal(build(pt, "none", "stale").value.enabled, false);
    assert.equal(links.resolveVideoLinkOption(pt, {}).enabled, false);
  }
  assert.deepEqual(links.resolveVideoLinkOption("抖音", { link: dy.value }), dy.value);
  assert.deepEqual(links.resolveVideoLinkOption("快手", { link: ks.value }), ks.value);
  assert.equal(links.resolveVideoLinkOption("抖音", { link: { ...dy.value, shortTitle: "标题\n" } }).shortTitle, "标题\n");
  assert.equal(links.resolveVideoLinkOption("快手", { link: { ...ks.value, value: 123 } }).value, 123);

  // 执行真实 Vue 方法，验证账号间配置、回填和发送前校验，不需要 Electron 或浏览器。
  const vue = fs.readFileSync(path.join(root, "src/renderer/components/LocalVideoPublish.vue"), "utf8");
  const script = vue.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "")
    .replace("export default", "globalThis.component =");
  const importedNames = [...vue.matchAll(/^import\s+([\s\S]*?)\s+from\s+["'][^"']+["'];/gm)]
    .flatMap((match) => match[1].replace(/[{}]/g, "").split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  const stubs = Object.fromEntries(importedNames.map((name) => [name, () => { throw new Error(`Unexpected unrelated dependency: ${name}`); }]));
  const context = vm.createContext({ ...stubs, ...links });
  vm.runInContext(script, context);
  const state = { platformVideoLinks: {}, $set: (o, k, v) => { o[k] = v; } };
  for (const [name, fn] of Object.entries(context.component.methods)) state[name] = fn.bind(state);
  state.getPlatformStatement = () => "none";
  state.clearPlatformEntityCache = () => {};
  const loaded = [];
  state.loadPlatformWindowProducts = (row) => loaded.push(row.pt);
  const rows = [{ id: "dy", pt: "抖音", phone: "test-dy" }, { id: "ks", pt: "快手", phone: "test-ks" }, { id: "sph", pt: "视频号", phone: "test-sph" }];
  rows.forEach((row) => state.onAttrsLinkTypeChange(row, "product"));
  assert.deepEqual(loaded, ["视频号"]);
  state.setPlatformVideoLinkValue("dy", "抖音", url);
  assert.match(state.validatePlatformVideoLinks([rows[0]]), /短标题/);
  assert.throws(() => state.buildPlatformVideoPayload(rows[0], { data: {} }), /短标题/);
  state.setPlatformVideoLinkShortTitle("dy", "抖音", "同款商品");
  state.setPlatformVideoLinkValue("dy", "抖音", url + "&x=1");
  assert.equal(state.getPlatformVideoLinkShortTitle("dy"), "同款商品");
  state.setPlatformVideoLinkValue("ks", "快手", productName);
  assert.equal(state.getPlatformVideoLinkShortTitle("ks"), "");
  assert.equal(state.validatePlatformVideoLinks(rows.slice(0, 2)), "");
  assert.equal(state.buildPlatformVideoPayload(rows[0], { data: {} }).publishOptions.link.shortTitle, "同款商品");
  assert.equal(state.buildPlatformVideoPayload(rows[1], { data: {} }).publishOptions.link.value, productName);
  state.getAllPlatformLeafNodes = () => rows.slice(0, 2);
  state.findRepublishRecord = (pt) => ({ publishOptions: { link: pt === "抖音" ? dy.value : ks.value } });
  state.applyRepublishPlatformVideoLinks();
  assert.equal(state.getPlatformVideoLinkShortTitle("dy"), "视频同款香薰");
  state.onAttrsLinkTypeChange(rows[0], "none");
  assert.equal(state.getPlatformVideoLinkShortTitle("dy"), "");
  assert.equal(state.buildPlatformVideoPayload(rows[0], { data: {} }).publishOptions.link.enabled, false);
  // 真实橱窗/短剧请求路由：新增商品平台不得误调视频号接口，旧短剧搜索仍可工作。
  const requests = [];
  context.ipcRenderer = { invoke: async (channel, args) => { requests.push({ channel, args }); return { ok: true, products: [], entities: [{ name: "测试短剧" }] }; } };
  state.platformProductOptions = {}; state.platformProductLoading = {};
  state.platformEntityOptions = {}; state.platformEntityLoading = {};
  state.platformEntitySeq = {}; state.platformEntitySearched = {}; state.componentSeq = 0;
  state.$message = { warning: (x) => { throw new Error(x); }, error: (x) => { throw new Error(x); }, info: () => {} };
  state.setPlatformVideoLinkType("dy", "抖音", "product");
  for (const row of rows.slice(0, 2)) await context.component.methods.loadPlatformWindowProducts.call(state, row);
  assert.equal(requests.length, 0);
  await context.component.methods.loadPlatformWindowProducts.call(state, rows[2]);
  assert.equal(requests[0].channel, "sph:list-window-products");
  state.setPlatformVideoLinkType("sph", "视频号", "mini_drama");
  await state.searchPlatformEntityOptions(rows[2], "测试");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].args.queryString, "测试");
  assert.equal(state.platformEntityOptions["sph:mini_drama"][0].name, "测试短剧");
  // 目录批量入口不能静默丢商品，包括绕过外层直接调用及定时/草稿路径。
  const warnings = [];
  state.$message.warning = (x) => warnings.push(x);
  state.$refs = { tree: { getCheckedNodes: () => [{ ...rows[0], url: "test" }] } };
  state.dirBatchFiles = [{ fileName: "sample.mp4" }];
  state.setPlatformVideoLinkType("dy", "抖音", "product");
  let directorySends = 0;
  context.ipcRenderer.send = () => { directorySends++; };
  for (const mode of ["publish", "draft"]) {
    for (const scheduled of [false, true]) {
      state.scheduledPublish = scheduled;
      await state.submitDirBatchPublish(mode);
      await state.doSubmitBatchPublish(mode);
    }
  }
  assert.equal(warnings.length, 8);
  assert.ok(warnings.every((x) => x.includes("目录批量暂不支持")));
  assert.equal(directorySends, 0);
  console.log("test-dy-ks-link-options passed: platform contracts, validation, real Vue methods and republish round trip");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
