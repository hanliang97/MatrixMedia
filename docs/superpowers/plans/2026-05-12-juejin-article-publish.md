# 掘金文章发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增掘金文章发布能力，并让 GUI、CLI、MCP、一次性定时发布共用现有发布队列和历史记录。

**Architecture:** 复用 `puppeteerFile` / `runPuppeteerTask` 的窗口队列，在平台配置和 `Type.js` 中注册 `掘金`，通过新的 `upLoad/juejin.js` 执行编辑页自动化。GUI 新增 `LocalArticlePublish.vue` 放在视频管理页入口；CLI 新增 `publish-article` 子命令；MCP 新增 `publish_article` 工具；定时调度按 `textType: "article"` 重建文章任务载荷。

**Tech Stack:** Electron、Vue 2、Element UI、Puppeteer in Electron、Node.js fs/path、TypeScript MCP server。

---

## File Structure

- Create `src/main/cli/parsePublishArticleArgs.js`：解析 `cli publish-article` 参数，负责正文来源、默认分类/标签、partition 派生。
- Modify `src/main/cli/index.js`：注册 `publish-article` 子命令，构造文章任务，写入 `pushData` 历史，支持 `--publish-at`。
- Create `src/main/services/upLoad/juejin.js`：掘金编辑页自动化，填写标题/正文/封面/分类/标签并确认发布。
- Modify `src/main/services/upLoad/index.js`：导出 `juejin`。
- Modify `src/main/services/Type.js`：映射 `掘金` 到 `juejin`。
- Modify `src/main/config/ptConfig.js` 和 `src/renderer/utils/configUrl.js`：新增掘金平台地址。
- Modify `src/main/services/ipcMain.js`：新增文章文件、图片文件选择 IPC。
- Modify `src/main/services/scheduledPublish.js`：定时任务支持 `textType: "article"` 载荷。
- Create `src/renderer/components/LocalArticlePublish.vue`：文章发布弹窗，复用账号树选择体验。
- Modify `src/renderer/views/videoManager/index.vue`：新增文章发布入口、组件引用、文章历史聚合兼容。
- Create `mcp/src/tools/publishArticle.ts`：MCP `publish_article` 工具。
- Modify `mcp/src/index.ts`：注册 `publish_article`。
- Modify `docs/cli.md`：补充文章发布 CLI。
- Create `scripts/test-publish-article-args.js`：验证 CLI 参数解析和定时记录构造。

### Task 1: CLI 参数解析

**Files:**
- Create: `src/main/cli/parsePublishArticleArgs.js`
- Test: `scripts/test-publish-article-args.js`
- Modify: `package.json`

- [ ] **Step 1: Add parser test script**

Create `scripts/test-publish-article-args.js` with focused assertions for the parser:

```js
require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  parsePublishArticleArgs,
} = require("../src/main/cli/parsePublishArticleArgs");

function ok(argv) {
  const parsed = parsePublishArticleArgs(argv);
  assert.strictEqual(parsed.ok, true, parsed.error);
  return parsed.value;
}

function fail(argv, text) {
  const parsed = parsePublishArticleArgs(argv);
  assert.strictEqual(parsed.ok, false);
  assert.ok(parsed.error.includes(text), parsed.error);
}

const base = ["-p", "juejin", "--phone", "13800138000", "-t", "标题"];

assert.strictEqual(ok([...base, "--content", "正文"]).platform, "掘金");
assert.strictEqual(ok([...base, "--content", "正文"]).partition, "persist:13800138000掘金");
assert.strictEqual(ok([...base, "--content", "正文"]).category, "前端");
assert.strictEqual(ok([...base, "--content", "正文"]).tags, "前端 electron");
assert.strictEqual(ok([...base, "--file", "./a.md"]).file, "./a.md");
assert.strictEqual(ok([...base, "--content", "正文", "--publish-at", "2026-05-13 10:00:00"]).publishAt, "2026-05-13 10:00:00");

fail(["-p", "dy", "--phone", "13800138000", "-t", "标题", "--content", "正文"], "未知平台");
fail(["-p", "juejin", "--phone", "13800138000", "--content", "正文"], "缺少 --title");
fail(["-p", "juejin", "--phone", "13800138000", "-t", "标题"], "缺少 --content 或 --file");
fail(["-p", "juejin", "-t", "标题", "--content", "正文"], "缺少 --phone 或完整 --partition");

console.log("test-publish-article-args passed");
```

- [ ] **Step 2: Add npm script**

Modify `package.json` scripts:

```json
"test:publish-article-args": "node scripts/test-publish-article-args.js"
```

