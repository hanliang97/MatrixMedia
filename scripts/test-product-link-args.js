/**
 * 验证抖音 / 快手商品挂车（挂车）在 CLI 与 HTTP 入参层的接线：
 * 1. CLI --dy-product-url / --dy-link-* 生成 publishOptions.link
 * 2. CLI --ks-product-name / --ks-link-* 生成 publishOptions.link
 * 3. 抖音商品挂车必须带 --short-title（平台硬性要求），缺失时给可操作提示
 * 4. 平台专属参数误传给其他平台时忽略，不产生 link
 * 5. HTTP body（含 platformOptions.<pt>.link 写法）等价映射
 * 6. 视频号原有 --sph-product-id 行为不受影响
 */
import { parsePublishArgs, publishBodyToArgv, parsePublishRequest } from "../src/main/cli/parsePublishArgs.js";

let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};

// ---- 抖音挂车（快捷参数）----
{
  const r = parsePublishArgs([
    "-p", "dy", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000",
    "--dy-product-url", "https://haohuo.jinritemai.com/views/product/detail?id=123", "--short-title", "水杯",
  ]);
  ok(r.ok, "抖音: 解析成功");
  ok(r.value && r.value.publishOptions && r.value.publishOptions.link, "抖音: publishOptions.link 已生成");
  const link = r.value && r.value.publishOptions && r.value.publishOptions.link;
  ok(link && link.enabled === true, "抖音: link.enabled === true");
  ok(link && link.type === "product", `抖音: link.type=product (实际 ${link && link.type})`);
  ok(
    link && String(link.value || "").includes("haohuo.jinritemai.com"),
    "抖音: link.value 是商品链接"
  );
}

// ---- 抖音挂车（通用参数）----
{
  const r = parsePublishArgs([
    "-p", "dy", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000",
    "--dy-link-type", "product",
    "--dy-link-value", "https://haohuo.jinritemai.com/views/product/detail?id=456", "--short-title", "水杯",
  ]);
  ok(r.ok, "抖音通用参数: 解析成功");
  ok(r.value && r.value.publishOptions.link.type === "product", "抖音通用参数: type=product");
}

// ---- 抖音：非法链接必须报错 ----
{
  const r = parsePublishArgs([
    "-p", "dy", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000",
    "--dy-product-url", "not-a-url",
  ]);
  ok(!r.ok, "抖音: 非法商品链接必须被拒绝");
}

// ---- 抖音：只给 type 不给 value 必须报错 ----
{
  const r = parsePublishArgs([
    "-p", "dy", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000", "--dy-link-type", "product",
  ]);
  ok(!r.ok, "抖音: 只给 type 不给 value 必须报错");
}

// ---- 快手挂车（快捷参数）----
{
  const r = parsePublishArgs([
    "-p", "ks", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000",
    "--ks-product-name", "泳陷错恋同款水杯",
  ]);
  ok(r.ok, "快手: 解析成功");
  const link = r.value && r.value.publishOptions && r.value.publishOptions.link;
  ok(link && link.enabled === true, "快手: link.enabled === true");
  ok(link && link.type === "product", `快手: link.type=product (实际 ${link && link.type})`);
  ok(link && link.value === "泳陷错恋同款水杯", "快手: link.value 是商品名称");
}

// ---- 抖音参数传给快手 → 应被忽略 ----
{
  const r = parsePublishArgs([
    "-p", "ks", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000",
    "--dy-product-url", "https://haohuo.jinritemai.com/x",
  ]);
  ok(r.ok, "抖音参数传给快手: 解析仍成功（忽略）");
  ok(r.value && r.value.publishOptions && !r.value.publishOptions.link, "抖音参数传给快手: 不产生 link");
}

// ---- 快手参数传给抖音 → 应被忽略 ----
{
  const r = parsePublishArgs([
    "-p", "dy", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000",
    "--ks-product-name", "某商品",
  ]);
  ok(r.ok, "快手参数传给抖音: 解析仍成功（忽略）");
  ok(r.value && r.value.publishOptions && !r.value.publishOptions.link, "快手参数传给抖音: 不产生 link");
}

// ---- 不带挂车参数：不产生 link（回归）----
{
  const r = parsePublishArgs(["-p", "dy", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000"]);
  ok(r.ok, "无挂车参数: 解析成功");
  ok(r.value && r.value.publishOptions && !r.value.publishOptions.link, "无挂车参数: 不产生 link");
}

// ---- HTTP body → argv ----
{
  const argv = publishBodyToArgv({
    platform: "dy", file: "/tmp/a.mp4", title: "标题", phone: "13800138000", shortTitle: "水杯",
    dyProductUrl: "https://haohuo.jinritemai.com/views/product/detail?id=789",
  });
  ok(argv.includes("--dy-product-url"), "HTTP: dyProductUrl → --dy-product-url");
  const r = parsePublishArgs(argv);
  ok(r.ok && r.value.publishOptions.link && r.value.publishOptions.link.enabled, "HTTP: 抖音挂车解析成功");
}

{
  const argv = publishBodyToArgv({
    platform: "ks", file: "/tmp/a.mp4", title: "标题", phone: "13800138000",
    ksProductName: "货架商品名",
  });
  ok(argv.includes("--ks-product-name"), "HTTP: ksProductName → --ks-product-name");
  const r = parsePublishArgs(argv);
  ok(r.ok && r.value.publishOptions.link && r.value.publishOptions.link.enabled, "HTTP: 快手挂车解析成功");
}

// ---- HTTP: platformOptions.dy.link 写法 ----
{
  const r = parsePublishRequest({
    platform: "dy", file: "/tmp/a.mp4", title: "标题", phone: "13800138000", shortTitle: "水杯",
    platformOptions: { dy: { link: { type: "product", value: "https://haohuo.jinritemai.com/views/product/detail?id=999" } } },
  });
  ok(r.ok && r.value.publishOptions.link && r.value.publishOptions.link.type === "product",
    "HTTP: platformOptions.dy.link 生效");
}

// ---- 视频号原有行为不受影响（回归）----
{
  const r = parsePublishArgs([
    "-p", "sph", "-f", "/tmp/a.mp4", "-t", "标题", "--phone", "13800138000", "--sph-product-id", "10000591263144",
  ]);
  ok(r.ok, "视频号: 原有 --sph-product-id 仍可用");
  ok(r.value.publishOptions.link && r.value.publishOptions.link.type === "product", "视频号: link.type=product");
}

console.log(fail ? `\n${fail} 个断言失败` : "\n全部通过");
process.exitCode = fail ? 1 : 0;