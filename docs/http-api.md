# 内置 HTTP API

应用图形界面启动后，会自动在本机 **30088** 端口（`BuiltInServerPort`，见 `env/.env`）监听内置 Express 服务。其它程序可通过 HTTP 调用，与 GUI / CLI 共用同一套登录态与 `pushData` 发布记录。

> **与 CLI 的区别**：HTTP API 依赖 GUI 主进程已运行（托盘/窗口在即可）；CLI 可独立启动。单平台请求会等待上传完成或超时；多平台请求与 GUI 批量发布一致，提交到发布队列后立即返回，实际结果写入 `pushData` 发布记录。

**基础地址**：`http://127.0.0.1:30088`

## 路由一览

| 方法 | 路径                   | 说明                                              |
| ---- | ---------------------- | ------------------------------------------------- |
| GET  | `/`                    | 返回 `MatrixMedia API` 欢迎页                     |
| GET  | `/platforms`           | 返回 HTTP 支持的全部视频平台列表（JSON）          |
| GET  | `/creative-statements` | 返回各平台支持的创作声明选项（对齐 GUI 批量设置） |
| POST | `/changeData`          | 读写本地 JSON 数据（账号树、发布历史等）          |
| POST | `/publish`             | 发布视频到单平台或多平台                          |

静态资源：`/public/*` 映射到 `server/public`。

## GET /platforms

查询 `POST /publish` 支持的全部视频平台（与 CLI `cli publish` 一致）。

**响应示例**：

```json
{
  "success": true,
  "platforms": [
    {
      "code": "dy",
      "name": "抖音",
      "aliases": ["douyin", "抖音"],
      "automated": true,
      "note": null,
      "hasConfig": true
    },
    {
      "code": "xhs",
      "name": "小红书",
      "aliases": ["xiaohongshu", "小红书"],
      "automated": true,
      "note": null,
      "hasConfig": true
    },
    {
      "code": "fqsp",
      "name": "番茄视频",
      "aliases": ["fanqie", "fq", "番茄视频"],
      "automated": false,
      "note": "配置已接入，自动发布流程待完善",
      "hasConfig": true
    }
  ]
}
```

## 支持的视频平台

`platform` / `platforms` 可使用 **code** 或 **中文名**，以下平台均可通过 HTTP 发布：

| code   | 平台     | 别名                   | 自动化 |
| ------ | -------- | ---------------------- | ------ |
| `dy`   | 抖音     | douyin / 抖音          | 是     |
| `sph`  | 视频号   | 视频号                 | 是     |
| `blbl` | 哔哩哔哩 | bilibili / 哔哩哔哩    | 是     |
| `bjh`  | 百家号   | 百家号                 | 是     |
| `tt`   | 头条     | toutiao / 头条         | 是     |
| `ks`   | 快手     | kuaishou / 快手        | 是     |
| `xhs`  | 小红书   | xiaohongshu / 小红书   | 是     |
| `fqsp` | 番茄视频 | fanqie / fq / 番茄视频 | 待完善 |

> 掘金文章请使用 CLI `publish-article`，当前无 HTTP 接口。

## GET /creative-statements

查询各平台支持的创作声明选项，与 GUI「本地视频发布」批量设置创作声明一致。

**响应字段**：

| 字段           | 说明                                               |
| -------------- | -------------------------------------------------- |
| `default`      | 默认值，一般为 `none`                              |
| `batchOptions` | 全局批量下拉全部选项（value + label）              |
| `platforms`    | 按平台 code 列出 `supports` 与该平台可用 `options` |
| `input`        | HTTP `POST /publish` 入参说明                      |

**声明 value 一览**（也可用中文 label 或各平台页面原文案）：

| value                 | 说明       | 备注              |
| --------------------- | ---------- | ----------------- |
| `none`                | 无标注     | 默认              |
| `ai_generated`        | AI 生成    |                   |
| `fiction`             | 虚构演绎   |                   |
| `marketing`           | 营销推广   | 快手/头条不支持   |
| `personal_opinion`    | 个人观点   | 小红书/头条不支持 |
| `repost`              | 转载       |                   |
| `self_made_no_repost` | 自制禁转载 | 仅哔哩哔哩        |

## POST /changeData

读写本地 JSON 数据，GUI 内部也使用此接口。

**请求体（JSON）**：

| 字段       | 说明                                                     |
| ---------- | -------------------------------------------------------- |
| `fileName` | 数据文件名，如 `account`、`pushData`                     |
| `type`     | 操作类型：`add` / `update` / `delete` / `get` / `config` |
| `item`     | 具体数据项，结构随 `fileName` 与 `type` 变化             |

## POST /publish

发布视频到单平台或多平台（本地路径或 `http(s)` 远程 URL）。参数解析与 `cli publish` 共用 `parseMultiPublishRequest`。

**请求体（JSON）**：