- [ ] **Step 3: Run failing parser test**

Run:

```bash
yarn test:publish-article-args
```

Expected before implementation: module not found for `parsePublishArticleArgs`.

- [ ] **Step 4: Implement parser**

Create `src/main/cli/parsePublishArticleArgs.js`:

```js
"use strict";

const PLATFORM_ALIASES = {
  juejin: "掘金",
  jj: "掘金",
  掘金: "掘金",
};

export function parsePublishArticleArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }

  const out = {
    platform: null,
    title: null,
    content: "",
    file: null,
    cover: "",
    phone: null,
    partition: null,
    category: "前端",
    tags: "前端 electron",
    summary: "",
    publishAt: null,
    show: false,
    closeWindowAfterPublish: true,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") out.platform = args[++i];
    else if (a === "--title" || a === "-t") out.title = args[++i];
    else if (a === "--content") out.content = args[++i] || "";
    else if (a === "--file" || a === "-f") out.file = args[++i];
    else if (a === "--cover") out.cover = args[++i] || "";
    else if (a === "--phone") out.phone = args[++i];
    else if (a === "--partition") out.partition = args[++i];
    else if (a === "--category") out.category = args[++i] || "前端";
    else if (a === "--tags") out.tags = args[++i] || "前端 electron";
    else if (a === "--summary") out.summary = args[++i] || "";
    else if (a === "--publish-at") out.publishAt = args[++i];
    else if (a === "--show") out.show = true;
    else if (a === "--no-close-window") out.closeWindowAfterPublish = false;
  }

  if (!out.platform) return { ok: false, error: "缺少 --platform（或 -p），例如 juejin / 掘金" };
  const raw = String(out.platform).trim();
  const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[raw.toLowerCase()] || raw;
  if (pt !== "掘金") return { ok: false, error: `未知平台: ${out.platform}` };
  out.platform = pt;

  if (!out.partition) {
    if (!out.phone) {
      return { ok: false, error: "缺少 --phone 或完整 --partition（如 persist:13800138000掘金）" };
    }
    const phoneSeg = String(out.phone).split("-")[0];
    out.partition = `persist:${phoneSeg}${out.platform}`;
  }

  if (!out.title || !String(out.title).trim()) {
    return { ok: false, error: "缺少 --title（或 -t）文章标题" };
  }

  if (!String(out.content || "").trim() && !out.file) {
    return { ok: false, error: "缺少 --content 或 --file，请提供正文或 .md/.txt 文件" };
  }

  if (out.show) {
    console.warn("MatrixMedia: CLI publish-article 不显示浏览器窗口，已忽略 --show。");
    out.show = false;
  }

  return { ok: true, value: out };
}

export function publishArticleHelpText() {
  return `
用法: <应用> cli publish-article [选项]

选项:
  -p, --platform <id>   平台：juejin|掘金
      --phone <id>      账号手机号（可与 partition 二选一）
      --partition <p>   完整 session partition，如 persist:13800138000掘金
  -t, --title <text>    文章标题（必填）
      --content <text>  文章正文；与 --file 二选一
  -f, --file <path>     .md/.txt 正文文件；与 --content 二选一
      --cover <path>    可选封面图片
      --category <text> 分类，默认“前端”
      --tags <text>     标签，空格分隔，默认“前端 electron”
      --summary <text>  可选摘要；不传则由掘金自动生成
      --publish-at <t>  一次性定时发布，格式 "YYYY-MM-DD HH:mm:ss"
      --show            （已忽略）CLI 不显示自动化窗口
      --no-close-window 发布后不自动关窗（CLI 下无效）
  -h, --help            显示帮助
`.trim();
}
```

- [ ] **Step 5: Run parser test**

Run:

```bash
yarn test:publish-article-args
```

Expected: `test-publish-article-args passed`.

### Task 2: Platform Registration

**Files:**
- Modify: `src/main/config/ptConfig.js`
- Modify: `src/renderer/utils/configUrl.js`
- Modify: `src/main/services/upLoad/index.js`
- Modify: `src/main/services/Type.js`

- [ ] **Step 1: Add main platform config**

Add `掘金` to `src/main/config/ptConfig.js`:

```js
  掘金: {
    index: "https://juejin.cn/login",
    upload: "https://juejin.cn/editor/drafts/new",
    useragent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    listIndex: "https://juejin.cn/editor/drafts",
  },
```

- [ ] **Step 2: Add renderer platform config**

Add the same `掘金` object to `src/renderer/utils/configUrl.js`.

- [ ] **Step 3: Register upload handler export**

Modify `src/main/services/upLoad/index.js`:

