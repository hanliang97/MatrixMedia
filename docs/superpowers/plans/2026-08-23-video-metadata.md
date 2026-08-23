# 视频发布元数据语义统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `title`、`description`、`shortTitle`、`tags` 统一视频发布字段，并兼容现有任务和历史记录。

**Architecture:** 在 `src/shared/videoMetadata.js` 建立唯一规范化边界，所有入口写入语义字段，同时双写旧字段；各平台上传器改为读取规范化结果。旧 `bt2` 根据目标平台兼容为视频号短标题或其他平台简介。

**Tech Stack:** JavaScript、Vue 2、Electron、Puppeteer、Node `assert`、esbuild。

## Global Constraints

- 不新增依赖。
- `title` 必填，`description` 可空。
- `shortTitle` 仅视频号消费并沿用 6～16 字校验。
- 正文统一为过滤空值后的 `description + tags`。
- 哔哩哔哩标签继续写独立控件，不拼入简介。
- 新旧字段至少兼容一个版本。
- 不自动创建 git commit，除非用户明确要求。

---

### Task 1: 建立统一元数据规范化边界

**Files:**
- Create: `src/shared/videoMetadata.js`
- Create: `scripts/test-video-metadata.js`

**Interfaces:**
- Produces: `normalizeVideoMetadata(raw, platform)`，返回 `{ title, description, shortTitle, tags, legacy }`
- Produces: `joinDescriptionAndTags(description, tags)`，返回用于合并正文控件的字符串

- [ ] **Step 1: 编写失败测试**

覆盖新字段、旧字段、视频号与非视频号 `bt2` 分流、标签数组/字符串和空值拼接：

```js
assert.deepStrictEqual(
  normalizeVideoMetadata(
    { title: "标题", description: "简介", shortTitle: "六个字短标题", tags: ["旅行", "日常"] },
    "视频号"
  ),
  {
    title: "标题",
    description: "简介",
    shortTitle: "六个字短标题",
    tags: ["旅行", "日常"],
    legacy: {
      bt1: "标题",
      bt2: "简介",
      bt2Filled: "六个字短标题",
      bdText: "简介",
      bq: "旅行 日常",
    },
  }
);
assert.strictEqual(
  normalizeVideoMetadata({ bt1: "标题", bt2: "旧短标" }, "视频号").shortTitle,
  "旧短标"
);
assert.strictEqual(
  normalizeVideoMetadata({ bt1: "标题", bt2: "旧简介" }, "抖音").description,
  "旧简介"
);
assert.strictEqual(joinDescriptionAndTags("", ["#旅行"]), "#旅行");
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node scripts/test-video-metadata.js`

Expected: FAIL，模块或导出不存在。

- [ ] **Step 3: 实现最小规范化函数**

```js
export function normalizeVideoMetadata(raw = {}, platform = "") {
  const data = raw.data || raw;
  const title = String(data.title ?? data.bt1 ?? "").trim();
  const legacyBt2 = String(data.bt2 ?? "").trim();
  const firstText = (...values) =>
    values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
  const description = firstText(
    data.description,
    data.bdText,
    platform === "视频号" ? "" : legacyBt2
  );
  const shortTitle = firstText(
    data.shortTitle,
    data.bt2Filled,
    platform === "视频号" ? legacyBt2 : ""
  );
  const tags = normalizeVideoTags(data.tags ?? data.bq);
  return {
    title,
    description,
    shortTitle,
    tags,
    legacy: {
      bt1: title,
      bt2: description,
      bt2Filled: shortTitle,
      bdText: description,
      bq: tags.join(" "),
    },
  };
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node scripts/test-video-metadata.js`

Expected: `test-video-metadata passed`

---

### Task 2: 统一 CLI、HTTP API 与 MCP 参数

**Files:**
- Modify: `src/main/cli/parsePublishArgs.js`
- Modify: `src/main/cli/index.js`
- Modify: `src/main/services/publishVideo.js`
- Modify: `mcp/src/tools/publish.ts`
- Modify: `scripts/test-publish-draft-args.js`
- Modify: `scripts/test-publish-article-args.js` 或新增对应视频参数断言

**Interfaces:**
- Consumes: `normalizeVideoMetadata(raw, platform)`
- Produces: CLI `--description`、`--short-title`
- Produces: HTTP `description`、`shortTitle`

- [ ] **Step 1: 为新参数和旧 `bt2` 平台分流编写失败测试**

