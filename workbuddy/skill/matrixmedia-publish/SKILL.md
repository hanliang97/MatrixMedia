---
name: matrixmedia-publish
display_name: 矩媒 · 多平台视频矩阵发布
display_name_en: MatrixMedia Video Matrix Publisher
description: 通过矩媒 MatrixMedia 桌面端把本地或远程视频一键发布到抖音、快手、视频号、小红书、哔哩哔哩、百家号、头条、番茄视频，并发布掘金文章、检查账号登录状态、查询发布记录与账号数据。触发词：发布视频、矩阵发布、批量发布、多平台发布、定时发布、发抖音、发视频号、发小红书、查看发布记录、检查登录状态、账号粉丝数据、MatrixMedia、矩媒。
description_zh: 自媒体视频矩阵一键发布到 8 大平台
description_en: Publish videos to 8 Chinese short-video platforms via the MatrixMedia desktop app
category: productivity
version: 1.0.0
author: MatrixMedia
allowed-tools: Bash, Read
---

# 矩媒 MatrixMedia 多平台发布

本技能通过调用本机已安装的 **矩媒 MatrixMedia 桌面端** 的命令行模式（`matrixmedia cli ...`）完成发布与查询。它本身不能发布任何内容。

## 第 0 步：确认已安装（每个会话做一次）

依次尝试，找到第一个可用的命令记为 `$MM`：

| 系统    | 候选命令                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------- |
| 通用    | `matrixmedia`（PATH 中可用时）                                                                 |
| macOS   | `/Applications/matrixmedia.app/Contents/MacOS/matrixmedia`                                     |
| Windows | `"%LOCALAPPDATA%\Programs\矩媒\matrixmedia.exe"`（NSIS 安装器会自动把安装目录加入用户 PATH） |
| Linux   | `matrixmedia`（deb/rpm）或 AppImage 文件的绝对路径                                             |

自检命令：`$MM cli --help`，能输出用法即可。

**如果都不可用**：停止执行，告诉用户需要先安装矩媒桌面端，并给出下载地址，不要尝试任何 `cli` 命令：

- GitHub：https://github.com/hanliang97/MatrixMedia/releases
- 国内 Gitee：https://gitee.com/gzlingyi_0/pubtw/releases

macOS 用户如需在任意终端使用 `matrixmedia`，可建议（需用户同意 sudo）：
`sudo ln -sf /Applications/matrixmedia.app/Contents/MacOS/matrixmedia /usr/local/bin/matrixmedia`

## 子命令一览

| 子命令            | 平台                                                          | 作用                                  | 是否写入/对外 |
| ----------------- | ------------------------------------------------------------- | ------------------------------------- | ------------- |
| `cli accounts`    | 全部                                                          | 列出账号及实时登录态                  | 只读          |
| `cli history`     | 全部                                                          | 查询本机发布记录                      | 只读          |
| `cli stats`       | dy sph blbl bjh tt ks xhs                                     | 读本地账号数据快照（粉丝/播放/点赞…） | 只读          |
| `cli stats-sync`  | 同上                                                          | 用已登录会话采集最新数据              | 本地写入      |
| `cli stats-work`  | 同上                                                          | 按标题查单个视频数据                  | 只读          |
| `cli login`       | **仅** `dy`（抖音）、`sph`（视频号）                          | 终端二维码扫码登录                    | 写会话        |
| `cli publish`     | `dy` `ks` `sph` `xhs` `blbl` `bjh` `tt` `fqsp`                | 发布视频                              | **对外公开**  |
| `cli publish-article` | `juejin`                                                  | 发布掘金文章                          | **对外公开**  |

平台代码：dy=抖音 ks=快手 sph=视频号 xhs=小红书 blbl=哔哩哔哩 bjh=百家号 tt=头条 fqsp=番茄视频 juejin=掘金。

参数不确定时先运行 `$MM cli <子命令> --help`。

## 标准发布流程

1. **收集参数**：平台、账号（`--phone`，即 GUI 中的账号分组名/手机号）、视频文件、标题。缺任何一项就向用户询问，不要猜测。用户没给账号时，先执行第 2 步列出账号供其选择。
2. **检查登录态**：`$MM cli accounts -p <平台> --json`，确认目标账号 `loggedIn: true`。
   - 未登录且平台是 `dy` / `sph`：执行 `$MM cli login -p <平台> --phone <账号>`，终端会打印二维码，请用户用手机 App 扫码。
   - 未登录且是其他平台：告诉用户打开矩媒桌面端在界面里登录一次，CLI 会复用登录态。不要尝试对其他平台执行 `cli login`。
3. **发布前确认（必须）**：发布会直接公开到用户的账号。执行 `cli publish` 前，用一段简短列表向用户复述 平台 / 账号 / 文件 / 标题 / 简介 / 标签 / 定时时间，等用户明确确认后再执行。用户已在同一句话里明确说“直接发”且参数完整时可省略。批量发布时一次确认整批即可。
4. **执行发布**：

   ```bash
   $MM cli publish -p dy --phone 13800138000 \
     -f "/绝对路径/video.mp4" -t "视频标题" \
     --description "视频简介" --tags "#标签1 #标签2"
   ```

   - `-f` 用绝对路径并加引号；也可传 `http(s)` 地址，CLI 会自动下载并在上传后清理。
   - 发布耗时较长（数分钟到半小时），属于正常现象，等待命令结束即可，不要中途重复执行。
