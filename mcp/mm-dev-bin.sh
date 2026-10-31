#!/bin/bash
# MATRIXMEDIA_BIN 包装：把 MCP runner 的 `cli <args>` 调用转发到本仓库源码树的 electron。
# 用途：未安装桌面端（或想让 MCP 走源码树 CLI）时，配合 run-comments-mcp.sh 使用。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/node_modules/.bin/electron" "$ROOT" "$@"