```js
const dy = parsePublishArgs([
  "-p", "dy", "-f", "a.mp4", "--phone", "1",
  "-t", "标题", "--description", "简介", "--short-title", "忽略"
]);
assert.strictEqual(dy.value.description, "简介");
assert.strictEqual(dy.value.shortTitle, "忽略");

const legacySph = parsePublishArgs([
  "-p", "sph", "-f", "a.mp4", "--phone", "1", "-t", "标题", "--bt2", "六个字短标题"
]);
assert.strictEqual(legacySph.value.shortTitle, "六个字短标题");
```

- [ ] **Step 2: 运行相关测试并确认失败**

Run: `node scripts/test-publish-draft-args.js`

Expected: FAIL，新参数尚未解析。

- [ ] **Step 3: 扩展 CLI/HTTP 参数解析**

在 `parsePublishArgs` 增加：

```js
description: "",
shortTitle: "",
```

参数映射：

```js
} else if (a === "--description" || a === "--desc") {
  out.description = args[++i] || "";
} else if (a === "--short-title") {
  out.shortTitle = args[++i] || "";
}
```

完成平台解析后兼容旧 `bt2`：

```js
if (out.bt2 && !out.description && !out.shortTitle) {
  if (out.platform === "视频号") out.shortTitle = out.bt2;
  else out.description = out.bt2;
}
```

HTTP body 和 MCP 参数同步映射 `description`、`shortTitle`。

- [ ] **Step 4: 任务与历史记录双写新旧字段**

`publishVideo.js` 使用规范化结果构建任务：

```js
const metadata = normalizeVideoMetadata(v, v.platform);
data: {
  title: metadata.title,
  description: metadata.description,
  shortTitle: metadata.shortTitle,
  tags: metadata.tags,
  ...metadata.legacy,
}
```

历史记录保存 `description`、`shortTitle`、`tags`，并保留 `bt`、`bt2`、`bt2Filled`、`bq`。

- [ ] **Step 5: 运行 CLI/API 测试**

Run: `node scripts/test-publish-draft-args.js && node scripts/test-video-metadata.js`

Expected: 全部通过。

---

### Task 3: 调整 GUI、目录批量、定时和重新发布

**Files:**
- Modify: `src/renderer/components/LocalVideoPublish.vue`
- Modify: `src/renderer/views/videoManager/index.vue`
- Modify: `src/main/services/ipcMain.js`
- Modify: `src/main/services/scheduledPublish.js`
- Modify: `scripts/test-scheduled-publish.js`

**Interfaces:**
- GUI form: `{ title, bt1, description, shortTitle }`
- 目录行: `{ fileName, title, description, tags, shortTitle }`

- [ ] **Step 1: 为定时任务恢复语义字段编写失败测试**

```js
const task = buildTaskPayloadFromRecord({
  pt: "视频号",
  bt: "标题",
  description: "简介",
  shortTitle: "六个字短标题",
  tags: ["旅行"],
});
assert.strictEqual(task.data.description, "简介");
assert.strictEqual(task.data.shortTitle, "六个字短标题");
assert.deepStrictEqual(task.data.tags, ["旅行"]);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node scripts/test-scheduled-publish.js`

Expected: FAIL，语义字段未恢复。

- [ ] **Step 3: 修改 GUI 字段**

将“概括短标题”拆为两个输入：

```vue
<el-form-item label="视频简介">
  <el-input
    v-model="form.description"
    type="textarea"
    :rows="4"
    maxlength="2000"
    show-word-limit
    placeholder="选填，将作为各平台正文或简介"
  />
</el-form-item>
<el-form-item label="视频号短标题">
  <el-input
    ref="shortTitleInput"
    v-model="form.shortTitle"
    placeholder="仅视频号使用，选填，建议 6～16 字"
  />
</el-form-item>
```

payload 写入 `title`、`description`、`shortTitle`、`tags`，并通过 helper 双写旧字段。

- [ ] **Step 4: 扩展目录批量列**

GUI IPC 与 CLI xlsx 解析同时识别：

```js
description: row["简介"] || row.description || "",
shortTitle: row["视频号短标题"] || row.shortTitle || "",
```

- [ ] **Step 5: 修复定时与重发往返**

`buildTaskPayloadFromRecord`、`openRepublish` 和历史记录写入完整恢复：

```js
description: record.description || record.bdText || "",
shortTitle: record.shortTitle || record.bt2Filled || "",
tags: record.tags || record.bq || "",
```

不得把 `record.bt2 || record.bt` 直接恢复成 `shortTitle`。

- [ ] **Step 6: 运行定时与 GUI 相关测试**

