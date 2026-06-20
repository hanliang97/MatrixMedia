# MCP Server 说明

仓库内置 `mcp/` 子包，实现了 [Model Context Protocol](https://modelcontextprotocol.io) Server，让支持 MCP 的 AI 工具**无需 shell 调用**即可直接操作 MatrixMedia。

MCP **不直接请求 HTTP**，而是通过 stdio transport 接收 tool 调用，内部 `spawn` CLI 子进程完成实际操作。

## 构建

```bash
cd mcp && npm install && npm run build
```

构建产物：`mcp/dist/index.js`

## 配置 AI 工具

将 `MATRIXMEDIA_DIR` 设为本仓库根目录的绝对路径。

**Claude Desktop**（`~/Library/Application Support/Claude/claude_desktop_config.json`）：

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

**Cursor / Cline**（`.cursor/mcp.json` 或全局 MCP 配置，格式相同）：

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

重启 AI 工具后即可在对话中调用下方 tool。

## Tool 一览

| Tool              | 底层 CLI              | 说明                                           |
| ----------------- | --------------------- | ---------------------------------------------- |
| `list_accounts`   | `cli accounts --json` | 列出本机已登录账号，支持按平台过滤             |
| `list_history`    | `cli history --json`  | 查询本机发布记录，支持按平台/状态/天数过滤     |
| `publish_video`   | `cli publish ...`     | 发布视频（最长约 35 分钟，支持定时发布）       |
| `publish_article` | `cli publish-article ...` | 发布掘金文章（需已登录掘金账号）           |

### list_accounts

| 参数       | 必填 | 说明                                                                 |
| ---------- | ---- | -------------------------------------------------------------------- |
| `platform` | 否   | 平台过滤：`dy` / `ks` / `blbl` / `bjh` / `tt` / `sph` / `xhs` / `juejin` / `fqsp` |

### list_history

| 参数       | 必填 | 说明                                           |
| ---------- | ---- | ---------------------------------------------- |
| `days`     | 否   | 最近 N 天，默认 7                              |
| `platform` | 否   | 平台过滤                                       |
| `status`   | 否   | `success` / `failed` / `publishing` / `scheduled` |
| `all`      | 否   | 为 `true` 时返回全部历史                       |

### publish_video

| 参数        | 必填 | 说明                               |
| ----------- | ---- | ---------------------------------- |
| `platform`  | 是   | `dy` / `ks` / `blbl` / `bjh` / `tt` / `sph` |
| `file`      | 是   | 视频文件绝对路径                   |
| `title`     | 是   | 视频标题                           |
| `phone`     | 是   | 账号手机号，用于推导 session partition |
| `bt2`       | 否   | 第二标题 / 视频号短标              |
| `tags`      | 否   | 标签字符串                         |
| `address`   | 否   | 地址（百家号等）                   |
| `publishAt` | 否   | 定时发布，`YYYY-MM-DD HH:mm`       |
| `show`      | 否   | 是否显示底层浏览器窗口             |

### publish_article

| 参数        | 必填 | 说明                               |
| ----------- | ---- | ---------------------------------- |
| `platform`  | 是   | 目前仅支持 `juejin`                |
| `phone`     | 是   | 已登录掘金账号手机号               |
| `title`     | 是   | 文章标题                           |
| `content`   | 二选一 | 正文内容                         |
| `file`      | 二选一 | Markdown 文件路径                |
| `cover`     | 否   | 封面图片路径                       |
| `category`  | 否   | 分类                               |
| `tags`      | 否   | 标签                               |
| `summary`   | 否   | 摘要                               |
| `publishAt` | 否   | 定时发布时间                       |
| `show`      | 否   | 是否显示底层浏览器窗口             |

## 登录说明

- 所有平台均需在 **GUI 中完成登录**后再通过 MCP 发布（`publish_video` / `publish_article`）。
- MCP 运行在无头 stdio 环境，**无法弹出扫码窗口**。
- 抖音 / 视频号可通过 CLI `cli login` 在终端完成扫码，MCP 会复用同一 session partition。

## 相关文档

- [CLI 说明](./cli.md)
- [HTTP API 说明](./http-api.md)