```js
export { default as juejin } from "./juejin.js";
```

- [ ] **Step 4: Register Type mapping**

Modify `src/main/services/Type.js` imports and map:

```js
import { dy, bjh, blbl, sph, tt, ks, xhs, juejin } from "./upLoad";

export default {
  // ...
  掘金: juejin,
};
```

### Task 3: Juejin Automation Handler

**Files:**
- Create: `src/main/services/upLoad/juejin.js`

- [ ] **Step 1: Create automation handler**

Create `src/main/services/upLoad/juejin.js`:

```js
import fs from "fs";
import path from "path";
import { clipboard } from "electron";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

function getErrorMessage(error) {
  if (!error) return "未知错误";
  return error.message || (typeof error === "string" ? error : String(error));
}

function normalizeTags(raw) {
  const text = String(raw || "").trim() || "前端 electron";
  return text.split(/[\s,，;；、]+/).map(v => v.trim()).filter(Boolean);
}

function readArticleContent(data) {
  const direct = String(data.data?.content || "").trim();
  if (direct) return direct;
  const filePath = data.data?.articleFilePath || data.articleFilePath;
  if (!filePath) throw new Error("请填写正文或选择文章文件");
  return fs.readFileSync(path.resolve(filePath), "utf-8");
}

async function pasteText(page, text) {
  const original = clipboard.readText();
  const modifierKey = process.platform === "darwin" ? "Meta" : "Control";
  try {
    clipboard.writeText(text);
    await page.keyboard.down(modifierKey);
    await page.keyboard.press("KeyV");
    await page.keyboard.up(modifierKey);
  } finally {
    clipboard.writeText(original);
  }
}

async function clickByText(page, selector, text, label) {
  const clicked = await page.evaluate((sel, targetText) => {
    const norm = value => String(value || "").replace(/\s+/g, "").trim();
    const items = Array.from(document.querySelectorAll(sel));
    const item = items.find(el => norm(el.textContent) === norm(targetText));
    if (!item) return false;
    item.scrollIntoView({ block: "center", inline: "center" });
    item.click();
    return true;
  }, selector, text);
  if (!clicked) throw new Error(`未找到${label}: ${text}`);
}

async function fillInput(page, selector, value, label) {
  await page.waitForSelector(selector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (value) await page.type(selector, value, { delay: 30 });
}

async function selectTag(page, tag) {
  const inputSelector = ".tag-input .byte-select__input";
  await page.waitForSelector(inputSelector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
  await page.click(inputSelector);
  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  await page.keyboard.press("Backspace");
  await page.type(inputSelector, tag, { delay: 50 });
  await page.waitForTimeout(800);

  const clicked = await page.evaluate(tagText => {
    const norm = value => String(value || "").replace(/\s+/g, "").trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll(".byte-select-option, .byte-select__option, [class*='option']"));
    const hit = candidates.find(el => norm(el.textContent).includes(norm(tagText)));
    if (!hit) return false;
    hit.scrollIntoView({ block: "center", inline: "center" });
    hit.click();
    return true;
  }, tag);

  if (!clicked) {
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(500);
}

export default async function (page, data, window, event) {
  let publishStage = "初始化";
  try {
    const article = data.data || {};
    const title = String(article.title || article.bt1 || data.bt || "").trim();
    if (!title) throw new Error("请填写文章标题");

    publishStage = "读取正文";
    const content = readArticleContent(data);
    if (!String(content || "").trim()) throw new Error("文章正文为空");

    publishStage = "填写标题";
    await fillInput(page, ".header .title-input", title, "掘金标题输入框");

    publishStage = "填写正文";
    const editorSelector = ".bytemd-editor .CodeMirror-code .CodeMirror-line";
    await page.waitForSelector(editorSelector, { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
    await page.click(editorSelector, { clickCount: 2 });
    await pasteText(page, content);
    await page.waitForTimeout(1000);

    const coverPath = article.coverPath || data.coverPath;
    if (coverPath) {
      publishStage = "上传封面";
      const coverInputSelector = ".coverselector_container input[type='file']";
      await page.waitForSelector(coverInputSelector, { timeout: WAIT_SELECTOR_APPEAR_MS });
      const input = await page.$(coverInputSelector);
      if (!input) throw new Error("未找到掘金封面上传 input");
      await input.uploadFile(path.resolve(coverPath));
      await page.waitForTimeout(2000);
    }

    publishStage = "打开发布弹窗";
    await page.waitForSelector(".right-box button.xitu-btn", { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
    await page.click(".right-box button.xitu-btn");
    await page.waitForTimeout(1000);

    publishStage = "选择分类";
    await clickByText(page, ".category-list .item", article.category || "前端", "掘金分类");

    publishStage = "选择标签";
    const tags = normalizeTags(article.tags || article.bq || data.bq);
    for (const tag of tags) {
      await selectTag(page, tag);
    }

    if (article.summary) {
      publishStage = "填写摘要";
      await fillInput(page, ".summary-textarea textarea", String(article.summary), "掘金摘要输入框");
    }

    publishStage = "确认发布";
    await page.waitForSelector(".footer .btn-container .ui-btn.primary", { visible: true, timeout: WAIT_SELECTOR_APPEAR_MS });
    await page.click(".footer .btn-container .ui-btn.primary");

    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "文章发布成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (e) {
    const detail = getErrorMessage(e);
    console.error(`掘金文章发布失败，阶段：${publishStage}`, e);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: `文章发布失败：${publishStage} - ${detail}`,
    });
    maybeClosePublishWindow(data, window);
  }
}
```

