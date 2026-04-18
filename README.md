# 矩媒 MatrixMedia

自媒体矩阵发布工具（Electron）。支持图形界面与**命令行（CLI）**自动化：

- **CLI 登录**：目前仅支持**抖音**（终端二维码 / puppeteer 无头）。
- **CLI 发布**：**全部 6 个平台**均可用——抖音、快手、百家号、哔哩哔哩、头条、视频号。
- **CLI 查询**：`cli accounts` 实时检测登录态，`cli history` 查看本机发布记录。

便于脚本与智能体编排。

<!-- openclaw-integrable: id=matrixmedia-cli version=1 platform=electron argv-marker=cli -->
<!-- 说明：OpenClaw 或其它自动化工具可通过 argv 含 `cli` 识别为 CLI 模式；子命令 `login`（仅抖音）与 `publish`（全部 6 个平台）详见下文。 -->

## OpenClaw 联动

本项目声明 **可与 [OpenClaw](https://github.com/openclaw/openclaw) 等工具联动**：通过启动应用并传入 `cli` 参数进入无图形主界面流程，由标准输入输出与退出码交互。

| 标识 | 含义 |
|------|------|
| `openclaw-integrable` | 仓库级声明，供发现与文档检索 |
| `id=matrixmedia-cli` | 建议的工具/技能命名空间 |
| `argv-marker=cli` | 进程参数中需包含子串 `cli`（如 `矩媒.exe cli publish ...`） |

典型用法：在 OpenClaw 侧将本应用配置为**外部命令**（`command` + `args`）：`cli login` 仅用于完成**抖音**的扫码登录；其它平台请先在 GUI 登录一次，CLI 会复用同一 session partition；`cli publish` 对全部 6 个平台一致可用。终端二维码与无头模式等行为见各子命令 `--help`。

## 目前可以一键发布视频的平台有

1. 抖音
2. 快手
3. 百家号
4. 哔哩哔哩
5. 头条号
6. 视频号
7. 小红书 未测试

## 命令行（CLI）

从项目根或已安装应用启动时，在参数中加入 **`cli`** 即进入 CLI（不打开主窗口）。子命令一览：

| 子命令 | 支持平台 | 作用 |
|--------|----------|------|
| `cli login` | **仅抖音**（`-p dy`） | 抖音扫码登录 / puppeteer 无头登录 |
| `cli publish` | **全部 6 个平台**（`dy \| tt \| ks \| blbl \| bjh \| sph`） | 发布本地视频（与 GUI「本地视频发布」等价） |
| `cli accounts` | 全平台 | 列出所有账号并实时检测 cookie 登录态 |
| `cli history` | 全平台 | 读取本机发布记录（`pushData`），支持平台/手机号/状态/时间过滤 |

> **非抖音平台的登录怎么办？** 当前 CLI 登录只实现了抖音一家；其它平台**先在 GUI 完成一次登录**即可——CLI 通过同一 `persist:<phone><平台>` session partition 读取 cookie，后续 `cli publish` / `cli accounts` 会自动复用登录态。登录态过期时 `cli accounts` 会报 `cookie 已过期`，此时回到 GUI 重登一次即可。

开发态调用示例：

```bash
ELECTRON_RUN_AS_NODE= electron . cli login --help
ELECTRON_RUN_AS_NODE= electron . cli publish --help
ELECTRON_RUN_AS_NODE= electron . cli accounts --help
ELECTRON_RUN_AS_NODE= electron . cli history --help
```

### Windows：安装即可用

Windows NSIS 安装包从 `0.4.5` 起会在安装时自动把应用安装目录加入当前用户 `PATH`，并固定 CLI 命令名为 `matrixmedia`。安装完成并重新打开终端后，可直接执行：

```bash
matrixmedia cli login --help
matrixmedia cli publish --help
matrixmedia cli accounts
matrixmedia cli history -d 7
```

### macOS：一条命令加入 PATH

macOS 的 `.dmg` 只是磁盘镜像，无法像 NSIS 那样自动写 PATH。把 app 拖进 `/Applications` 后，执行一次下面的命令创建符号链接即可：

```bash
sudo ln -sf /Applications/matrixmedia.app/Contents/MacOS/matrixmedia /usr/local/bin/matrixmedia
```

之后在任意终端都能直接用 `matrixmedia cli ...`。若后续升级 app 只是覆盖安装（app 路径不变），符号链接仍然有效，无需重复执行。卸载时删除链接：

```bash
sudo rm /usr/local/bin/matrixmedia
```

若无需永久写入，也可临时 alias：

```bash
alias mm='/Applications/matrixmedia.app/Contents/MacOS/matrixmedia'
```

### 其它提示

- 中英文可执行文件名已统一为 `matrixmedia`，无需区分。
- 若环境变量 `ELECTRON_RUN_AS_NODE` 被误开启，请先按提示关闭后再启动。
- `cli accounts` / `cli history` 仅读取本机数据，不会触发任何登录或发布动作，适合在 pipeline 里做 preflight 检查。

## 使用声明

1. 本项目仅用于合法合规的学习与效率提升场景，请严格遵守各平台服务协议与当地法律法规。
2. 请勿将本项目用于批量作弊、恶意营销、侵权搬运、刷量等违规用途，由此产生的风险与责任由使用者自行承担。
3. 涉及账号、Cookie、本地素材等敏感数据时，请妥善保管并自行评估安全风险。
4. 部分平台（如哔哩哔哩）可能需要人工参与（例如手动上传封面），请以平台当前页面规则为准。

## 开源免费
国内gitee下载地址 https://gitee.com/gzlingyi_0/pubtw/releases/

github下载地址为 https://github.com/hanliang97/MatrixMedia/releases

## 工具使用文档
国内文档地址
https://gitee.com/gzlingyi_0/pubtw/wikis/pages?sort_id=14772656&doc_id=7335804

## 开发环境 node 20

##### 使用yarn安装
yarn

##### 启动之后，会在9080端口监听
yarn dev

##### build命令在不同系统环境中，需要的的不一样，需要自己根据自身环境进行配置
yarn build
