<p align="center">
  <img src="./lib/icons/icon.png" alt="MatrixMedia · 矩媒" width="128" />
</p>

<h1 align="center">矩媒 MatrixMedia</h1>

> **自媒体 · 矩阵 · 批量** — 多平台视频矩阵发布与批量分发工具（Electron + CLI）

<p align="center">
  <img src="./src/renderer/layout/components/Sidebar/ptcion/dy.png" alt="抖音" width="36" />&nbsp;&nbsp;
  <img src="./src/renderer/layout/components/Sidebar/ptcion/ks.png" alt="快手" width="36" />&nbsp;&nbsp;
  <img src="./src/renderer/layout/components/Sidebar/ptcion/bjh.png" alt="百家号" width="36" />&nbsp;&nbsp;
  <img src="./src/renderer/layout/components/Sidebar/ptcion/blbl.jpeg" alt="哔哩哔哩" width="36" />&nbsp;&nbsp;
  <img src="./src/renderer/layout/components/Sidebar/ptcion/tt.png" alt="头条号" width="36" />&nbsp;&nbsp;
  <img src="./src/renderer/layout/components/Sidebar/ptcion/sph.png" alt="视频号" width="36" />&nbsp;&nbsp;
  <img src="./src/renderer/layout/components/Sidebar/ptcion/xhs.png" alt="小红书" width="36" />
</p>

## 关键词（便于搜索）

自媒体、自媒体矩阵、矩阵发布、矩阵运营、内容矩阵、视频矩阵、多平台矩阵、跨平台发布、批量发布、批量上传、批量分发、一键发布、多账号发布、多平台发布、本地视频发布、短视频矩阵、内容分发、账号矩阵、自动化发布、CLI 批量、命令行发布、无头发布、智能体编排、OpenClaw、MCP 发布、抖音矩阵、快手矩阵、小红书矩阵、百家号矩阵、哔哩哔哩矩阵、头条矩阵、视频号矩阵、番茄视频、番茄视频矩阵、MatrixMedia、矩媒、pubtw

## <strong>📺 [教程视频](https://www.bilibili.com/video/BV1Xm7H6hEve/)</strong>

自媒体矩阵发布工具（Electron）。支持图形界面与**命令行（CLI）**自动化，适合**批量**向多平台账号矩阵分发视频：

- **支持平台**：Windows、macOS、CLI。
- **CLI 登录**：目前支持**抖音**与**视频号**（终端二维码；抖音另支持 puppeteer 无头）。
- **CLI 发布**：**7 个平台**已完整自动化——抖音、快手、百家号、哔哩哔哩、头条、视频号、小红书；**番茄视频**已接入配置与 GUI 登录，自动发布流程开发中。`file` 支持本地路径或 `http(s)` 远程 URL（自动下载，上传后清理临时文件）。
- **CLI 查询**：`cli accounts` 实时检测登录态，`cli history` 查看本机发布记录。
- **HTTP API**：GUI 启动后可通过 `POST http://127.0.0.1:30088/publish` 由其它程序触发发布（见 [docs/http-api.md](./docs/http-api.md) 或应用内「项目详情」页）。

便于脚本与智能体编排。GUI 打开后默认进入「**项目详情**」页，可查看 HTTP / MCP / CLI 接入说明。

<!-- openclaw-integrable: id=matrixmedia-cli version=1 platform=electron argv-marker=cli -->
<!-- 说明：本仓库以 argv 含 `cli` 作为统一入口，可被 OpenClaw / Hermes / Claude Code / Cursor / Dify / n8n 等 AI 工具与智能体编排框架发现与调用；子命令 `login`（抖音 / 视频号）、`publish`、`publish-article` 等详见 [docs/cli.md](./docs/cli.md)。 -->

## AI 工具 / 智能体联动

本项目的 CLI 被刻意设计为 **AI 工具无关 / 框架无关** 的外部命令：只要你的工具能调用 shell、读取退出码或 JSON stdout，就能直接对接 —— 包括但不限于：