### Task 4: CLI Publish Article Command

**Files:**
- Modify: `src/main/cli/index.js`
- Modify: `src/main/cli/parsePublishArticleArgs.js`
- Test: `scripts/test-publish-article-args.js`

- [ ] **Step 1: Export parser from CLI index**

Add imports/exports:

```js
import { parsePublishArticleArgs, publishArticleHelpText } from "./parsePublishArticleArgs";

export {
  parsePublishArticleArgs,
  publishArticleHelpText,
};
```

- [ ] **Step 2: Add article helper functions**

In `src/main/cli/index.js`, add near `fileStem`:

```js
function articleFileName(filePath) {
  return filePath ? path.basename(filePath) : "";
}

function deriveArticlePhoneForRecord(v) {
  if (v.phone) return String(v.phone);
  if (!v.partition) return "";
  const stripped = String(v.partition).replace(/^persist:/, "");
  const idx = stripped.indexOf(v.platform);
  return idx > 0 ? stripped.slice(0, idx) : stripped;
}
```

- [ ] **Step 3: Register command in usage/help**

Update CLI top-level messages:

```js
console.error("用法: <应用> cli <publish|publish-article|login|accounts|history> ...");
console.error("  cli publish-article --help");
```

and:

```js
console.log("可用子命令: publish | publish-article | login | accounts | history");
```

- [ ] **Step 4: Implement `publish-article` branch**

Add before `accounts` branch:

