# matrixmedia-mcp

[矩媒 MatrixMedia](https://github.com/hanliang97/MatrixMedia) 的 MCP Server。让 Claude Desktop、Cursor、Cline、WorkBuddy 等 MCP 客户端直接把视频发布到抖音、快手、视频号、小红书、哔哩哔哩、百家号、头条、番茄视频，以及发布掘金文章、查询账号与发布记录。

> 需要先安装 MatrixMedia 桌面端：[GitHub Releases](https://github.com/hanliang97/MatrixMedia/releases) ·
> [Gitee Releases](https://gitee.com/gzlingyi_0/pubtw/releases)。非抖音/视频号平台需先在桌面端登录一次。

## 配置

```json
{
  "mcpServers": {
    "matrixmedia": {
      "command": "npx",
      "args": ["-y", "matrixmedia-mcp"]
    }
  }
}
```

## 查找 MatrixMedia 可执行文件的顺序

1. 环境变量 `MATRIXMEDIA_BIN`（可执行文件绝对路径）
2. PATH 中的 `matrixmedia`
3. 默认安装位置（macOS `/Applications/matrixmedia.app`、Windows `%LOCALAPPDATA%\Programs\矩媒`、Linux `/opt/矩媒`）
4. 环境变量 `MATRIXMEDIA_DIR` 指向的源码仓库（开发模式，使用仓库内 electron）

## 工具

`list_accounts` · `list_history` · `publish_video` · `publish_article` · `get_publish_status` · `get_account_stats` · `sync_account_stats` · `get_work_stats`

详见 [docs/mcp.md](https://github.com/hanliang97/MatrixMedia/blob/main/docs/mcp.md)。

## 长任务

视频上传可能耗时数分钟到数十分钟，而 MCP 客户端通常要求单次调用约 30 秒内返回。因此 `publish_video` / `publish_article`
最多阻塞 20 秒（可用 `MATRIXMEDIA_INLINE_WAIT_MS` 调整）：期间完成则直接返回结果，否则返回 `{ status: "running", jobId }`，
之后用 `get_publish_status({ jobId })` 轮询（每次最多等待 25 秒）。参数完全相同的发布在运行中重复调用会复用同一任务，不会重复上传。
任务记录只保存在内存中，MCP Server 重启后请用 `list_history` 核对发布结果。
