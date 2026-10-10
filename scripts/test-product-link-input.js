"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  // 原样载入 ES 模块，不依赖 Babel，也不修改仓库的 CommonJS 配置。
  const source = fs.readFileSync(path.join(__dirname, "../src/shared/productLinkInput.js"), "utf8");
  const { validateDouyinProductUrl: check, DOUYIN_PRODUCT_URL_MAX_LENGTH: maxLength } =
    await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

  const productId = "00090071992547409931234567890123456789";
  const fullUrl = `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${productId}&token=a%2Bb%3D#detail`;
  assert.deepEqual(check(fullUrl), { ok: true, value: fullUrl });
  assert.deepEqual(check(`  ${fullUrl}  `), { ok: true, value: fullUrl });
  assert.deepEqual(check("HTTPS://V.DOUYIN.COM:443/AbC123/"), {
    ok: true, value: "https://v.douyin.com/AbC123/",
  });
  assert.deepEqual(check("http://v.douyin.com/AbC123/?a=1&a=2"), {
    ok: true, value: "http://v.douyin.com/AbC123/?a=1&a=2",
  });
  // 校验不是官方域名白名单；新商品域名由后续平台流程核验。
  assert.equal(check("https://new-product.example.com/item/123").ok, true);
  assert.equal(check("https://例子.测试/商品?id=001234567890123456789").ok, true);
  assert.equal(check("https://8.8.8.8/item").ok, true);
  assert.equal(check("https://192.0.8.1/item").ok, true);
  assert.equal(check("https://[2001:4860:4860::8888]/item").ok, true);
  assert.equal(check("https://172.15.255.255/item").ok, true);
  assert.equal(check("https://172.32.0.1/item").ok, true);

  const invalidInputs = [
    null, undefined, 9007199254740993, {}, [], "", "   ", productId,
    "v.douyin.com/AbC123/", "//v.douyin.com/AbC123/", "/product/123",
    "ftp://example.com/item", "file:///tmp/product", "javascript:alert(1)",
    "data:text/plain,product", "https:", "https://", "https:///example.com/item",
    "https://?item=123", "https://#product", "https://:443/item",
    "https://example.com:99999/item", "https://[not-ip]/item",
    "https://user:password@example.com/item", "https://user@example.com/item",
    "https://@example.com/item", "https://:password@example.com/item",
    "https://example.com\\@127.0.0.1/item", "https://example.com/with space",
    "看看这个商品 https://v.douyin.com/AbC123/", "https://v.douyin.com/AbC123/ 复制打开",
    "\nhttps://example.com/item", "https://example.com/item\n",
    "https://exam\tple.com/item", "https://example.com/\u0000item",
    "https://example.com/\u001fitem", "https://example.com/\u007fitem",
    "https://example.com/\u0085item", "https://example.com/\u2028item",
    "https://example.com/item?name=%0d%0aInjected", "https://example.com/%00item",
    "https://localhost/item", "https://LOCALHOST./item", "https://shop.localhost/item",
    "https://printer/item", "https://shop.local/item", "https://shop.internal/item",
    "https://shop.lan/item", "https://router.home/item", "https://router.home.arpa/item",
    "https://127.0.0.1/item", "https://127.1/item", "https://2130706433/item",
    "https://0x7f000001/item", "https://0177.0.0.1/item", "https://0.0.0.0/item",
    "https://10.2.3.4/item", "https://169.254.169.254/item", "https://172.16.0.1/item",
    "https://172.31.255.254/item", "https://192.168.1.1/item", "https://100.64.0.1/item",
    "https://198.18.0.1/item", "https://224.0.0.1/item", "https://255.255.255.255/item",
    "https://[::]/item", "https://[::1]/item", "https://[fc00::1]/item",
    "https://[fd12:3456::1]/item", "https://[fe80::1]/item", "https://[fec0::1]/item",
    "https://[ff02::1]/item", "https://[::ffff:127.0.0.1]/item",
    "https://[::ffff:192.168.1.1]/item", "https://[::127.0.0.1]/item",
    "https://[::ffff:0:127.0.0.1]/item", "https://[64:ff9b::10.0.0.1]/item",
  ];
  for (const input of invalidInputs) {
    const result = check(input);
    assert.equal(result.ok, false, `should reject ${JSON.stringify(input)}`);
    assert.equal(typeof result.value, "string");
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
  }

  const prefix = "https://example.com/";
  const boundary = prefix + "a".repeat(maxLength - prefix.length);
  assert.deepEqual(check(boundary), { ok: true, value: boundary });
  assert.equal(check(boundary + "a").ok, false);
  assert.equal(check(prefix + "商".repeat(300)).ok, false, "encoded URL must fit too");
  assert.equal(new URL(check(fullUrl).value).searchParams.get("id"), productId);
  assert.deepEqual(check(check(fullUrl).value), check(fullUrl), "normalization is idempotent");

  console.log(`test-product-link-input passed (${invalidInputs.length} invalid inputs plus valid/boundary checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