- [OpenClaw](https://github.com/openclaw/openclaw)
- [Hermes](https://github.com/NousResearch/hermes-agent)
- Claude Code、Cursor、Cline、Aider 等编程智能体
- Dify、n8n、LangChain、CrewAI、AutoGen 等工作流 / 多智能体编排框架
- 任何支持「外部命令 + argv + 退出码」约定的自动化平台（含自研调度器）

统一约定：

| 约定项        | 内容                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| 进入 CLI 模式 | argv 含子串 `cli` 即进入无 GUI 流程（如 `matrixmedia cli publish ...`）                                |
| 子命令        | `cli login \| publish \| publish-article \| accounts \| history`，每个均支持 `--help`                  |
| 退出码        | `0` 成功 / `1` 异常 / `2` 参数错误 / `3` 业务失败（登录、上传等）                                      |
| 机器可读输出  | `cli accounts --json` 与 `cli history --json` 产出稳定 JSON，便于上游消费                              |
| 登录态共享    | CLI 与 GUI 共用 `persist:<phone><平台>` session partition，互不侵扰                                    |
| HTTP API      | GUI 启动后 `POST http://127.0.0.1:30088/publish` 发布视频（见 [docs/http-api.md](./docs/http-api.md)） |

详细文档：[CLI](./docs/cli.md) · [HTTP API](./docs/http-api.md) · [MCP](./docs/mcp.md)

仓库顶部的 `<!-- openclaw-integrable ... -->` HTML 注释以 OpenClaw 的 schema 示例上述约定；其它平台如需类似的仓库级可发现标记，可沿用同一 `argv-marker=cli` 语义，或加上自家的注释标签（例如 `<!-- hermes-integrable ... -->`），互不冲突。

典型用法：在 AI 平台/智能体侧将本应用配置为 **外部命令**（`command` + `args`）：`cli login` 可用于 **抖音 / 视频号** 扫码登录；其它平台请先在 GUI 登录一次，CLI 会复用同一 session partition；`cli publish` 对已自动化 7 平台一致可用（番茄视频待完善）。终端二维码与无头模式等行为见 [docs/cli.md](./docs/cli.md) 与各子命令 `--help`。

### MCP Server（Claude Desktop / Cursor / Cline 原生接入）

仓库内置 `mcp/` 子包，实现了 [Model Context Protocol](https://modelcontextprotocol.io) Server，让支持 MCP 的 AI 工具**无需 shell 调用**即可直接操作 MatrixMedia。

**第一步：构建 MCP Server**

```bash
cd mcp && npm install && npm run build
```

**第二步：配置 AI 工具**

以下配置适用于 Claude Desktop、Cursor、Cline 等支持 MCP stdio transport 的工具。
将 `MATRIXMEDIA_DIR` 设为本仓库根目录的绝对路径。

_Claude Desktop_（`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "matrixmedia": {
      "command": "node",
      "args": ["<MATRIXMEDIA_DIR>/mcp/dist/index.js"],
      "env": {
        "MATRIXMEDIA_DIR": "<MATRIXMEDIA_DIR>"
      }
    }
  }
}
```

_Cursor / Cline_（`.cursor/mcp.json` 或全局 MCP 配置，格式相同）：

```json
{
  "mcpServers": {
    "matrixmedia": {
      "command": "node",
      "args": ["<MATRIXMEDIA_DIR>/mcp/dist/index.js"],
      "env": {
        "MATRIXMEDIA_DIR": "<MATRIXMEDIA_DIR>"
      }
    }
  }
}
```

重启 AI 工具后，以下 4 个 tool 即可在对话中直接调用（完整说明见 [docs/mcp.md](./docs/mcp.md)）：

| Tool              | 说明                                             |
| ----------------- | ------------------------------------------------ |
| `list_accounts`   | 列出本机已登录账号，支持按平台过滤               |
| `list_history`    | 查询本机发布记录，支持按平台 / 状态 / 天数过滤   |
| `publish_video`   | 发布视频到指定平台（最长 35 分钟，支持定时发布） |
| `publish_article` | 发布掘金文章（需已登录掘金账号）                 |

> **登录说明**：所有平台均需在 GUI 中完成登录后再通过 MCP 发布。MCP 运行在无头 stdio 环境，无法弹出扫码窗口。

## 目前可以一键发布视频的平台有

1. 抖音
2. 快手
3. 百家号
4. 哔哩哔哩
5. 头条号
6. 视频号
7. 小红书

### 番茄视频（配置已接入，自动化待完善）

[番茄视频创作平台](https://pugc.yueduwuxian.com/fqvideo/login) 已写入 URL 配置，GUI 可添加账号并通过独立 BrowserWindow 登录；自动上传、填表、点发布及审核状态查询尚未实现。

| 用途   | URL                                                     |
| ------ | ------------------------------------------------------- |
| 登录页 | https://pugc.yueduwuxian.com/fqvideo/login              |
| 发布页 | https://pugc.yueduwuxian.com/fqvideo/home/publish-video |

| 能力                    | 状态                                           |
| ----------------------- | ---------------------------------------------- |
| GUI 添加账号 / 登录窗口 | 可用                                           |
| GUI / CLI 自动发布      | 待完善（会提示「番茄视频自动发布流程待完善」） |
| 登录 Cookie 自动检测    | 待完善                                         |
| 发布审核状态回查        | 待完善                                         |

**CLI / 配置别名**：`fqsp`、`fanqie`、`fq`、`番茄视频`

**主要代码位置**（完善发布流程时改这些文件）：

| 文件                               | 说明                           |
| ---------------------------------- | ------------------------------ |
| `src/renderer/utils/configUrl.js`  | 渲染层 URL（与主进程保持一致） |
| `src/main/config/ptConfig.js`      | 主进程 / CLI 用 URL            |
| `src/main/services/upLoad/fqsp.js` | 自动发布逻辑（当前为占位）     |
| `src/main/services/zt/fqsp.js`     | 审核状态查询（当前为占位）     |
| `src/main/services/getCookie.js`   | 登录态 Cookie 规则（待补充）   |

侧栏图标（可选）：将 `fqsp.png` 放到 `src/renderer/layout/components/Sidebar/ptcion/`。

## 命令行（CLI）

从项目根或已安装应用启动时，在参数中加入 **`cli`** 即进入 CLI（不打开主窗口）。完整参数说明见 **[docs/cli.md](./docs/cli.md)**。子命令一览：

| 子命令                | 支持平台                                                                                             | 作用                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `cli login`           | **抖音**（`-p dy`）、**视频号**（`-p sph`）                                                          | 终端二维码扫码登录                                             |
| `cli publish`         | **7 个已自动化平台**（`dy \| tt \| ks \| blbl \| bjh \| sph \| xhs`）；`fqsp` 已注册但发布逻辑待完善 | 发布视频（本地路径或 http(s) URL，与 GUI「本地视频发布」等价） |
| `cli publish-article` | **掘金**（`juejin`）                                                                                 | 发布文章（`--content` 或 `--file`）                            |
| `cli accounts`        | 全平台（含 `fqsp` 番茄视频）                                                                         | 列出所有账号并实时检测 cookie 登录态                           |
| `cli history`         | 全平台（含 `fqsp` 番茄视频）                                                                         | 读取本机发布记录（`pushData`），支持平台/手机号/状态/时间过滤  |

> **非 CLI 登录平台的登录怎么办？** 当前 CLI 登录已实现抖音与视频号；其它平台**先在 GUI 完成一次登录**即可——CLI 通过同一 `persist:<phone><平台>` session partition 读取 cookie，后续 `cli publish` / `cli accounts` 会自动复用登录态。登录态过期时 `cli accounts` 会报 `cookie 已过期`，此时回到 GUI 重登一次即可。

常用示例：

```bash
# 抖音登录
matrixmedia cli login -p dy --phone 13800138000

# 发布视频
matrixmedia cli publish -p dy --phone 13800138000 -f /path/to/video.mp4 -t "标题"

# 发布掘金文章
matrixmedia cli publish-article -p juejin --phone 13800138000 -t "文章标题" --file ./post.md

# 查看账号 / 历史（JSON）
matrixmedia cli accounts --json
matrixmedia cli history --json --days 7
```

开发环境调用示例：

```bash
ELECTRON_RUN_AS_NODE= electron . cli login --help
ELECTRON_RUN_AS_NODE= electron . cli publish --help
ELECTRON_RUN_AS_NODE= electron . cli publish-article --help
ELECTRON_RUN_AS_NODE= electron . cli accounts --help
ELECTRON_RUN_AS_NODE= electron . cli history --help
```

### Windows：安装即可用

Windows NSIS 安装包从 `0.4.5` 起会在安装时自动把应用安装目录加入当前用户 `PATH`，并固定 CLI 命令名为 `matrixmedia`。安装完成并重新打开终端后，可直接执行：

```bash
matrixmedia cli login --help
matrixmedia cli publish --help
matrixmedia cli accounts
matrixmedia cli history -d 7
```

### macOS：一条命令加入 PATH

macOS 的 `.dmg` 只是磁盘镜像，无法像 NSIS 那样自动写 PATH。把 app 拖进 `/Applications` 后，执行一次下面的命令创建符号链接即可：

```bash
sudo ln -sf /Applications/matrixmedia.app/Contents/MacOS/matrixmedia /usr/local/bin/matrixmedia
```

之后在任意终端都能直接用 `matrixmedia cli ...`。若后续升级 app 只是覆盖安装（app 路径不变），符号链接仍然有效，无需重复执行。卸载时删除链接：

```bash
sudo rm /usr/local/bin/matrixmedia
```

若无需永久写入，也可临时 alias：

```bash
alias mm='/Applications/matrixmedia.app/Contents/MacOS/matrixmedia'
```

### macOS：提示“已损坏，无法打开”

macOS 目前仅分发 `x64` 安装包；Apple Silicon（M1/M2/M3）会通过 Rosetta 2 运行。若提示“已损坏，无法打开”，通常不是安装包真的损坏，而是 macOS Gatekeeper 对未签名 / 未公证应用的拦截。

临时处理方式：

```bash
sudo xattr -rd com.apple.quarantine /Applications/matrixmedia.app
open /Applications/matrixmedia.app
```

正式分发给普通用户时，建议使用 Apple Developer 的 Developer ID 证书对 macOS 包进行签名和公证。

### 其它提示

- 中英文可执行文件名已统一为 `matrixmedia`，无需区分。
- 若环境变量 `ELECTRON_RUN_AS_NODE` 被误开启，请先按提示关闭后再启动。
- `cli accounts` / `cli history` 仅读取本机数据，不会触发任何登录或发布动作，适合在 pipeline 里做 preflight 检查。

## 内置 HTTP API（需 GUI 已启动）

应用图形界面启动后，会自动在本机 **30088** 端口（`BuiltInServerPort`，见 `env/.env`）监听内置 Express 服务。完整路由与参数说明见 **[docs/http-api.md](./docs/http-api.md)**（应用内「项目详情」页亦有摘要）。

> **与 CLI 的区别**：HTTP API 依赖 GUI 主进程已运行（托盘/窗口在即可）；CLI 可独立启动。单平台请求会等待上传完成或超时；多平台请求与 GUI 批量发布一致，提交到发布队列后立即返回。

### 数据接口

| 方法 | 路径                   | 说明                                     |
| ---- | ---------------------- | ---------------------------------------- |
| POST | `/changeData`          | 读写本地 JSON 数据（账号树、发布历史等） |
| GET  | `/creative-statements` | 各平台创作声明选项（对齐 GUI 批量设置）  |

### 发布视频

| 方法 | 路径       | 说明                                               |
| ---- | ---------- | -------------------------------------------------- |
| POST | `/publish` | 发布视频到单平台或多平台（本地路径或 http(s) URL） |

**请求体（JSON）**：

| 字段                 | 必填   | 说明                                                                                                                                     |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`           | 单平台 | 平台：`dy` / `抖音`、`sph` / `视频号`、`ks` / `快手` 等（与 `platforms` 二选一）                                                         |
| `platforms`          | 多平台 | 平台数组，如 `["dy","sph","ks"]`；或对象数组 `[{ "platform": "dy", "phone": "138..." }, ...]`（可覆盖共享字段）                          |
| `file`               | 是     | 本地视频绝对路径，或 `http://` / `https://` 远程视频 URL（会先下载到临时目录，全部平台发布结束后自动删除；定时发布则在到点执行时再下载） |
| `title`              | 是     | 视频标题                                                                                                                                 |
| `phone`              | 二选一 | 账号手机号（与 GUI 账号树一致）；多平台时可作为默认值，单个平台对象内可覆盖                                                              |
| `partition`          | 二选一 | 完整 session，如 `persist:13800138000抖音`                                                                                               |
| `bt2`                | 否     | 视频号短标（含视频号时强烈建议填写）                                                                                                     |
| `tags`               | 否     | 标签，支持空格 / 逗号分隔；HTTP 会按 GUI 批量发布习惯拆分                                                                                |
| `publishAt`          | 否     | 一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`（多平台时需全部一致）                                                                         |
| `creativeStatement`  | 否     | 全局创作声明，等同 GUI「批量设置」；详见 [docs/http-api.md](./docs/http-api.md)                                                          |
| `creativeStatements` | 否     | 按平台覆盖，如 `{ "dy": "ai_generated", "blbl": "fiction" }`                                                                             |

**响应体（JSON）**：

| 字段                             | 说明                                               |
| -------------------------------- | -------------------------------------------------- |
| `success`                        | 请求是否被接受；多平台表示已成功提交到发布队列     |
| `status`                         | 单平台为最终状态；多平台提交成功为 `submitted`     |
| `exitCode`                       | 单平台同 CLI；多平台提交成功为 `0`                 |
| `message`                        | 结果说明                                           |
| `total` / `succeeded` / `failed` | 多平台提交汇总；最终成功失败以 `pushData` 记录为准 |
| `results`                        | 多平台时各平台提交明细数组                         |
| `id`                             | 单平台时写入 `pushData` 的记录 id                  |
| `scheduled` / `publishAt`        | 定时发布时返回                                     |

**示例**：

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

远程视频 URL 示例：

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

多平台一次发布（同一视频顺序发布到抖音、视频号、快手；远程 URL 只下载一次）：

```bash
curl -X POST http://127.0.0.1:30088/publish \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "13800138000",
    "file": "https://example.com/video.mp4",
    "title": "我的视频标题",
    "bt2": "5公里新手挑战",
    "tags": "跑步 新手",
    "platforms": ["dy", "sph", "ks"]
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
      "platform": "视频号",
      "success": true,
      "exitCode": 0,
      "status": "submitted",
      "message": "已提交发布任务"
    },
    {
      "platform": "抖音",
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

成功响应示例（单平台）：

```json
{
  "success": true,
  "status": "success",
  "exitCode": 0,
  "id": "abc123",
  "publishAt": null,
  "scheduled": false,
  "message": "上传成功"
}
```

参数错误时返回 HTTP `400`；发布失败（如未登录）仍返回 HTTP `200`，但 `success: false`、`exitCode: 3`。服务已配置 CORS，浏览器或本机脚本均可调用。

## Contributors

- **核心维护**：[@hanliang97](https://github.com/hanliang97)
- **集成协作**：[OpenClaw](https://github.com/openclaw/openclaw)、[Hermes](https://github.com/NousResearch/hermes-agent) 等智能体 / 编排生态 — 本仓库顶部以 `openclaw-integrable` 注释示例地显式声明 CLI 入口；`cli login` / `cli publish` / `cli accounts` / `cli history` 的参数与退出码约定面向所有「外部命令型」AI 工具设计，任何遵循同样契约的平台（含自研调度器）都可直接接入，欢迎围绕 CLI 契约反馈与共建。
- **AI 协作声明**：部分 CLI 子命令（`cli accounts` / `cli history`）、skills 文档（`.cursor/skills/matrixmedia-cli-publish/`）以及 README 的 CLI 章节由 Anthropic Claude（通过 [Claude Code](https://claude.com/claude-code)）、DeepSeek、OpenAI Codex、GPT 等 AI 工具辅助设计、实现与撰写；人类维护者负责需求决策、代码评审与合入。所有产出遵循本仓库的 [GPL-2.0-only](./LICENSE) 授权条款，不因 AI 参与而改变许可。

欢迎通过 Issue / PR 参与共建。

## 使用声明

1. 本项目仅用于合法合规的学习与效率提升场景，请严格遵守各平台服务协议与当地法律法规。
2. 请勿将本项目用于批量作弊、恶意营销、侵权搬运、刷量等违规用途，由此产生的风险与责任由使用者自行承担。
3. 涉及账号、Cookie、本地素材等敏感数据时，请妥善保管并自行评估安全风险。
4. 部分平台（如哔哩哔哩）可能需要人工参与（例如手动上传封面），请以平台当前页面规则为准。

## 开源免费

国内 gitee 下载地址 https://gitee.com/gzlingyi_0/pubtw/releases/

github 下载地址为 https://github.com/hanliang97/MatrixMedia/releases


## 工具使用文档

国内文档地址
https://gitee.com/gzlingyi_0/pubtw/wikis/pages?sort_id=14772656&doc_id=7335804

## 开发环境 node 20

##### 使用 yarn 安装

yarn

##### 启动之后，会在 9080 端口监听

yarn dev

##### build 命令在不同系统环境中，需要的的不一样，需要自己根据自身环境进行配置

yarn build

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=hanliang97/MatrixMedia&type=Date)](https://star-history.com/#hanliang97/MatrixMedia&Date)
