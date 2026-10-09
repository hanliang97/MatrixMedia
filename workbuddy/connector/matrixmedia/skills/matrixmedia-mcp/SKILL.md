---
name: matrixmedia-mcp
display_name: 矩媒连接器使用指南
display_name_en: MatrixMedia Connector Guide
description: 指导 AI 使用矩媒 MatrixMedia 连接器的 MCP 工具发布视频/文章、检查登录态、查询发布记录与账号数据。触发词：发布视频、矩阵发布、多平台发布、发抖音、发视频号、发小红书、定时发布、发布记录、登录状态、粉丝数据。
description_zh: 矩媒连接器的工具调用说明
description_en: How to use the MatrixMedia connector MCP tools
version: 1.1.0
author: MatrixMedia
---

# 矩媒 MatrixMedia 连接器

连接器通过本机已安装的矩媒桌面端执行操作。任何工具返回“未找到 MatrixMedia”时，告诉用户先安装桌面端（https://github.com/hanliang97/MatrixMedia/releases ，国内 https://gitee.com/gzlingyi_0/pubtw/releases ），然后停止。

平台代码：dy=抖音 ks=快手 sph=视频号 xhs=小红书 blbl=哔哩哔哩 bjh=百家号 tt=头条 fqsp=番茄视频 juejin=掘金。

## 工具

| 工具                 | 用途                                    | 必填参数                          |
| -------------------- | --------------------------------------- | --------------------------------- |
| `list_accounts`      | 列出账号及登录态（只读）                | 无；可选 `platform`               |
| `list_history`       | 本机发布记录（只读）                    | 无；可选 `days` `platform` `status` `all` |
| `publish_video`      | 发布视频（**对外公开**）                | `platform` `phone` `file` `title` |
| `publish_article`    | 发布掘金文章（**对外公开**）            | `platform=juejin` `phone` `title`，`content` 或 `file` |
| `get_publish_status` | 查询发布任务进度与结果（只读）          | `jobId`；可选 `waitSeconds`（默认 20，最大 25） |
| `get_account_stats`  | 读本地账号数据快照                      | `phone` `platform`                |
| `sync_account_stats` | 采集最新账号数据                        | `phone` `platform`                |
| `get_work_stats`     | 按完整标题查单个视频数据                | `phone` `platform` `title`        |

数据类工具支持 dy sph blbl bjh tt ks xhs（番茄视频、掘金没有数据接口）。

## 发布流程

1. 参数不全时询问用户；不知道账号时先调 `list_accounts` 让用户选择。`phone` 填账号列表里的 `phone` 字段。
2. 调 `list_accounts`（带 `platform`）确认目标账号已登录。未登录时请用户打开矩媒桌面端登录该平台账号后再继续。
3. **发布前必须确认**：列出 平台 / 账号 / 文件 / 标题 / 简介 / 标签 / 定时时间，用户明确同意后再调用 `publish_video`。用户已明确说“直接发”且参数完整时可省略。
4. 调 `publish_video`（或 `publish_article`）。工具最多等 20 秒：
   - 返回 `status: running` + `jobId`：上传仍在后台进行。告诉用户“正在上传”，然后用 `get_publish_status` 传入 `jobId` 轮询，直到状态不再是 `running`。上传通常需要数分钟，最长约 40 分钟。
   - **不要**因为任务还在运行就再次调用 `publish_video`。参数相同的重复调用会返回同一个任务（`reused: true`），不会重复上传。
   - 20 秒内就完成或失败的，会直接返回最终结果或错误。
5. 根据最终结果总结：
   - `status: success`：成功。
   - `status: scheduled`：已创建定时任务，提醒用户到点时保持矩媒运行。
   - `status: needs_attention`：视频号挂链接失败、已存草稿，请用户去视频号后台检查，**不要重发**。
   - `status: failed` 或报错含“登录”：请用户在桌面端重新登录后重试。
   - 报错“参数错误”：修正后最多重试一次。
   - `get_publish_status` 提示“未找到该任务”（连接器重启过）：调用 `list_history` 确认这条视频是否已发布，**不要**直接重新发布。

## 字段规则

- `file`：本地绝对路径，或 `http(s)` 地址（自动下载）。
- `description`：抖音/快手/视频号拼入正文；小红书为正文；B站为简介；头条/百家号忽略。
- `tags`：最多 4 个，ASCII 空格分隔；抖音/快手/视频号每个必须带 `#`（如 `"#健身 #跑步"`）；头条/百家号不要生成。
- `shortTitle`：仅视频号，6–16 字、无标点；用户没给时根据标题提炼生成并在总结中回显。
- `publishAt`：`YYYY-MM-DD HH:mm:ss`，必须是未来时间，只支持一次性。
- `draft: true`：存草稿不发布。
- 视频号挂载：`sphProductId`（商品编号）、`sphDramaId`（小程序短剧**名称**）、`sphSeriesId`（剧集**名称**），三者择一。
- 番茄视频不写入任何标题/简介/标签元数据。

## 安全

- 未经确认不要批量或重复发布。
- 不要尝试读取会话 Cookie 或凭证文件。
