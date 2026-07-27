---
title: 快速开始
description: 下载安装矩媒 MatrixMedia，并了解 GUI、CLI、HTTP API 与 MCP 的上手路径。
---

# 快速开始

## 下载

| 渠道                   | 地址                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub Releases        | [github.com/hanliang97/MatrixMedia/releases](https://github.com/hanliang97/MatrixMedia/releases) |
| Gitee Releases（国内） | [gitee.com/gzlingyi_0/pubtw/releases](https://gitee.com/gzlingyi_0/pubtw/releases/)              |

支持 **Windows**、**macOS**（另有 Linux 构建产物，以 Releases 为准）。

## 图形界面

1. 安装并启动应用
2. 在侧栏各平台完成账号登录
3. 使用本地视频发布 / 批量设置进行矩阵分发

打开应用后可在「项目详情」页查看 HTTP / MCP / CLI 接入说明。

## 命令行（CLI）

同一可执行文件支持 CLI。典型流程：

```bash
# 抖音登录（终端二维码）
matrixmedia cli login -p dy --phone 13800138000

# 发布（示例，参数以 --help 为准）
matrixmedia cli publish --help
```

完整说明见 [CLI 参考](/reference/cli)。

## HTTP API

GUI 启动后，本机默认监听 `http://127.0.0.1:30088`，可通过 `POST /publish` 触发发布。

详见 [HTTP API](/reference/http-api)。

## MCP（AI 工具接入）

仓库内置 `mcp/` 子包，可被 Claude Desktop、Cursor 等通过 stdio 调用。

详见 [MCP](/reference/mcp)。

## 教程视频

[B 站教程](https://www.bilibili.com/video/BV1fiX5BzEb7)

## 更多文档

- 国内 Wiki：[Gitee Wiki](https://gitee.com/gzlingyi_0/pubtw/wikis/pages?sort_id=14772656&doc_id=7335804)
- 源码仓库：[GitHub · MatrixMedia](https://github.com/hanliang97/MatrixMedia)
- 官网文档：[hanliang97.github.io/MatrixMedia](https://hanliang97.github.io/MatrixMedia/)
