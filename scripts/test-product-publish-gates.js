"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const stateKey = "__matrixMediaProductPublishGateTest";
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

// 原样执行平台 handler、链接解析、回执与结果归类；仅替换浏览器边界依赖。
// 商品模块自己的 DOM 测试独立执行，这里在模块边界注入失败以验证发布控制流。
const overrides = new Map([
  ["src/main/services/upLoad/dyProductLink.js", asModule(`
    export async function attachDyProductLink(page, link) {
      return globalThis.${stateKey}.attach("抖音", link);
    }
  `)],
  ["src/main/services/upLoad/ksProductLink.js", asModule(`
    export async function attachKsProductLink(page, link) {
      return globalThis.${stateKey}.attach("快手", link);
    }
  `)],
  ["src/main/services/upLoad/uploadTimeouts.js", asModule(`
    export const WAIT_SELECTOR_APPEAR_MS = 1;
    export const WAIT_UPLOAD_PROCESSING_MS = 1;
    export async function pollPageUntil() { return true; }
  `)],
  ["src/main/services/upLoad/failureScreenshot.js", asModule(`
    export async function capturePublishFailureScreenshot() { return ""; }
  `)],
  ["src/main/services/upLoad/closeWindow.js", asModule(`
    export default function maybeClosePublishWindow() {}
  `)],
]);
const moduleCache = new Map();
function moduleUrl(file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  assert.ok(relative.startsWith("src/"), `测试载入范围异常：${relative}`);
  if (overrides.has(relative)) return overrides.get(relative);
  if (moduleCache.has(relative)) return moduleCache.get(relative);
  const source = fs.readFileSync(absolute, "utf8").replace(
    /(\bfrom\s*)(["'])([^"']+)\2/g,
    (statement, prefix, quote, specifier) => {
      if (specifier === "path") return `${prefix}${quote}node:path${quote}`;
      assert.ok(specifier.startsWith("."), `未明确替换的外部依赖：${specifier}`);
      const dependency = path.relative(root, path.resolve(path.dirname(absolute), specifier));
      return `${prefix}${quote}${moduleUrl(dependency)}${quote}`;
    }
  );
  const url = asModule(source);
  moduleCache.set(relative, url);
  return url;
}

function makeHarness(platform, options = {}) {
  const calls = [];
  const replies = [];
  let submitCount = 0;
  const submit = () => {
    calls.push("submit");
    submitCount++;
  };
  const handle = (selector) => ({
    async uploadFile() {},
    async click() {
      if (selector === "#popover-tip-container" || selector === "#popover-tip-container+button") submit();
    },
  });
  const page = {
    async waitForSelector(selector) { return handle(selector); },
    async $(selector) { return handle(selector); },
    async $$(selector) { return [handle(selector)]; },
    async click() {},
    async type() {},
    keyboard: { async press() {}, async type() {} },
    async waitForFunction() { return true; },
    async waitForTimeout() {},
    async evaluate(callback, ...args) {
      // 快手最终按钮在 inline evaluate 中；成功用例同时验证该 spy 确实能捕获点击。
      if (platform === "快手" && ["发布", "取消"].includes(args[0]) &&
          callback.toString().includes("#setting-tours + div")) {
        submit();
        return { ok: true, via: "button" };
      }
      return true;
    },
    url() {
      return submitCount && !options.urlUnchanged
        ? "https://creator.example.test/success"
        : "https://creator.example.test/publish";
    },
  };
  const state = {
    page, calls, replies,
    async attach(actualPlatform, link) {
      assert.equal(actualPlatform, platform);
      assert.equal(link.enabled, true);
      calls.push("attach");
      if (options.attachFailure) throw new Error(options.attachFailure);
      return { attached: true, value: link.value };
    },
    event: {
      reply(channel, payload) {
        assert.equal(channel, "puppeteerFile-done");
        replies.push(payload);
        if (options.queueTransport && payload.status === false) {
          const error = new Error(payload.message);
          error._mmUploadFailurePayload = payload;
          throw error;
        }
      },
    },
  };
  return state;
}

async function main() {
  const [{ default: dy }, { default: ks }, { resolvePublishCompletion }, { getPublishAttemptLimit }] =
    await Promise.all([
      import(moduleUrl("src/main/services/upLoad/dy.js")),
      import(moduleUrl("src/main/services/upLoad/ks.js")),
      import(moduleUrl("src/shared/publishResult.js")),
      import(moduleUrl("src/shared/xhsPublishPolicy.js")),
    ]);
  let scenarioCount = 0;
  const logs = { log: console.log, warn: console.warn, error: console.error };
  try {
    console.log = console.warn = console.error = () => {};
    for (const [platform, handler] of [["抖音", dy], ["快手", ks]]) {
      const product = {
        enabled: true, type: "product",
        value: platform === "抖音" ? "https://haohuo.jinritemai.com/item/123" : "测试商品完整原名",
        ...(platform === "抖音" ? { shortTitle: "视频同款" } : {}),
      };
      const scenarios = [
        { name: "未配置链接", link: undefined, attached: false },
        { name: "明确无链接", link: { enabled: true, type: "none" }, attached: false },
        { name: "商品已禁用", link: { ...product, enabled: false }, attached: false },
        { name: "挂载确认后发布", link: product, attached: true },
        ...["带货权限未开通", "未找到目标商品", "同名商品不能唯一选择", "回显商品不匹配"].map((reason) => ({
          name: reason, link: product, attached: true, attachFailure: reason,
        })),
        { name: "无链接保留草稿行为", link: undefined, draft: true, attached: false },
        { name: "挂载成功后存草稿", link: product, draft: true, attached: true },
        { name: "挂载失败不存无商品草稿", link: product, draft: true, attached: true, attachFailure: "挂载未确认" },
        { name: "失败传给队列", link: product, attached: true, attachFailure: "商品无效", queueTransport: true },
        { name: "点击后未跳转不记成功", link: product, attached: true, urlUnchanged: true },
      ];
      for (const scenario of scenarios) {
        const state = makeHarness(platform, scenario);
        globalThis[stateKey] = state;
        const data = {
          pt: platform, filePath: "fixture.mp4", data: { title: "测试", tags: [], creativeStatement: "none" },
          ...(scenario.link === undefined ? {} : { publishOptions: { link: scenario.link } }),
          ...(scenario.draft ? { publishMode: "draft" } : {}),
        };
        if (scenario.queueTransport) {
          await assert.rejects(handler(state.page, data, {}, state.event), (error) =>
            error._mmUploadFailurePayload === state.replies[0]);
        } else {
          await handler(state.page, data, {}, state.event);
        }
        const label = `${platform}：${scenario.name}`;
        assert.equal(state.calls.filter((call) => call === "attach").length, scenario.attached ? 1 : 0, label);
        assert.equal(state.calls.filter((call) => call === "submit").length, scenario.attachFailure ? 0 : 1, label);
        assert.equal(state.replies.length, 1, `${label}：只能回执一次`);
        const payload = state.replies[0];
        const completion = resolvePublishCompletion(payload);
        if (scenario.attachFailure) {
          assert.equal(payload.status, false, label);
          assert.equal(completion.recordStatus, "failed", label);
          assert.equal(completion.status, "failed", label);
          assert.equal(completion.exitCode, 3, label);
          assert.equal(completion.savedAsDraft, false, label);
          assert.equal(getPublishAttemptLimit(data), 1, `${label}：不可自动重传`);
        } else {
          if (scenario.attached) assert.deepEqual(state.calls, ["attach", "submit"], `${label}：先挂载后提交`);
          const expectedStatus = scenario.urlUnchanged ? "abnormal" : scenario.draft ? "draft" : "success";
          assert.equal(completion.recordStatus, expectedStatus, label);
          assert.equal(completion.exitCode, scenario.urlUnchanged ? 4 : 0, label);
          if (scenario.urlUnchanged) {
            assert.equal(payload.needsAttention, true, label);
            assert.equal(completion.status, "publish_abnormal", label);
            assert.equal(getPublishAttemptLimit(data), 1, `${label}：不重发可能已生效的任务`);
          }
        }
        scenarioCount++;
      }
      for (const link of [undefined, { enabled: false, type: "product" }, { enabled: true, type: "none" }]) {
        const data = { pt: platform, publishOptions: { link } };
        assert.equal(getPublishAttemptLimit(data), 5, "未挂车保持现有重试策略");
        assert.equal(getPublishAttemptLimit(data, 3), 3, "未挂车保持调用方配置");
      }
      assert.equal(getPublishAttemptLimit({ pt: platform, publishOptions: { link: product } }, 3), 1);
      assert.equal(getPublishAttemptLimit({ pt: platform, publishOptions: { link: { ...product, value: "" } } }), 1);
    }
    for (const pt of ["视频号", "哔哩哔哩", "百家号"]) {
      assert.equal(getPublishAttemptLimit({ pt, publishOptions: { link: { enabled: true, type: "product" } } }), 5);
    }
    assert.equal(getPublishAttemptLimit({ pt: "小红书" }), 1);
    assert.equal(getPublishAttemptLimit({ pt: "小红书", publishOptions: { link: { enabled: true, type: "product" } } }), 1);
    assert.equal(getPublishAttemptLimit(null), 5);
  } finally {
    Object.assign(console, logs);
    delete globalThis[stateKey];
  }
  console.log(`test-product-publish-gates passed (${scenarioCount} handler scenarios plus retry scope checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
