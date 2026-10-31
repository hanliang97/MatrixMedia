#!/bin/bash
# 评论专用 MCP server 启动器示例：
# - MM_MCP_COMMENTS_ONLY=1 → 只暴露 list_comments / reply_comment（避免与已安装桌面端的
#   matrixmedia server 重复暴露发布类 tool）
# - MATRIXMEDIA_BIN → CLI 调用路由到本仓库源码树（新评论子命令只在源码树时必需）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MATRIXMEDIA_BIN="$ROOT/mcp/mm-dev-bin.sh"
export MM_MCP_COMMENTS_ONLY=1
exec node "$ROOT/mcp/dist/index.js"
