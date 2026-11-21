# 抖音原生定时验证记录

验证日期：2026-11-21（北京时间）。关联 #40，本次仅提供抖音部分，视频号原生定时未实现、未验收。

## 实现范围

- GUI 单视频、目录批量入口增加「优先原生定时」，CLI / HTTP / MCP 同步透传。
- 抖音立即上传并填写平台排期，其他平台和未勾选场景保留软件定时。
- 输入按本机时区解析，抖音控件使用北京时间；仅接受分钟精度、2 小时后至 14 天内。
- `native_scheduled` 只表示平台接收了排期，不表示审核通过或最终公开。原生任务不进入本地到期发布调度。
- 结果不明返回退出码 4；跨进程占位记录阻止同账号、素材、时刻的自动重复上传。
- 同素材转为立即发布或草稿时显式清空旧原生排期字段，避免历史合并后误用上次时间。

## 真实平台证据及边界

### 原生提交与只读复核

使用自行生成的 6 秒彩色视频，在已授权抖音账号提交了一条北京时间 **2026-11-22 12:00** 的原生排期。

首次 CLI 提交已经点击发布，但旧校验依赖后台「定时发布」文案；实际新后台显示未来日期与审核状态，因此该次返回：

```json
{"status":false,"resultStatus":"needs_attention","nativeScheduleVerified":false,"publishAt":"2026-11-22 12:00:00"}
```

退出码为 **4**，没有将不明结果报告为成功。随后改为读取管理页实际触发的 `work_list` 响应，用修复后的源码对**同一条已提交作品只读复核**：

```json
{"verified":true,"baselineContainsExisting":true,"excludedOldRecord":true,"readOnly":true}
```

判据为成功列表响应中的字符串 `aweme_id`、标题、`timer.public_time`、本次观测到的 `timer.status=0` 及未删除/禁用标志。提交前列表快照中的旧 ID 必须排除。没有把 JSON number 类型的大整数 `item_id` 用作精确 ID。

**没有为验证最终成功回执再次提交。修复后的完整原生 CLI 成功链路尚未重跑；审核及到点公开结果也尚未验证。** 账号、作品 ID、Cookie、原始响应及素材不随代码上传。

### CLI / MCP 防重

在确认同一任务已有提交记录后，分别通过真实 Electron CLI、MCP SDK stdio 调用 `publish_video` 重试同一请求。两次均在上传前被防重记录拦截：

```text
CLI: resultStatus=needs_attention, nativeScheduleVerified=false, exit=4
MCP: status=needs_attention, nativeScheduleVerified=false
message: 同一账号、文件和时间的原生排期已有提交记录，未重复上传。
```

这两项证据覆盖真实防重分支，**不等同于 MCP 或 CLI 的完整成功排期验证**。

### GUI

实际启动构建产物，通过系统文件选择器选中测试素材并打开单视频表单，切换为定时后确认「优先原生定时」、时间输入及说明可见。截图仅保留该表单：

![单视频原生定时控件](images/dy-native-schedule-single.png)

另打开目录批量表单，切换为定时、勾选「优先原生定时」，确认控件可切换、时间输入及范围说明可见；完成后取消表单，没有选择目录或提交任务：

![目录批量原生定时控件](images/dy-native-schedule-directory.png)

GUI 尚未执行原生提交；目录批量上传及路由由下述脚本覆盖。GUI / CLI / MCP 完整正向原生链路尚不满足合并验收，当前适合作为草稿审阅。

## 构建与回归

环境：Windows、Node 20.20.2。已执行 `yarn build:dir`。

以下脚本已通过（`node scripts/test-<名称>.js`）：

```text
dy-native-schedule       native-schedule-guard
native-schedule         native-schedule-service
native-schedule-batch   puppeteer-cancel
publish-abnormal        product-publish-gates
xhs-publish-policy      scheduled-publish
history-status          history-args
publish-history-csv     publish-draft-args
dy-description          scheduled-dedupe
pushdata-dedupe
```

`yarn --cwd mcp build` 通过；`node --test mcp/tests/nativeSchedule.test.mjs` **4/4 通过**。未将 MCP 全量测试报告为通过：其 Windows shebang 测试夹具存在 `ENOENT`，本次未修复。

真实草稿 e2e 使用明确构建后再运行的方式（Windows 上 runner 自动调用 yarn 失败，所以使用 `--skip-build`）：

```text
yarn build:dir
node e2e/run.js -p dy --yes --force --skip-build --phone <已授权账号> --video <测试视频绝对路径>
```

最新源码验证 run `20261121-093417`：构建成功，`PASS_VERIFIED`、退出码 **0**、`draftVerified=true`。实际诊断：

```text
[dy] 已点击存草稿按钮 (#popover-tip-container+button)
[publish] 抖音 存草稿后页面地址已变化（草稿模式仅记录，不判定异常）
[publish] 抖音 已确认草稿保存成功（页面已跳转）
```

这使用现有 runner 的页面跳转判据；未人工在平台后台找到该草稿，不代表原生定时成功。此次复测还确认历史为 `scheduleMode=immediate`、`nativeScheduleAt=null`、`nativeScheduleVerified=false`、`scheduledPublishAt=null`、`scheduledTask=false`，旧排期字段已清空。

## 审阅状态

本补丁由 **OpenAI Codex** 辅助实现和测试。#40 要求同时覆盖抖音与视频号，目前仅完成抖音实现；尚未获得维护者对拆分验收及赏金的确认。本记录用于呈现可核对的实际结果，不声明 #40 已完成。