```js
  if (cmd === "publish-article") {
    const parsed = parsePublishArticleArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(publishArticleHelpText());
      return 0;
    }

    const v = parsed.value;
    const cfg = ptConfig[v.platform];
    if (!cfg) {
      console.error("内部错误: 未找到平台配置", v.platform);
      return 2;
    }

    const resolvedArticleFile = v.file ? path.resolve(v.file) : "";
    const resolvedCover = v.cover ? path.resolve(v.cover) : "";
    const title = String(v.title).trim();
    const taskPayload = {
      taskId: Date.now() + Math.random(),
      bookName: title,
      textType: "article",
      data: {
        title,
        content: String(v.content || ""),
        articleFilePath: resolvedArticleFile,
        coverPath: resolvedCover,
        category: String(v.category || "前端").trim() || "前端",
        tags: String(v.tags || "前端 electron").trim() || "前端 electron",
        summary: String(v.summary || ""),
      },
      textOtherName: title,
      selectedFile: articleFileName(resolvedArticleFile),
      url: cfg.upload,
      show: v.show,
      mmCliSuppressWindow: true,
      closeWindowAfterPublish: true,
      useragent: cfg.useragent,
      partition: v.partition,
      pt: v.platform,
      phone: deriveArticlePhoneForRecord(v),
      coverPath: resolvedCover,
    };

    const recordDate = todayYmd();
    const recordItem = {
      bookName: title,
      textOtherName: title,
      textType: "article",
      pt: v.platform,
      selectedFile: articleFileName(resolvedArticleFile),
      bt: title,
      bq: taskPayload.data.tags,
      articleFilePath: resolvedArticleFile,
      coverPath: resolvedCover,
      category: taskPayload.data.category,
      summary: taskPayload.data.summary,
      content: taskPayload.data.content,
      useragent: cfg.useragent,
      phone: taskPayload.phone,
      partition: v.partition,
      url: cfg.listIndex,
      uploadUrl: cfg.upload,
      date: recordDate,
      publishAttemptCount: 1,
      republishCount: 0,
      publishSuccessCount: 0,
      publishFailCount: 0,
      publishStatus: "publishing",
      lastPublishMessage: "等待发布结果",
      lastPublishAt: Date.now(),
    };

    if (v.publishAt) {
      let scheduledRecord;
      try {
        scheduledRecord = createScheduledRecord(recordItem, v.publishAt);
      } catch (e) {
        console.error(e && e.message ? e.message : e);
        return 2;
      }
      try {
        const addRes = changeData({ fileName: "pushData", type: "add", item: scheduledRecord });
        let recordId = null;
        if (addRes && addRes.success && Array.isArray(addRes.data)) {
          const found = [...addRes.data].reverse().find(
            it => it.scheduledTask === true && it.scheduledPublishAt === scheduledRecord.scheduledPublishAt && it.textOtherName === scheduledRecord.textOtherName && it.pt === scheduledRecord.pt
          );
          if (found) recordId = found.id;
        }
        console.log(JSON.stringify({
          status: true,
          scheduled: true,
          id: recordId,
          publishAt: scheduledRecord.scheduledPublishAtText,
          message: "定时文章发布任务已创建，已写入发布历史",
        }));
        return 0;
      } catch (e) {
        console.error("MatrixMedia: 写入定时文章发布记录失败:", e && e.message);
        return 1;
      }
    }

    let recordId = null;
    try {
      const addRes = changeData({ fileName: "pushData", type: "add", item: recordItem });
      if (addRes && addRes.success && Array.isArray(addRes.data)) {
        const found = [...addRes.data].reverse().find(
          it => it.textOtherName === recordItem.textOtherName && it.pt === recordItem.pt && it.textType === recordItem.textType
        );
        if (found) recordId = found.id;
      }
    } catch (e) {
      console.error("MatrixMedia: 写入文章 pushData 初始记录失败:", e && e.message);
    }

    const taskId = taskPayload.taskId;
    const updateRecord = (status, message) => {
      if (!recordId) return;
      try {
        changeData({
          fileName: "pushData",
          type: "update",
          item: {
            id: recordId,
            date: recordDate,
            publishStatus: status,
            publishSuccessCount: status === "success" ? 1 : 0,
            publishFailCount: status === "failed" ? 1 : 0,
            lastPublishMessage: message || "",
            lastPublishAt: Date.now(),
          },
        });
      } catch (e) {
        console.error("MatrixMedia: 更新文章 pushData 记录失败:", e && e.message);
      }
    };

    return await new Promise(resolve => {
      let settled = false;
      const finish = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code);
      };
      const timer = setTimeout(() => {
        console.error("CLI publish-article 超时，请检查网络或登录态");
        updateRecord("failed", "CLI publish-article 超时");
        finish(1);
      }, CLI_PUBLISH_TIMEOUT_MS);
      const transport = {
        reply(channel, payload) {
          if (payload && payload.taskId != null && payload.taskId !== taskId) return;
          if (channel === "puppeteerFile-done") {
            const ok = payload && payload.status === true;
            console.log(JSON.stringify({ channel, status: ok, message: payload && payload.message }));
            updateRecord(ok ? "success" : "failed", (payload && payload.message) || (ok ? "文章发布成功" : "文章发布失败"));
            finish(ok ? 0 : 3);
          } else if (channel === "puppeteer-noLogin") {
            console.error("登录态异常或未登录:", JSON.stringify(payload));
            updateRecord("failed", "登录态异常或未登录");
            finish(3);
          }
        },
      };
      runPuppeteerTask(taskPayload, transport, () => {});
    });
  }
```

- [ ] **Step 5: Run parser test**

Run:

```bash
yarn test:publish-article-args
```

Expected: `test-publish-article-args passed`.

### Task 5: Scheduled Article Payloads

**Files:**
- Modify: `src/main/services/scheduledPublish.js`

- [ ] **Step 1: Extend scheduled payload builder**

Replace `buildTaskPayloadFromRecord` internals with a branch:

