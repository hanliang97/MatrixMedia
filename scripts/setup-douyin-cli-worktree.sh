#!/usr/bin/env bash
# --------------
# 可选：为抖音 / CLI 相关改动建立独立 worktree（与主分支隔离）
# 用法：bash scripts/setup-douyin-cli-worktree.sh [分支名]
# 目录：.worktrees/douyin-cli-login（已在 .gitignore）
# --------------
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BRANCH="${1:-feat/douyin-cli-login}"
WT_DIR="$ROOT/.worktrees/douyin-cli-login"

if ! git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git branch "$BRANCH" HEAD
  echo "已创建分支: $BRANCH"
fi

if [[ -e "$WT_DIR/.git" ]]; then
  echo "Worktree 已存在: $WT_DIR"
  git -C "$WT_DIR" status -sb
  exit 0
fi

mkdir -p "$(dirname "$WT_DIR")"
git worktree add "$WT_DIR" "$BRANCH"
echo "Worktree 就绪: $WT_DIR (branch: $BRANCH)"
