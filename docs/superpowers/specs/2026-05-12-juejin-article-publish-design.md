# 掘金文章发布设计

## 背景

现有发布链路以视频发布为主：renderer 通过 `LocalVideoPublish` 收集视频元数据和账号，主进程使用 `runPuppeteerTask` 创建自动化窗口，再由 `Type.js` 根据平台名分发到 `upLoad` 平台处理器。CLI 的 `publish` 和 MCP 的 `publish_video` 也复用这条链路。

本次新增掘金文章发布能力，目标是在不复制窗口队列、账号登录、历史记录和 MCP runner 的前提下，扩展出文章任务类型。

## 范围

本功能支持：

- 在视频管理页新增“发布文章”入口。
- 掘金账号可在媒体账号管理中添加和登录，登录页为 `https://juejin.cn/login`。
- 文章标题、正文、可选封面、分类、标签可由 GUI/CLI/MCP 传入。
- 正文同时支持直接传文本和读取 `.md` / `.txt` 文件。
- 分类默认“前端”。
- 标签默认“前端 electron”。
- 封面可选：提供封面文件才上传，不提供则跳过。
- 复用现有一次性定时发布能力，到点后自动执行文章发布任务。
- 发布成功或失败写入现有 `pushData` 历史。

不包含：

- 自动生成封面。
- 自动生成摘要。
- 掘金文章发布后的审核状态抓取。

## 数据模型

新增文章任务载荷，继续通过 `puppeteerFile` / `runPuppeteerTask` 执行：

```js
{
  textType: "article",
  pt: "掘金",
  url: "https://juejin.cn/editor/drafts/new",
  data: {
    title: "文章标题",
    content: "文章正文 Markdown",
    articleFilePath: "/path/to/post.md",
    coverPath: "/path/to/cover.png",
    category: "前端",
    tags: "前端 electron",
    summary: ""
  }
}
```

正文解析规则：

- `data.content` 有值时直接使用。
- `data.content` 为空且 `data.articleFilePath` 有值时读取文件内容。
- 两者都为空时阻止发布并提示“请填写正文或选择文章文件”。

历史记录沿用 `pushData`，`textType` 写为 `article`，`selectedFile` 写文章文件名或空字符串，标题写入 `bt`，封面路径写入 `coverPath`。

定时发布沿用现有字段：`scheduledTask`、`scheduledPublishAt`、`scheduledPublishAtText`、`publishStatus`。调度执行时根据 `textType: "article"` 构造文章任务载荷，保留正文、正文文件、封面、分类、标签、摘要等字段。

## GUI 设计

在 `src/renderer/views/videoManager/index.vue` 顶部按钮区新增“发布文章”按钮，和“选择视频文件”并列。

新增文章发布弹窗组件，放在 `src/renderer/components/LocalArticlePublish.vue`：

- 第一步填写文章内容：
  - 名称
  - 标题
  - 正文 textarea
  - 选择 `.md/.txt` 文件
  - 选择封面图片
  - 分类，默认“前端”
  - 标签，多选/可输入，默认“前端”“electron”
  - 定时发布开关和发布时间，复用视频发布的未来时间校验
- 第二步复用账号树选择账号：
  - 只允许选择 `掘金` 平台账号。
  - 支持“是否显示自动化发布过程”和“发布完是否关闭窗口”。
  - 支持重新登录弹窗。

主进程新增 `dialog:openArticleFile` 和 `dialog:openImageFile`，用于选择正文文件和封面文件。

## 平台配置

在 renderer 与 main 的平台配置中新增：

```js
掘金: {
  index: "https://juejin.cn/login",
  upload: "https://juejin.cn/editor/drafts/new",
  useragent: "Mozilla/5.0 ... Chrome/138.0.0.0 Safari/537.36",
  listIndex: "https://juejin.cn/editor/drafts"
}
```

账号 partition 仍使用现有规则：`persist:<手机号>掘金`。

## 自动化流程

新增 `src/main/services/upLoad/juejin.js`，并在 `upLoad/index.js`、`Type.js` 中注册 `掘金`。

流程：

1. 等待编辑页加载。
2. 填写标题：`.header .title-input`。
3. 填写正文：定位 `.bytemd-editor .CodeMirror-code .CodeMirror-line`，双击后通过剪贴板粘贴正文。
4. 可选上传封面：如果传入 `coverPath`，在 `.coverselector_container input[type="file"]` 上传。
5. 点击发布按钮：`.right-box button.xitu-btn`。
6. 发布弹窗中选择分类：
   - 在 `.category-list .item` 中按文本选择，默认“前端”。
7. 添加标签：
   - 定位 `.tag-input .byte-select__input`。
   - 依次输入标签文本，等待下拉项后选择匹配项。
   - 默认标签为“前端”“electron”。
8. 摘要默认由掘金自动生成；如果传入 `summary`，可尝试写入 `.summary-textarea textarea`。
9. 点击最后确认发布：`.footer .btn-container .ui-btn.primary`。
10. 回传 `puppeteerFile-done`，成功消息为“文章发布成功”，失败消息包含当前阶段。

正文粘贴时需要保存并恢复系统剪贴板文本，避免影响用户剪贴板。

## CLI 设计

新增子命令 `cli publish-article`，避免把文章参数塞进现有视频 `publish` 参数中。

参数：

- `-p, --platform <id>`：首期仅 `juejin|掘金`。
- `--phone <id>` 或 `--partition <partition>`。
- `-t, --title <text>`。
- `--content <text>`。
- `--file <path>`：`.md/.txt` 正文文件。
- `--cover <path>`：可选封面图片。
- `--category <text>`：默认“前端”。
- `--tags <text>`：空格分隔，默认“前端 electron”。
- `--summary <text>`：可选摘要。
- `--publish-at <t>`：一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`。
- `--show`。
- `--no-close-window`。

退出码沿用现有 CLI 约定：`0` 成功，`1` 异常，`2` 参数错误，`3` 发布失败。

## MCP 设计

MCP 新增工具 `publish_article`：

- `platform`：当前只允许 `juejin`。
- `phone`。
- `title`。
- `content`。
- `file`。
- `cover`。
- `category`。
- `tags`。
- `summary`。
- `publishAt`。
- `show`。

处理器调用 `runCli(["publish-article", ...])`，与现有 `publish_video` 保持一致。

## 错误处理

GUI 参数校验：

- 未选择掘金账号时提示“请选择掘金账号”。
- 标题为空时提示“请填写文章标题”。
- 正文和正文文件都为空时提示“请填写正文或选择文章文件”。
- 开启定时发布时，发布时间为空、格式错误或早于当前时间时复用现有定时发布提示。

主进程自动化失败时返回当前阶段，例如：

- `文章发布失败：填写标题 - 未找到标题输入框`
- `文章发布失败：选择标签 - 未找到标签输入框`
- `文章发布失败：确认发布 - 未找到确认按钮`

## 测试计划

- 单测/脚本验证 CLI 参数解析：
  - 缺标题报错。
  - `content` 和 `file` 同时为空报错。
  - `phone` 自动派生 `partition`。
  - `publish-at` 创建定时文章发布历史，不立即打开发布窗口。
- 手动 GUI 验证：
  - 添加掘金账号并登录。
  - 直接输入正文发布。
  - 选择 `.md` 文件发布。
  - 不传封面发布。
  - 传封面发布。
  - 创建定时文章发布任务，到点后自动执行。
- MCP 验证：
  - `publish_article` 能调用 CLI 并返回成功/失败 JSON。
  - `publish_article` 携带 `publishAt` 时返回 scheduled JSON。