```js
export function buildTaskPayloadFromRecord(record) {
  const cfg = ptConfig[record.pt] || {};
  if (record.textType === "article") {
    return {
      taskId: Date.now() + Math.random(),
      bookName: record.bookName || record.textOtherName || "",
      textType: "article",
      data: {
        title: record.bt || record.textOtherName || "",
        content: record.content || "",
        articleFilePath: record.articleFilePath || record.filePath || "",
        coverPath: record.coverPath || "",
        category: record.category || "前端",
        tags: record.bq || record.tags || "前端 electron",
        summary: record.summary || "",
      },
      textOtherName: record.textOtherName || record.bt || "",
      selectedFile: record.selectedFile || path.basename(record.articleFilePath || record.filePath || ""),
      url: record.uploadUrl || cfg.upload || record.url,
      show: false,
      mmCliSuppressWindow: true,
      closeWindowAfterPublish: true,
      useragent: record.useragent || cfg.useragent,
      partition: record.partition,
      pt: record.pt,
      phone: record.phone,
      date: record.date,
      coverPath: record.coverPath || "",
    };
  }

  return {
    taskId: Date.now() + Math.random(),
    bookName: record.bookName || record.textOtherName || "",
    textType: record.textType || "local",
    data: {
      textOtherName: record.textOtherName || "",
      bt1: record.bt || "",
      bt2: record.bt2 || record.bt || "",
      bq: record.bq || "",
      bdText: "",
      address: record.address || "",
    },
    textOtherName: record.textOtherName || "",
    selectedFile: record.selectedFile || path.basename(record.filePath || ""),
    url: record.uploadUrl || cfg.upload || record.url,
    show: false,
    mmCliSuppressWindow: true,
    closeWindowAfterPublish: true,
    useragent: record.useragent || cfg.useragent,
    partition: record.partition,
    filePath: record.filePath,
    pt: record.pt,
    phone: record.phone,
    date: record.date,
  };
}
```

- [ ] **Step 2: Relax file existence check for articles**

In `executeScheduledRecord`, change missing file guard:

```js
  if (record.textType !== "article" && (!record.filePath || !fs.existsSync(record.filePath))) {
```

Then add article file guard:

```js
  if (
    record.textType === "article" &&
    !String(record.content || "").trim() &&
    (!record.articleFilePath || !fs.existsSync(record.articleFilePath))
  ) {
    updateRecord(record, {
      publishStatus: "failed",
      publishFailCount: 1,
      lastPublishMessage: "文章正文文件不存在",
      lastPublishAt: Date.now(),
    });
    return;
  }
```

### Task 6: Main IPC File Pickers

**Files:**
- Modify: `src/main/services/ipcMain.js`

- [ ] **Step 1: Add article file picker**

Add after `dialog:openVideoFile`:

```js
    ipcMain.handle('dialog:openArticleFile', async event => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ['openFile'],
          filters: [
            { name: 'Article', extensions: ['md', 'txt'] }
          ]
        }
      )
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return undefined
      }
      return result.filePaths[0]
    })
```

- [ ] **Step 2: Add image file picker**

Add:

```js
    ipcMain.handle('dialog:openImageFile', async event => {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender),
        {
          properties: ['openFile'],
          filters: [
            { name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }
          ]
        }
      )
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return undefined
      }
      return result.filePaths[0]
    })
```

### Task 7: Renderer Article Publish Component

**Files:**
- Create: `src/renderer/components/LocalArticlePublish.vue`
- Modify: `src/renderer/views/videoManager/index.vue`

- [ ] **Step 1: Create `LocalArticlePublish.vue`**

Create component mirroring `LocalVideoPublish.vue` but scoped to articles. Use these essential methods and payload shape:

```js
buildArticlePayload() {
  const title = this.form.title.trim();
  return {
    bookName: title,
    textType: "article",
    data: {
      title,
      content: this.form.content,
      articleFilePath: this.articleFilePath,
      coverPath: this.coverPath,
      category: this.form.category.trim() || "前端",
      tags: formatTags(this.tags),
      summary: this.form.summary.trim(),
    },
    textOtherName: title,
    selectedFile: fileBaseName(this.articleFilePath),
  };
}
```

The component must include:

```js
data() {
  return {
    ptConfig,
    metaVisible: false,
    platformVisible: false,
    articleFilePath: "",
    coverPath: "",
    form: {
      title: "",
      content: "",
      category: "前端",
      summary: "",
    },
    tags: ["前端", "electron"],
    thisShow: false,
    closeWindow: true,
    scheduledPublish: false,
    publishAt: "",
    showLoginDialog: false,
    loginData: {},
    treeData: [],
  };
}
```

Validation:

```js
if (!this.form.title.trim()) {
  this.$message.warning("请填写文章标题");
  return;
}
if (!this.form.content.trim() && !this.articleFilePath) {
  this.$message.warning("请填写正文或选择文章文件");
  return;
}
```

When submitting, filter selected accounts:

```js
const platforms = checked.filter(item => item.url && item.pt === "掘金");
if (platforms.length === 0) {
  this.$message.warning("请选择掘金账号");
  return;
}
```

Immediate publish sends:

```js
ipcRenderer.send("puppeteerFile", {
  ...p,
  taskId,
  ...article,
  publishMode: "publish",
  url: this.ptConfig[p.pt].upload,
  show: shouldShow,
  closeWindowAfterPublish: shouldCloseWindowAfterPublish,
  useragent: this.ptConfig[p.pt].useragent,
  partition,
  date: currentDate,
});
```

