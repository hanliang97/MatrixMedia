# AGENTS.md

> 给通用 AI 编程 / 办公智能体（OpenAI Codex、WorkBuddy、Cursor、Claude Code、Jules 等）阅读的仓库级说明。
> 本文件遵循 [agents.md](https://agents.md) 约定：根目录放置、Markdown、面向 Agent 而非人类最终用户。
> 人类用户请阅读 [README.md](./README.md)；Claude Code 另见 [CLAUDE.md](./CLAUDE.md)（提交信息规范）。

## 项目一句话

MatrixMedia（matrix-video）是一个基于 Electron 的**自媒体矩阵发布工具**：在 Windows / macOS / CLI 三态下，一键将视频或图文发布到抖音、快手、百家号、哔哩哔哩、头条、视频号、小红书、番茄等平台。

## 关键入口（不要找错）

| 类型     | 位置                                   | 说明                                                |
| -------- | -------------------------------------- | --------------------------------------------------- |
| 主进程   | `src/main/index.js`                    | Electron 主进程入口                                 |
| CLI 入口 | `src/main/cli/index.js`                | **argv 含子串 `cli` 即进入无 GUI 模式**             |
| CLI 子命令 | `src/main/cli/run*.js`               | `login` / `publish` / `publish-article` / `accounts` / `history` |
| 渲染进程 | `src/renderer/`                        | Vue 界面（GUI 模式）                                |
| MCP      | `mcp/`                                 | 独立的 Model Context Protocol Server 子包           |
| 文档     | `docs/cli.md` `docs/http-api.md` `docs/mcp.md` | 外部集成时**必读**                          |

## 给 Agent 的「How to invoke」契约

外部 AI 工具调用本仓库能力时，**不要** fork 进程内 API，统一走以下三种契约之一：

1. **CLI（推荐）**：`matrixmedia cli <subcommand> [args]`
   - 退出码：`0` 成功 / `1` 异常 / `2` 参数错误 / `3` 业务失败
   - 机器可读：`cli accounts --json`、`cli history --json` 产出稳定 JSON
   - 每个子命令支持 `--help`
2. **HTTP API**：GUI 启动后 `POST http://127.0.0.1:30088/publish`，详见 `docs/http-api.md`
3. **MCP**：支持 stdio transport 的工具直接接 `mcp/dist/index.js`，详见 `docs/mcp.md`

完整契约表见 `README.md` 的「AI 工具 / 智能体联动」章节。

## 开发环境

- **Node**：20.x（不要用 18 / 22）
- **包管理**：`yarn`（仓库根有 `yarn.lock`，也有 `package-lock.json`，**优先 yarn**）
- **构建**：`electron-builder`

## 常用命令

```bash
# 安装依赖（首次）
yarn install

# 开发模式（带热更新）
yarn dev

# 各平台打包
yarn build              # Windows x64
yarn build:mac          # macOS x64 + arm64
yarn build:linux        # Linux x64 + arm64

# 测试脚本（不是 jest，是 node 直跑）
yarn test:cli-login
yarn test:publish-article-args
yarn test:article-republish
yarn test:puppeteer-cancel
yarn test:account-login-window-manager
yarn test:pick-release-installer
yarn test:main-process-log-file
yarn test:dev-download-server
```

> 没有统一的 `yarn test`，也没有 lint / typecheck 脚本。改完代码请**手动跑相关的 `scripts/test-*.js`**。

## 代码风格 / 约定

- **提交信息**：必须中文，遵循 `CLAUDE.md` 中的 `<type>(<scope>): <中文概述>` 格式
  - type 用英文：`feat` / `fix` / `refactor` / `perf` / `style` / `docs` / `chore` / `test`
  - 不要在提交信息里加 `Co-Authored-By` 或 `Generated with ...` 水印
- **注释 / 文档**：中文优先，专有名词保留英文
- **平台标识**：`bjh`（百家号）/ `tt`（头条）/ `xhs`（小红书）/ `sph`（视频号）等缩写沿用到 scope、文件夹、变量名

## Agent 修改代码时的「坑」

1. **GUI 与 CLI 共享 session partition**（`persist:<phone><平台>`），改登录相关代码时不要破坏这个约定，否则 CLI 与 GUI 会互踢。
2. **Puppeteer 注入的 JS 会被打包压缩**，避免在生产代码里依赖闭包变量名；参考 `fix(bjh)` 提交记录里的「三连击 + Ctrl/Cmd+A + Backspace」模式。
3. **argv 判断逻辑**在 `src/main/cli/detectArgv.js`，新增 CLI 子命令要同步更新 `parseXxxArgs.js` 与 `docs/cli.md`。
4. **不要直接改 `dist/`**：那是构建产物。
5. **`telemetrySecret.generated.js` 由 `scripts/gen-telemetry-secret.js` 生成**，已在 `.gitignore`，不要提交。

## 测试 / 验证流程

1. 改 CLI 行为 → 跑对应 `yarn test:cli-*` 或 `yarn test:publish-*`
2. 改登录窗口 → 跑 `yarn test:account-login-window-manager`
3. 改打包逻辑 → 跑 `yarn test:pick-release-installer`
4. 跨子命令改动 → 至少手动 `node . cli <subcommand> --help` 验证参数解析没坏

## 安全 / 合规

- 本工具仅用于**合法合规的学习与效率提升**，不得用于批量作弊、刷量、侵权搬运
- 涉及 Cookie / 账号 / 素材时，不要上传到任何远端；日志里也不要打印完整 Cookie
- 许可证：**GPL-2.0-only**（见 `LICENSE`），所有 AI 辅助产出同样遵循该许可

## 当 Agent 不确定时

按以下顺序查阅：

1. `README.md`（用户视角）
2. `docs/cli.md` / `docs/http-api.md` / `docs/mcp.md`（集成契约）
3. `CLAUDE.md`（提交规范）
4. `src/main/cli/` 源码（最权威的参数解析）
5. 仍不确定 → 在 PR / Issue 中向人类维护者（@hanliang97）确认，**不要瞎猜**
