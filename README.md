# 矩媒 MatrixMedia

## <strong>📺 [教程视频](https://www.bilibili.com/video/BV1fiX5BzEb7)</strong> · <strong>📝 [技术文章](https://juejin.cn/post/7636984000939327498)</strong>

自媒体矩阵发布工具（Electron）。支持图形界面与**命令行（CLI）**自动化：

- **支持平台**：Windows、macOS、CLI。
- **CLI 登录**：目前仅支持**抖音**（终端二维码 / puppeteer 无头）。
- **CLI 发布**：**全部 7 个平台**均可用——抖音、快手、百家号、哔哩哔哩、头条、视频号、小红书。
- **CLI 查询**：`cli accounts` 实时检测登录态，`cli history` 查看本机发布记录。

便于脚本与智能体编排。

<!-- openclaw-integrable: id=matrixmedia-cli version=1 platform=electron argv-marker=cli -->
<!-- 说明：本仓库以 argv 含 `cli` 作为统一入口，可被 OpenClaw / Hermes / Claude Code / Cursor / Dify / n8n 等 AI 工具与智能体编排框架发现与调用；子命令 `login`（仅抖音）与 `publish`（全部 7 个平台）详见下文。 -->

## AI 工具 / 智能体联动

本项目的 CLI 被刻意设计为 **AI 工具无关 / 框架无关** 的外部命令：只要你的工具能调用 shell、读取退出码或 JSON stdout，就能直接对接 —— 包括但不限于：

