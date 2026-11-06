# 等待平台确认的原任务语义

## 本次修复范围

修复原未提交回归测试暴露的链路缺口：收到平台扫码/安全确认进度后仍显示发布中；定时任务把等待或草稿当作发表成功；历史查询用旧成功计数覆盖等待状态；CSV 不认识等待确认。沿用 `needs_attention` / 退出码 4，增加其原始 `waiting_confirmation` 原因，不增加平台上传器或公众号发布能力。

- `puppeteerFile-progress` 的 `waiting_confirmation` 只更新原记录，成功/失败计数不增长，CLI 继续等待；`verifying` 继续核验。
- 最终仍需确认时保留 `outcome: waiting_confirmation`、原发表/草稿意图和消息，退出 4，不触发重试。无消息时也不能显示上传成功。
- 即时、定时、目录批量和 GUI 共用结果/进度转换。主进程按 taskId 隔离任务，终结后忽略重复或迟到回执。
- GUI/任务登记持久绑定 `taskId`；`publishSettled` 区分暂时等待和最终待确认。GUI 通过 `expectedTaskId` 在同一主进程的同步存储边界比较当前代次和终结标记后写入，旧任务、迟到/重复回执返回 `stale_publish_task`，不覆盖新任务或终态。旧历史仍可只读；重新发布时建立新代次。
- GUI 视频管理、`cli history` 的中英文筛选、CSV 和 MCP 历史枚举均识别等待确认。MCP 不再把所有退出码 4 强制解释为草稿保存。

## 实际验证

基线为 `284e47a`，Node 20.15.1 / Yarn 1.22.22。原等待进度、历史、CSV 测试均先失败，逐项最小实现后通过。新增 CLI 测试通过真实临时 JSON 存储及对外 `runCliMain` 验证即时/目录模式：目录入口曾错误退出 0，修复后退出 4、成功数 0，重复终结回执不覆盖原等待记录。仅 Electron 和发布浏览器边界受控替代，没有替换存储或结果策略。

MCP 在锁定 SDK 1.29.0 的依赖下完成构建，新增回归先确认等待被错报为 draft，再确认修复后保留 publish / waiting_confirmation；与受影响后台任务测试共 5 项通过。首次构建因缺依赖失败；锁定镜像不可达后，仅临时替换下载源到 npm 官方注册表安装同一锁定版本，安装结束恢复锁文件，未提交依赖变更。

真实 Electron / Vue / HTTP 数据服务的 GUI 测试隔离 HOME、userData 和 Documents，只使用合成记录。实际收到进度却显示发布中的红灯已复现；修复后可从应用菜单查看等待确认，公开数据接口返回记录数 1、成功 0、失败 0。截图已实际查看：

![合成历史记录的等待确认状态](./images/publish-waiting-confirmation.png)

适用命令（均由根包脚本、MCP 构建脚本和开发说明发现）：

```bash
node scripts/test-publish-waiting-confirmation.js
node scripts/test-publish-waiting-confirmation-cli.js
xvfb-run -a node scripts/test-publish-waiting-confirmation-gui.js
yarn test:publish-abnormal
yarn test:history-status
yarn test:history-args
yarn test:publish-history-csv
yarn test:scheduled-dedupe
yarn test:publish-draft-args
yarn test:article-republish
yarn test:pushdata-dedupe
yarn test:change-data-path
yarn --cwd mcp build
node --test mcp/tests/publishWaitingConfirmation.test.mjs mcp/tests/publishJobs.test.mjs
yarn build:dir
git diff --check
```

上述构建和受影响测试已通过。GUI 测试前必须先完成根包构建，不能在运行时并行重建 dist。测试启动器曾有 Electron 加载/菜单定位错误，已修正后才计入有效红绿证据；不把测试环境错误计为产品红灯。

## 未验证与回退

仓库要求的 `node e2e/run.js -p dy --yes` 已尝试：首次因缺少 ffmpeg 在生成视频时退出 2；补齐本地 ffmpeg 并生成合成视频后重跑，runner 退出 1，平台分类 ERROR、CLI 退出 2，诊断为缺少 `--phone` 或完整 `--partition`，`draftVerified=N/A`。真实 CLI `accounts --json` 返回空列表（0 个账号），没有可用登录态；没有实际平台上传。报告位于忽略目录 `e2e/artifacts/20261106-024001/report.md`。真实平台草稿验证尚未通过，不能将受控 GUI/CLI/MCP 测试冒充真实平台证据。真实扫码平台页面、Windows/打包安装未验证；根包类型/lint 未配置（N/A），MCP 类型检查由构建覆盖。本轮仅跑受影响检查，不宣称全仓 CI 或完整平台门禁通过。

## 审查修复

Standards 与 Spec 均发现草稿等待回执丢失原意图，以及 GUI 缺少任务关联/终结写入保护；Standards 另指出目录草稿计数与其他入口分叉。均以对外 CLI 或真实 Electron/HTTP 旅程重现后修复：草稿等待原先返回 publish，现保留 draft；其他任务的等待事件原先改变当前记录，现忽略；终结后的迟到进度/重复回执被拒绝，并验证 HTTP 交错终结/进度写入；目录草稿成功计数原先 0，现为 1。复审及干净 PR 分支验证在固定修复提交后继续运行，不将进行中的验证算通过。

复审发现主进程回写也需携带代次条件。新增真实 CLI/存储交错回归：同素材 A 尚未结束即登记 B，A 进度原先把 B 改成等待确认；修复后 A 的进度/完成写入均返回 `stale_publish_task`，保留 A 自己的实际回执、不误触发重发，B 继续独立终结。即时、目录与定时主进程均传入捕获的当前代次；定时任务在开始条件写入失败时不执行发布。测试移除原稿对内部存储/账号策略的替代，通过真实临时 JSON 和公开 history 核对即时/定时行为。

受影响兼容检查发现旧草稿结果精确断言未包含新增的两个布尔标记，现补全明确的 false/true 预期，保留草稿和退出码断言。文章重发测试在 Node 20 下缺少 CommonJS 转换而无法加载原有 ESM 工具，按现有测试规范显式配置 preset-env 后通过；不改变文章重发产品逻辑。

没有 schema 迁移、账号清理或发布重试策略变更；没有新增独立状态机，现有共享回执模块是唯一状态转换边界，无新增 ADR 系列。回退保留历史 `waiting_confirmation` 及原消息，禁止把这些记录当成功或自动重新发布；应停受影响任务并到平台核对原内容。当前原稿中的公众号配置/登录能力未随此修复交付。

## 最终受影响验证与复审

在独立 PR 分支的固定代码提交 `301b99f` 完成上述根包受影响测试、真实 Electron GUI 测试及 `yarn build:dir`，均退出 0。MCP 源码在最终代次修复中未变，已完成构建及上述 5 项测试（0 失败、0 跳过）。依赖通过本地链接复用且仅由本地 Git exclude 忽略，不提交依赖或构建产物；此分支只包含本切片的代码、测试和文档。

固定非空范围 `284e47a...301b99f` 的 Standards / Spec 独立复审均无新增可操作问题，前述发现均已修复。权限/路径范围、同素材并发任务、重复及迟到回执、错误码和存储一致性由受影响回归覆盖；不将受控平台边界替代视为真实平台验证。真实平台门禁仍未通过，PR 保持草稿，不能因构建和受控测试通过而合并。