Run: `node scripts/test-scheduled-publish.js && node scripts/test-local-video-publish-bt2.js`

Expected: 全部通过。

---

### Task 4: 统一各平台最终消费规则

**Files:**
- Modify: `src/main/services/puppeteerFile.js`
- Modify: `src/main/services/upLoad/dy.js`
- Modify: `src/main/services/upLoad/sph.js`
- Modify: `src/main/services/upLoad/ks.js`
- Modify: `src/main/services/upLoad/xhs.js`
- Modify: `src/main/services/upLoad/blbl.js`
- Verify only: `src/main/services/upLoad/tt.js`
- Verify only: `src/main/services/upLoad/bjh.js`
- Verify only: `src/main/services/upLoad/fqsp.js`
- Create: `scripts/test-video-platform-metadata.js`

**Interfaces:**
- Consumes: normalized `data.title`, `data.description`, `data.shortTitle`, `data.tags`

- [ ] **Step 1: 编写平台映射失败测试**

测试纯映射函数输出：

```js
assert.deepStrictEqual(buildPlatformVideoText("抖音", metadata), {
  title: "标题",
  description: "简介 #旅行",
  shortTitle: "",
});
assert.deepStrictEqual(buildPlatformVideoText("哔哩哔哩", metadata), {
  title: "标题",
  description: "简介",
  shortTitle: "",
});
assert.strictEqual(
  buildPlatformVideoText("视频号", metadata).shortTitle,
  "六个字短标题"
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node scripts/test-video-platform-metadata.js`

Expected: FAIL，平台映射函数不存在。

- [ ] **Step 3: 在共享 helper 中实现平台文本映射**

```js
export function buildPlatformVideoText(platform, metadata) {
  const tagsText = formatTagsForPlatform(platform, metadata.tags);
  const combined = joinDescriptionAndTags(metadata.description, tagsText);
  return {
    title: metadata.title,
    description: platform === "哔哩哔哩" ? metadata.description : combined,
    shortTitle: platform === "视频号" ? metadata.shortTitle : "",
  };
}
```

- [ ] **Step 4: 在统一执行入口注入规范化字段**

`puppeteerFile.js` 调用平台 action 前：

```js
const metadata = normalizeVideoMetadata(data.data, data.pt);
data.data = {
  ...data.data,
  title: metadata.title,
  description: metadata.description,
  shortTitle: metadata.shortTitle,
  tags: metadata.tags,
  ...metadata.legacy,
};
```

- [ ] **Step 5: 修改平台上传器**

- 抖音：标题读取 `title`，正文读取映射后的 `description`。
- 小红书：标题读取 `title`，正文先输入 `description`，再按现有逻辑逐个输入标签。
- 哔哩哔哩：标题读取 `title`，简介读取 `description`，标签仍走独立控件。
- 快手：作品描述读取 `description + tags`。
- 视频号：描述读取 `description + tags`，短标题读取 `shortTitle`。
- 头条、百家号保持只读标题；番茄保持不写元数据。

- [ ] **Step 6: 运行平台映射测试**

Run: `node scripts/test-video-platform-metadata.js && node scripts/test-video-metadata.js`

Expected: 全部通过。

---

### Task 5: 文档、全量回归与清理

**Files:**
- Modify: `docs/cli.md`
- Modify: `docs/http-api.md`
- Modify: `.cursor/skills/matrixmedia-cli-publish/SKILL.md`
- Modify: `package.json`（仅增加测试脚本时）

- [ ] **Step 1: 更新公开参数和平台映射说明**

文档统一使用：

```text
--title <text>
--description <text>
--short-title <text>  仅视频号
--tags <text>
```

注明旧 `--bt2` 的平台相关兼容规则。

- [ ] **Step 2: 运行全部相关测试**

Run:

```bash
node scripts/test-video-metadata.js &&
node scripts/test-video-platform-metadata.js &&
node scripts/test-publish-draft-args.js &&
node scripts/test-scheduled-publish.js &&
node scripts/test-local-video-publish-bt2.js &&
node scripts/test-blbl-cover.js
```

Expected: 所有脚本退出码为 0。

- [ ] **Step 3: 检查改动文件**

Run: `git diff --check`

Expected: 无输出，退出码为 0。

- [ ] **Step 4: 手工发布验证**

至少验证抖音、视频号、小红书、哔哩哔哩：

- 标题仅进入标题控件。
- 简介与标签按平台规则进入正文或独立控件。
- 只有视频号填写短标题。
- 空简介时只写标签，不产生 `undefined` 或多余空格。
- 历史重发和定时任务保持相同元数据。