| 字段                 | 必填   | 说明                                                                                                                                     |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`           | 单平台 | 上表任一平台 code 或中文名，如 `xhs` / `小红书`（与 `platforms` 二选一）                                                                 |
| `platforms`          | 多平台 | 平台数组，可一次包含全部 8 个平台；如 `["dy","xhs","ks"]` 或对象数组 `[{ "platform": "dy", "phone": "138..." }, ...]`                    |
| `file`               | 是     | 本地视频绝对路径，或 `http://` / `https://` 远程视频 URL（会先下载到临时目录，全部平台发布结束后自动删除；定时发布则在到点执行时再下载） |
| `title`              | 是     | 视频标题                                                                                                                                 |
| `phone`              | 二选一 | 账号手机号（与 GUI 账号树一致）；多平台时可作为默认值，单个平台对象内可覆盖                                                              |
| `partition`          | 二选一 | 完整 session，如 `persist:13800138000抖音`                                                                                               |
| `bt2`                | 否     | 视频号短标（含视频号时强烈建议填写）                                                                                                     |
| `tags`               | 否     | 标签，支持空格 / 逗号分隔；HTTP 会按 GUI 批量发布习惯拆分后再按平台补 `#` 或去 `#`                                                       |
| `publishAt`          | 否     | 一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`（多平台时需全部一致）                                                                         |
| `creativeStatement`  | 否     | 全局创作声明，等同 GUI「批量设置创作声明」；支持 value、中文 label 或平台页面原文案（如 `内容由AI生成`）                                 |
| `creativeStatements` | 否     | 按平台覆盖声明，key 用 code 或中文名，如 `{ "dy": "ai_generated", "blbl": "fiction" }`；某平台不支持所选值时回退 `none`                  |

**创作声明优先级**（与 GUI 一致）：`platforms[].creativeStatement` > `creativeStatements[平台]` > `creativeStatement`。

不支持创作声明的平台（如视频号）会忽略并回退为 `none`。可用 `GET /creative-statements` 查询各平台可用选项。

**响应体（JSON）**：

| 字段                             | 说明                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `success`                        | 请求是否被接受；多平台表示已成功提交到发布队列       |
| `status`                         | 单平台为最终状态；多平台提交成功为 `submitted`       |
| `exitCode`                       | 单平台同 CLI；多平台提交成功为 `0`                   |
| `message`                        | 结果说明                                             |
| `total` / `succeeded` / `failed` | 多平台提交汇总；最终成功失败以 `pushData` 记录为准   |
| `results`                        | 多平台时各平台提交明细数组（含 `creativeStatement`） |
| `id`                             | 单平台时写入 `pushData` 的记录 id                    |
| `scheduled` / `publishAt`        | 定时发布时返回                                       |

**HTTP 状态码**：

- 参数错误：HTTP `400`
- 单平台发布失败（如未登录）：HTTP `200`，但 `success: false`、`exitCode: 3`
- 多平台：HTTP 只表示任务是否提交成功，最终结果请查询发布记录
- 服务已配置 CORS，浏览器或本机脚本均可调用

## 示例

单平台发布：

```bash
curl -X POST http://127.0.0.1:30088/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "dy",
    "phone": "13800138000",
    "file": "/Users/me/video.mp4",
    "title": "我的视频标题",
    "tags": "减脂 健身"
  }'
```

远程视频 URL：

```bash
curl -X POST http://127.0.0.1:30088/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "dy",
    "phone": "13800138000",
    "file": "https://example.com/video.mp4",
    "title": "我的视频标题"
  }'
```

多平台一次发布（含按平台创作声明，对齐 GUI 批量设置）：

```bash
curl -X POST http://127.0.0.1:30088/publish \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "13800138000",
    "file": "/Users/me/video.mp4",
    "title": "我的视频标题",
    "creativeStatement": "ai_generated",
    "creativeStatements": {
      "blbl": "fiction",
      "xhs": "marketing"
    },
    "platforms": ["dy", "blbl", "xhs", "ks"]
  }'
```

多平台一次发布（`platforms` 字符串数组）：

```bash
curl -X POST http://127.0.0.1:30088/publish \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "13800138000",
    "file": "https://example.com/video.mp4",
    "title": "我的视频标题",
    "bt2": "5公里新手挑战",
    "tags": "跑步 新手",
    "platforms": ["dy", "sph", "blbl", "bjh", "tt", "ks", "xhs"]
  }'
```

多平台一次发布（`platforms` 对象数组，各平台可覆盖 `phone`）：

```bash
curl -X POST http://127.0.0.1:30088/publish \
  -H "Content-Type: application/json" \
  -d '{
    "file": "/Users/me/video.mp4",
    "title": "我的视频标题",
    "tags": "日常 vlog",
    "platforms": [
      { "platform": "dy", "phone": "13800138000" },
      { "platform": "sph", "phone": "13800138000" },
      { "platform": "ks", "phone": "13900139000" }
    ]
  }'
```

多平台响应示例：

```json
{
  "success": true,
  "exitCode": 0,
  "status": "submitted",
  "message": "已提交 3 个平台发布",
  "total": 3,
  "succeeded": 0,
  "failed": 0,
  "results": [
    {
      "platform": "抖音",
      "success": true,
      "exitCode": 0,
      "status": "submitted",
      "message": "已提交发布任务"
    },
    {
      "platform": "视频号",
      "success": true,
      "exitCode": 0,
      "status": "submitted",
      "message": "已提交发布任务"
    },
    {
      "platform": "快手",
      "success": true,
      "exitCode": 0,
      "status": "submitted",
      "message": "已提交发布任务"
    }
  ]
}
```
