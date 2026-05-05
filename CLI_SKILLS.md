# CLI Skills 入口

本仓库已提供可供 AI 自动调用的 CLI Skill：

- `.cursor/skills/matrixmedia-cli-publish/SKILL.md`

配套示例：

- `.cursor/skills/matrixmedia-cli-publish/examples.md`

该 Skill 覆盖以下子命令：

| 子命令 | 支持平台 | 用途 |
|--------|----------|------|
| `cli login` | **仅抖音**（`-p dy`） | 抖音扫码登录 / puppeteer 无头登录 |
| `cli publish` | **全部 6 个平台**（`dy \| tt \| ks \| blbl \| bjh \| sph`） | 发布本地视频（与 GUI「本地视频发布」等价） |
| `cli accounts` | 全平台 | 列出所有账号并实时检测 cookie 登录态 |
| `cli history` | 全平台 | 读取 `pushData` 发布记录，支持平台/手机号/状态/时间过滤 |

> 非抖音平台**无 CLI 登录通道**：请先在 GUI 登录一次，CLI 会复用同一 `persist:<phone><平台>` session partition 继续发布与查询。

数据目录均为 `<Documents>/MatrixMedia/data/`（与 GUI 共用）。

## AI 发布方法

AI 调用 `cli publish` 时必须传入真实发布数据，不能只创建空任务。最小必填项：

- `-p` / `--platform`：平台，如 `dy`
- `--phone` 或 `--partition`：发布账号
- `-f` / `--file`：实际本地视频路径
- `-t` / `--title`：实际视频标题

一次性定时发布使用 `--publish-at "YYYY-MM-DD HH:mm:ss"`，例如：

```bash
matrixmedia cli publish \
  -p dy \
  --phone 13800138000 \
  -f "/absolute/path/to/video.mp4" \
  -t "视频标题" \
  --bt2 "短标题" \
  --tags "#标签1 #标签2" \
  --publish-at "2026-05-05 20:30:00"
```

定时发布只支持明确年月日时分秒，不支持每日、每周、每月循环。任务创建后会立即进入发布历史；如果程序关闭错过执行时间，下次启动会显示“任务过期”，用户可在视频管理中重新发布。

## 快速安装（让 `matrixmedia` 进入 PATH）

- **Windows**：NSIS 安装包会自动把安装目录写入当前用户 PATH，安装完成重开终端即可直接用 `matrixmedia cli ...`。
- **macOS**：`.dmg` 无法写 PATH，拖装到 `/Applications` 后执行一次：

  ```bash
  sudo ln -sf /Applications/matrixmedia.app/Contents/MacOS/matrixmedia /usr/local/bin/matrixmedia
  ```

  卸载链接：`sudo rm /usr/local/bin/matrixmedia`。

如果你的 AI 平台支持读取仓库内 Skill 目录，可直接加载上述文件并按其中流程执行 `cli login` / `cli publish` / `cli accounts` / `cli history`。
