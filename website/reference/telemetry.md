---
title: 遥测（打开统计）
description: MatrixMedia 匿名打开统计的数据字段、上报流程、关闭方式与自建后端说明。
---

# 遥测（打开统计）

MatrixMedia 在应用启动时会向一个公开 GitHub Gist 追加一条**匿名**事件，用于统计"谁打开了 Electron"。本页说明数据字段、上报流程与关闭方式。

## 采集字段

每次启动（GUI 或 CLI）追加一条 JSON 事件到 Gist 的 `events.json`：

| 字段       | 说明                                  | 示例                         |
| ---------- | ------------------------------------- | ---------------------------- |
| `ts`       | 启动时间（ISO 8601，UTC）             | `2026-08-04T03:12:45.000Z`   |
| `version`  | 应用版本                              | `0.10.4`                     |
| `platform` | 操作系统                              | `win32` / `darwin` / `linux` |
| `arch`     | CPU 架构                              | `x64` / `arm64`              |
| `locale`   | 界面语言                              | `zh-CN`                      |
| `mode`     | 启动方式                              | `gui` / `cli`                |

**不采集**：用户 ID、设备指纹、账号、IP、地理位置、文件路径、任何业务数据。

## 上报流程

1. 应用启动后在后台（不阻塞主流程）读取 Gist 当前 `events.json`。
2. 追加本次事件。
3. 若条数超过 5000，只保留最近 5000 条。
4. 写回 Gist。

整个过程是 **best-effort**：失败静默，绝不影响应用启动或使用。

## 关闭上报

任选其一：

- 设置环境变量 `MATRIXMEDIA_DISABLE_TELEMETRY=1`
- 在用户主目录创建文件 `~/.matrixmedia/no-telemetry`（内容任意）

## 自建后端（维护者）

1. 创建一个**公开** Gist，文件名固定为 `events.json`，初始内容 `[]`。
2. 记下 Gist id。
3. 创建一个有 `gist` 权限的 GitHub Token。
4. Electron 端配置（二选一）：
   - 环境变量 `MATRIXMEDIA_GIST_ID` / `MATRIXMEDIA_GIST_TOKEN`
   - token 放到 `~/.matrixmedia/gist-token` 文件
5. 官网侧编辑 `website/.vitepress/theme/utils/gistStats.js`，把 `GIST_ID` 填为同一 gist id，`GIST_OWNER` 填为 gist 所属 GitHub 用户名（官网通过 `gist.githubusercontent.com/<owner>/<id>/raw/<file>` 读取数据，避免未认证 REST API 的 60 次/小时/IP 限额）。

## 相关源码

- Electron 端：[`src/main/services/usageTelemetry.js`](https://github.com/hanliang97/MatrixMedia/blob/main/src/main/services/usageTelemetry.js)
- 官网看板：[`website/.vitepress/theme/components/ActiveUsersBoard.vue`](https://github.com/hanliang97/MatrixMedia/blob/main/website/.vitepress/theme/components/ActiveUsersBoard.vue)
