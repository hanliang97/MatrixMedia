# 命令行（CLI）说明

在保留图形界面的前提下，同一可执行文件支持 CLI 子命令。入口为参数中出现 `cli`。

## 故障排除

若启动时报 `require('electron') 异常` 且类型为 `string`，多半是环境变量 **`ELECTRON_RUN_AS_NODE`** 被设为 `1`。在该模式下 Electron 以纯 Node 运行，`require('electron')` 只会得到可执行文件路径。请在本终端执行 `unset ELECTRON_RUN_AS_NODE`，或在命令前显式清空后再启动，例如：

```bash
ELECTRON_RUN_AS_NODE= electron . cli publish --help
```

`yarn dev` 已尝试在子进程中清除该变量；若仍异常，请检查 shell 配置（如 `.zshrc`）是否全局导出了 `ELECTRON_RUN_AS_NODE`。

## 抖音 CLI 登录（设计切片）

与 GUI `getCookie` / `LocalVideoPublish` 对齐的最小闭环：

1. **会话**：`partition` 形如 `persist:<手机号段><平台名>`，与账号树、webview 一致。
2. **登录判定**：轮询 `https://creator.douyin.com` 下 Cookie **`passport_assist_user`** 是否有值（主进程 `session.fromPartition`）。
3. **终端扫码**：**屏外坐标 + `showInactive`** 的真实窗口（**不用透明度**），再 **`webContents.capturePage`**（先裁右侧/二维码，失败则整页）→ `qrBitmapToBlocks`。**Linux** 无显示器或 SSH：用 **`xvfb-run -a`** 提供虚拟显示（例：`xvfb-run -a ./矩媒.AppImage cli login ...`）。本机看页：`cli login --show`。
4. **退出**：检测到 Cookie 后关窗；超时 / 用户关窗返回码 3。

可选隔离开发目录：`bash scripts/setup-douyin-cli-worktree.sh`（在 `.worktrees/douyin-cli-login` 创建 worktree）。自动化校验：`yarn test:cli-login`。

## 登录（抖音，CLI）

在未登录或 Cookie 失效时，使用 `cli login`（与 GUI 相同 `partition`，Cookie 持久化）。

默认把浏览器窗口放在**屏外**（不透明），在**终端用黑白方块（█）**刷新截图。Linux 服务器/SSH 请用 **`xvfb-run -a`**。需要本机看到登录页时加 `--show`。

```bash
ELECTRON_RUN_AS_NODE= electron . cli login -p dy --phone 13800138000
```

若 stdout 不是 TTY（如管道重定向），请加 `--show`。参数见 `cli login --help`。成功后再执行 `cli publish`。

## 发布视频

```bash
# 开发（项目根目录，需先 yarn dev 或已 build:dir）
electron . cli publish -p dy --phone 13800138000 -f /path/to/video.mp4 -t "标题"

# Windows 安装包产物
"矩媒.exe" cli publish -p dy --phone 13800138000 -f C:\video.mp4 -t "标题"
```

### 参数摘要

与界面 **本地视频发布**（`LocalVideoPublish.vue` → `buildVideoPayload` / `handleBatchPublish`）同一套字段：

| 参数 | 对应 GUI / 载荷字段 |
|------|---------------------|
| `-p` / `--platform` | 发布平台 |
| `-f` / `--file` | 本地视频路径 → `filePath`、`data.textOtherName`（文件名无扩展名） |
| `--phone` / `--partition` | 会话分区，与账号树一致 |
| `-t` / `--title` | **视频标题**（必填）→ `data.bt1` |
| `--name` / `--book-name` | **名称**（任务记录名）→ `bookName`；省略时默认与视频文件名（无扩展名）一致 |
| `--bt2` | **概括短标题** → `data.bt2`；省略时默认与视频标题一致（视频号等场景） |
| `--tags` / `--bq` | **视频标签** → `data.bq` |
| `--address` | **地址** → `data.address`（仅百家号） |
| `--publish-at` | 一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`；创建后立即进入发布历史 |
| `--show` | 是否显示自动化窗口，同 GUI 开关 |
| `--no-close-window` | 仅当开启 `--show` 时有效；不显示窗口时行为与 GUI 一致（仍会关发布窗） |

完整说明请执行：

```bash
<应用> cli publish --help
```

### 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 未捕获异常 |
| 2 | 参数错误 |
| 3 | 任务失败（如未登录、上传失败） |

### 注意事项

1. **登录态**：CLI 与 GUI 共用同一 `partition` 会话。抖音可使用 **`cli login`** 在窗口内登录；其它平台可先在 GUI 登录，或保证该 `partition` 已有有效 Cookie。
2. **与 GUI 同时运行**：CLI 模式不会申请单实例锁；若与 GUI 同时使用同一账号 partition，可能导致会话冲突，建议错峰使用。
3. **定时发布**：`--publish-at "YYYY-MM-DD HH:mm:ss"` 只支持一次性明确时间点，不支持每日/每周/每月。定时任务会写入发布历史，状态为“等待定时发布”；如果应用关闭导致错过执行时间，下次启动会标记为“任务过期”，可在视频管理中重新发布。
4. **Linux 打包**：使用 `yarn build:linux` 生成 AppImage（需在本机构建环境安装相应依赖）。

## 构建命令

- `yarn build`：Windows x64 NSIS
- `yarn build:mac`：macOS dmg（x64 + arm64）
- `yarn build:linux`：Linux AppImage
- `yarn build:all`：Windows + Linux + macOS
