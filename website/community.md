---
title: 社区 · 打开统计
description: 矩媒 MatrixMedia 匿名打开次数统计看板（基于 GitHub Gist）。
---

# 社区 · 打开统计

本页展示所有打开过 MatrixMedia Electron 应用的**匿名**统计数据。数据通过 GitHub API 从一个公开 Gist 读取，每次应用启动（GUI / CLI）会追加一条事件，**不做去重**，仅记录"打开"这一动作。

<ActiveUsersBoard />

## 数据说明

- 每条事件仅包含：时间、应用版本、操作系统平台、CPU 架构、界面语言、启动方式（GUI / CLI）。
- **不采集**任何可识别个人信息：无用户 ID、无设备指纹、无账号、无 IP、无地理位置。
- 数据存储在一个公开 GitHub Gist 中，任何人都可以查看原始数据。

## 关闭上报

如果你不希望上报匿名打开事件，任选其一：

1. 设置环境变量 `MATRIXMEDIA_DISABLE_TELEMETRY=1`
2. 在用户主目录创建文件 `~/.matrixmedia/no-telemetry`（内容任意）

## 自建统计（维护者）

如果你 fork 本项目并想自建统计：

1. 创建一个**公开** GitHub Gist，文件名固定为 `events.json`，初始内容为 `[]`。
2. 记下 Gist id（URL 中 `/` 后的那串）。
3. 创建一个有 `gist` 权限的 GitHub Token。
4. 在 Electron 端设置环境变量：
   - `MATRIXMEDIA_GIST_ID=<gist id>`
   - `MATRIXMEDIA_GIST_TOKEN=<token>`
   或把 token 放到 `~/.matrixmedia/gist-token` 文件中。
5. 在 `website/.vitepress/theme/components/ActiveUsersBoard.vue` 顶部把 `GIST_ID` 填为同一 gist id。

详见 [遥测参考](/reference/telemetry)。