- [OpenClaw](https://github.com/openclaw/openclaw)
- [Hermes](https://github.com/NousResearch/hermes-agent)
- Claude Code、Cursor、Cline、Aider 等编程智能体
- Dify、n8n、LangChain、CrewAI、AutoGen 等工作流 / 多智能体编排框架
- 任何支持「外部命令 + argv + 退出码」约定的自动化平台（含自研调度器）

统一约定：

| 约定项 | 内容 |
|--------|------|
| 进入 CLI 模式 | argv 含子串 `cli` 即进入无 GUI 流程（如 `matrixmedia cli publish ...`） |
| 子命令 | `cli login \| publish \| accounts \| history`，每个均支持 `--help` |
| 退出码 | `0` 成功 / `1` 异常 / `2` 参数错误 / `3` 业务失败（登录、上传等） |
| 机器可读输出 | `cli accounts --json` 与 `cli history --json` 产出稳定 JSON，便于上游消费 |
| 登录态共享 | CLI 与 GUI 共用 `persist:<phone><平台>` session partition，互不侵扰 |

仓库顶部的 `<!-- openclaw-integrable ... -->` HTML 注释以 OpenClaw 的 schema 示例上述约定；其它平台如需类似的仓库级可发现标记，可沿用同一 `argv-marker=cli` 语义，或加上自家的注释标签（例如 `<!-- hermes-integrable ... -->`），互不冲突。

典型用法：在 AI 平台/智能体侧将本应用配置为 **外部命令**（`command` + `args`）：`cli login` 仅用于完成 **抖音** 的扫码登录；其它平台请先在 GUI 登录一次，CLI 会复用同一 session partition；`cli publish` 对全部 7 个平台一致可用。终端二维码与无头模式等行为见各子命令 `--help`。

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

重启 AI 工具后，以下 3 个 tool 即可在对话中直接调用：

| Tool | 说明 |
|---|---|
| `list_accounts` | 列出本机已登录账号，支持按平台过滤 |
| `list_history` | 查询本机发布记录，支持按平台 / 状态 / 天数过滤 |
| `publish_video` | 发布视频到指定平台（最长 35 分钟，支持定时发布） |

> **登录说明**：所有平台均需在 GUI 中完成登录后再通过 MCP 发布。MCP 运行在无头 stdio 环境，无法弹出扫码窗口。

## 目前可以一键发布视频的平台有

1. 抖音
2. 快手
3. 百家号
4. 哔哩哔哩
5. 头条号
6. 视频号
7. 小红书

## 命令行（CLI）

从项目根或已安装应用启动时，在参数中加入 **`cli`** 即进入 CLI（不打开主窗口）。子命令一览：

| 子命令 | 支持平台 | 作用 |
|--------|----------|------|
| `cli login` | **仅抖音**（`-p dy`） | 抖音扫码登录 / puppeteer 无头登录 |
| `cli publish` | **全部 7 个平台**（`dy \| tt \| ks \| blbl \| bjh \| sph \| xhs`） | 发布本地视频（与 GUI「本地视频发布」等价） |
| `cli accounts` | 全平台 | 列出所有账号并实时检测 cookie 登录态 |
| `cli history` | 全平台 | 读取本机发布记录（`pushData`），支持平台/手机号/状态/时间过滤 |

> **非抖音平台的登录怎么办？** 当前 CLI 登录只实现了抖音一家；其它平台**先在 GUI 完成一次登录**即可——CLI 通过同一 `persist:<phone><平台>` session partition 读取 cookie，后续 `cli publish` / `cli accounts` 会自动复用登录态。登录态过期时 `cli accounts` 会报 `cookie 已过期`，此时回到 GUI 重登一次即可。

开发态调用示例：

```bash
ELECTRON_RUN_AS_NODE= electron . cli login --help
ELECTRON_RUN_AS_NODE= electron . cli publish --help
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

### 其它提示

- 中英文可执行文件名已统一为 `matrixmedia`，无需区分。
- 若环境变量 `ELECTRON_RUN_AS_NODE` 被误开启，请先按提示关闭后再启动。
- `cli accounts` / `cli history` 仅读取本机数据，不会触发任何登录或发布动作，适合在 pipeline 里做 preflight 检查。

## Contributors

- **核心维护**：[@hanliang97](https://github.com/hanliang97)
- **集成协作**：[OpenClaw](https://github.com/openclaw/openclaw)、[Hermes](https://github.com/NousResearch/hermes-agent) 等智能体 / 编排生态 — 本仓库顶部以 `openclaw-integrable` 注释示例地显式声明 CLI 入口；`cli login` / `cli publish` / `cli accounts` / `cli history` 的参数与退出码约定面向所有「外部命令型」AI 工具设计，任何遵循同样契约的平台（含自研调度器）都可直接接入，欢迎围绕 CLI 契约反馈与共建。
- **AI 协作声明**：部分 CLI 子命令（`cli accounts` / `cli history`）、skills 文档（`.cursor/skills/matrixmedia-cli-publish/`）以及 README 的 CLI 章节由 Anthropic Claude（通过 [Claude Code](https://claude.com/claude-code)）辅助设计、实现与撰写；人类维护者负责需求决策、代码评审与合入。所有产出遵循本仓库的 [GPL-2.0-only](./LICENSE) 授权条款，不因 AI 参与而改变许可。

欢迎通过 Issue / PR 参与共建。

## 使用声明

1. 本项目仅用于合法合规的学习与效率提升场景，请严格遵守各平台服务协议与当地法律法规。
2. 请勿将本项目用于批量作弊、恶意营销、侵权搬运、刷量等违规用途，由此产生的风险与责任由使用者自行承担。
3. 涉及账号、Cookie、本地素材等敏感数据时，请妥善保管并自行评估安全风险。
4. 部分平台（如哔哩哔哩）可能需要人工参与（例如手动上传封面），请以平台当前页面规则为准。

## 开源免费
国内gitee下载地址 https://gitee.com/gzlingyi_0/pubtw/releases/

github下载地址为 https://github.com/hanliang97/MatrixMedia/releases

## 工具使用文档
国内文档地址
https://gitee.com/gzlingyi_0/pubtw/wikis/pages?sort_id=14772656&doc_id=7335804

## 开发环境 node 20

##### 使用yarn安装
yarn

##### 启动之后，会在9080端口监听
yarn dev

##### build命令在不同系统环境中，需要的的不一样，需要自己根据自身环境进行配置
yarn build