5. **检查退出码并总结**（见下文），必要时用 `$MM cli history --phone <账号> -p <平台> -n 5` 确认记录。

## 发布参数

| 参数                       | 说明                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `-p` / `--platform`        | 平台代码（必填）                                                     |
| `--phone`                  | 账号（必填，或用 `--partition persist:<手机号><平台中文名>`）       |
| `-f` / `--file`            | 视频路径或 URL（必填）                                               |
| `-t` / `--title`           | 标题（必填）                                                         |
| `--description`            | 简介 / 正文                                                          |
| `--short-title`            | 仅视频号：短标题，6–16 字                                            |
| `--tags`                   | 话题标签，空格分隔，最多 4 个                                        |
| `--address`                | 仅百家号：地址                                                       |
| `--publish-at`             | 一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`                           |
| `--draft`                  | 存草稿而不直接发布                                                   |
| `--sph-product-id`         | 仅视频号：挂商品（商品编号）                                         |
| `--sph-drama-id`           | 仅视频号：挂小程序短剧，**值为短剧名称**而非编号                     |
| `--sph-series-id`          | 仅视频号：挂视频号剧集，**值为剧集名称**而非编号                     |

各平台字段落点：

| 平台                 | 标题       | `--description`  | `--short-title` | `--tags`               |
| -------------------- | ---------- | ---------------- | --------------- | ---------------------- |
| 抖音 / 快手 / 视频号 | 标题       | 拼入正文         | 仅视频号        | 拼入正文末尾，必须带 `#` |
| 小红书               | 标题       | 正文             | 忽略            | 独立话题控件，可不带 `#` |
| 哔哩哔哩             | 投稿标题   | 简介             | 忽略            | 独立标签控件，可不带 `#` |
| 头条 / 百家号        | 标题       | 忽略             | 忽略            | 忽略（不要生成）       |
| 番茄视频             | 不写元数据 | 不写元数据       | 不写元数据      | 不写元数据             |

### 标签规则

- 最多 4 个，选最相关的，不要凑数。
- 严格用 ASCII 空格分隔，不要用逗号、顿号。
- 抖音 / 快手 / 视频号必须每个带 `#`：`--tags "#减脂 #健身 #新手 #跑步"`。

### 视频号短标题规则

用户只给了长标题且发视频号时，自动生成短标题并在总结中回显：

- 6–16 字（建议 8–12），不要直接截断长标题，提炼核心看点/数字。
- 不使用任何标点（，。、！？,;:!?'"()[]{}<> 等会被替换成空格）。
- 例：长标题“新手第一天跑步就坚持 5 公里是什么体验” → `5公里新手挑战`。

### 定时发布

- 只支持明确时间点 `--publish-at "2026-05-05 20:30:00"`，不支持每天/每周等循环。
- 时间必须晚于当前时间，否则让用户重新给出。
- 定时任务需要矩媒桌面端在该时间保持运行；错过时间会标记为“任务过期”，不要自动重发。

## 掘金文章

```bash
$MM cli publish-article -p juejin --phone 13800138000 -t "文章标题" --file "/绝对路径/post.md" --tags "前端 electron"
```

`--content` 与 `--file` 至少给一个；可选 `--cover` `--category` `--summary` `--publish-at`。同样需要发布前确认。

## 查询类命令

```bash
$MM cli accounts --json                       # 全部账号与登录态
$MM cli accounts -p dy --logged-out --json    # 抖音未登录账号
$MM cli history -d 7 --json                   # 近 7 天发布记录
$MM cli history -p sph -s failed -d 30        # 视频号近 30 天失败记录
$MM cli stats-sync -p dy --phone 13800138000  # 采集最新账号数据
$MM cli stats -p dy --phone 13800138000       # 读取账号数据
$MM cli stats-work -p dy --phone 13800138000 --title "完整视频标题"
```

## 退出码与处理

| 退出码 | 含义                       | 处理                                                                |
| ------ | -------------------------- | ------------------------------------------------------------------- |
| 0      | 成功                       | 总结结果                                                            |
| 1      | 异常 / 超时                | 读取输出中的错误；可建议用户打开桌面端查看                          |
| 2      | 参数错误                   | 按提示修正参数后重试一次                                            |
| 3      | 业务失败（多为未登录）     | dy/sph 执行 `cli login`；其他平台请用户在桌面端重新登录，然后重试   |
| 4      | 视频号挂链接失败，已存草稿 | 告诉用户去视频号后台手动检查，**不要**重新发布                      |

同一任务失败后最多自动重试一次；重复失败时停止并把错误信息交给用户。

## 安全约束

- 不要在未经用户确认的情况下批量发布或重复发布同一视频。
- 不要读取或输出会话 Cookie、`<文档>/MatrixMedia/data/` 下的凭证文件内容。
- CLI 与桌面端同时操作同一账号可能冲突，发布期间提醒用户不要在桌面端操作该账号。

## 结果总结模板

```markdown
执行结果：
- 平台 / 账号：抖音 / 13800138000
- 视频：demo.mp4 ｜ 标题：xxx
- 结果：成功 ｜ 失败（原因）
- 下一步：无 ｜ 需要扫码登录 ｜ 需在桌面端重新登录
```

更多完整示例见 @references/examples.md