Scheduled publish writes `pushData` with:

```js
{
  bookName: article.bookName,
  textOtherName: article.textOtherName,
  textType: "article",
  pt: p.pt,
  selectedFile: article.selectedFile,
  bt: article.data.title,
  bq: article.data.tags,
  content: article.data.content,
  articleFilePath: article.data.articleFilePath,
  coverPath: article.data.coverPath,
  category: article.data.category,
  summary: article.data.summary,
  useragent: this.ptConfig[p.pt].useragent,
  phone: p.phone,
  partition,
  url: this.ptConfig[p.pt].listIndex,
  uploadUrl: this.ptConfig[p.pt].upload,
  date: currentDate,
  scheduledTask: true,
  scheduledPublishAt: scheduledAtMs,
  scheduledPublishAtText: scheduledAtText,
  publishAttemptCount: 1,
  republishCount: 0,
  publishSuccessCount: 0,
  publishFailCount: 0,
  publishStatus: "scheduled",
  lastPublishMessage: "等待定时发布",
  lastPublishAt: Date.now(),
}
```

- [ ] **Step 2: Add video manager entry**

In `src/renderer/views/videoManager/index.vue`, import and register:

```js
import LocalArticlePublish from "@/components/LocalArticlePublish.vue";

components: {
  LocalVideoPublish,
  LocalArticlePublish,
},
```

Add component and button near existing local publish UI:

```vue
<LocalArticlePublish ref="articlePublishRef" @published="loadRecords" />
<el-button type="primary" @click="openArticlePublish">发布文章</el-button>
```

Add method:

```js
openArticlePublish() {
  this.$refs.articlePublishRef.open();
}
```

- [ ] **Step 3: Include article records in progress sync**

Change `syncPublishProgress` guard:

```js
if (!donePayload || !["local", "article"].includes(donePayload.textType)) return;
```

Change `findLocalPublishRecord` matching to allow article records:

```js
const selectedFile = donePayload.selectedFile || this.getFileName(donePayload.filePath || donePayload.articleFilePath);
```

and compare `sub.textType === donePayload.textType`.

### Task 8: MCP Publish Article Tool

**Files:**
- Create: `mcp/src/tools/publishArticle.ts`
- Modify: `mcp/src/index.ts`

- [ ] **Step 1: Create MCP tool**

Create `mcp/src/tools/publishArticle.ts`:

```ts
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';

function derivePartition(phone: string): string {
  return `persist:${phone}掘金`;
}

export const publishArticleTool: Tool = {
  name: 'publish_article',
  description: 'Publish an article to Juejin via MatrixMedia. Requires a logged-in Juejin account.',
  inputSchema: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: ['juejin'], description: 'Target platform, currently only juejin.' },
      phone: { type: 'string', description: 'Phone number used to derive session partition.' },
      title: { type: 'string', description: 'Article title.' },
      content: { type: 'string', description: 'Article content markdown/text.' },
      file: { type: 'string', description: 'Optional .md/.txt article file path.' },
      cover: { type: 'string', description: 'Optional cover image path.' },
      category: { type: 'string', description: 'Juejin category, default 前端.' },
      tags: { type: 'string', description: 'Space-separated tags, default 前端 electron.' },
      summary: { type: 'string', description: 'Optional summary.' },
      publishAt: { type: 'string', description: 'Optional scheduled publish time, format YYYY-MM-DD HH:mm:ss.' },
      show: { type: 'boolean', description: 'If true, request showing browser window; CLI currently ignores this.' },
    },
    required: ['platform', 'phone', 'title'],
  },
};

export async function handlePublishArticle(args: Record<string, unknown>): Promise<string> {
  const phone = args.phone;
  const title = args.title;
  const content = args.content;
  const file = args.file;
  if (typeof phone !== 'string' || phone.length === 0) throw new Error('phone must be non-empty string');
  if (typeof title !== 'string' || title.length === 0) throw new Error('title must be non-empty string');
  if ((!content || typeof content !== 'string') && (!file || typeof file !== 'string')) {
    throw new Error('content or file is required');
  }

  const cliArgs = [
    'publish-article',
    '-p', 'juejin',
    '-t', title,
    '--partition', derivePartition(phone),
    ...(content ? ['--content', String(content)] : []),
    ...(file ? ['--file', String(file)] : []),
    ...(args.cover ? ['--cover', String(args.cover)] : []),
    ...(args.category ? ['--category', String(args.category)] : []),
    ...(args.tags ? ['--tags', String(args.tags)] : []),
    ...(args.summary ? ['--summary', String(args.summary)] : []),
    ...(args.publishAt ? ['--publish-at', String(args.publishAt)] : []),
    ...(args.show ? ['--show'] : []),
  ];

  const result = await runCli(cliArgs);
  if (result.exitCode === 0) {
    const lastJson = result.lastJson as any;
    if (lastJson?.scheduled === true) {
      return JSON.stringify({ status: 'scheduled', id: lastJson.id, publishAt: lastJson.publishAt, message: lastJson.message });
    }
    return JSON.stringify({ status: 'success', message: lastJson?.message ?? '文章发布成功' });
  }
  if (result.exitCode === 3) throw new Error((result.lastJson as any)?.message ?? '文章发布失败');
  if (result.exitCode === 2) throw new Error('参数错误: ' + result.stderr.slice(0, 200));
  throw new Error('文章发布超时或失败: ' + result.stderr.slice(0, 300));
}
```

