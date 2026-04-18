# CLI Skills 入口

本仓库已提供可供 AI 自动调用的 CLI Skill：

- `.cursor/skills/matrixmedia-cli-publish/SKILL.md`

配套示例：

- `.cursor/skills/matrixmedia-cli-publish/examples.md`

该 Skill 覆盖以下子命令：

| 子命令 | 用途 |
|--------|------|
| `cli login` | 抖音扫码登录 / puppeteer 无头登录 |
| `cli publish` | 发布本地视频（与 GUI「本地视频发布」等价） |
| `cli accounts` | 列出所有账号并实时检测 cookie 登录态 |
| `cli history` | 读取 `pushData` 发布记录，支持平台/手机号/状态/时间过滤 |

数据目录均为 `<Documents>/MatrixMedia/data/`（与 GUI 共用）。

如果你的 AI 平台支持读取仓库内 Skill 目录，可直接加载上述文件并按其中流程执行 `cli login` / `cli publish` / `cli accounts` / `cli history`。