- [ ] **Step 2: Register MCP tool**

Modify `mcp/src/index.ts`:

```ts
import { publishArticleTool, handlePublishArticle } from './tools/publishArticle.js';
```

Add to list:

```ts
return { tools: [listAccountsTool, listHistoryTool, publishVideoTool, publishArticleTool] };
```

Add switch case:

```ts
      case 'publish_article':
        result = await handlePublishArticle(args);
        break;
```

### Task 9: CLI Docs

**Files:**
- Modify: `docs/cli.md`

- [ ] **Step 1: Add article publish section**

Add after video publish section:

```md
## 发布掘金文章

```bash
electron . cli publish-article -p juejin --phone 13800138000 -t "文章标题" --file ./post.md
electron . cli publish-article -p juejin --phone 13800138000 -t "文章标题" --content "正文内容" --tags "前端 electron"
electron . cli publish-article -p juejin --phone 13800138000 -t "文章标题" --file ./post.md --publish-at "2026-05-13 10:00:00"
```

参数摘要：

| 参数 | 说明 |
|------|------|
| `-p` / `--platform` | 当前支持 `juejin` / `掘金` |
| `--phone` / `--partition` | 会话分区，与 GUI 掘金账号一致 |
| `-t` / `--title` | 文章标题 |
| `--content` | 文章正文，与 `--file` 二选一 |
| `--file` | `.md/.txt` 正文文件，与 `--content` 二选一 |
| `--cover` | 可选封面图片 |
| `--category` | 分类，默认“前端” |
| `--tags` | 空格分隔标签，默认“前端 electron” |
| `--summary` | 可选摘要，不传则由掘金自动生成 |
| `--publish-at` | 一次性定时发布 |
```

### Task 10: Verification

**Files:**
- All changed files

- [ ] **Step 1: Run parser tests**

Run:

```bash
yarn test:publish-article-args
```

Expected: `test-publish-article-args passed`.

- [ ] **Step 2: Run existing CLI login test if available**

Run:

```bash
yarn test:cli-login
```

Expected: existing test passes or reports environment-specific login prerequisites without syntax errors.

- [ ] **Step 3: Run lint diagnostics**

Use IDE lint diagnostics for:

```text
src/main/cli/parsePublishArticleArgs.js
src/main/cli/index.js
src/main/services/upLoad/juejin.js
src/main/services/scheduledPublish.js
src/renderer/components/LocalArticlePublish.vue
src/renderer/views/videoManager/index.vue
mcp/src/tools/publishArticle.ts
mcp/src/index.ts
```

Expected: no newly introduced syntax or lint errors.

- [ ] **Step 4: Manual GUI smoke test**

Run app:

```bash
yarn dev
```

Manual checks:

- Add a `掘金` account.
- Open account page and log in via `https://juejin.cn/login`.
- Open video manager, click “发布文章”.
- Submit with direct content and no cover.
- Submit with `.md` file and cover.
- Create a scheduled article task one or two minutes in the future and verify history transitions from `scheduled` to `publishing` then success/failure.

## Self-Review

- Spec coverage: GUI entry, CLI, MCP, platform config, Juejin automation, optional cover, direct/file content, default category/tags, pushData history, and scheduled publish are each covered by tasks.
- Placeholder scan: no unfinished placeholder markers are used as implementation steps.
- Type consistency: article payload consistently uses `textType: "article"`, `data.title`, `data.content`, `data.articleFilePath`, `data.coverPath`, `data.category`, `data.tags`, and `data.summary`.
- Commit note: this plan intentionally does not include git commit steps because commits require an explicit user request in this workspace.

