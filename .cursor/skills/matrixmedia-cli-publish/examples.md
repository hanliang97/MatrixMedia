# Examples

> Examples below assume `matrixmedia` is on PATH. On Windows the NSIS installer
> handles this automatically. On macOS, the user runs once:
>
> ```bash
> sudo ln -sf /Applications/matrixmedia.app/Contents/MacOS/matrixmedia /usr/local/bin/matrixmedia
> ```
>
> Without the symlink, replace every `matrixmedia` below with
> `/Applications/matrixmedia.app/Contents/MacOS/matrixmedia`.

## Example 1: Minimal publish

User intent: 发布抖音视频，已登录。

```bash
matrixmedia cli publish \
  -p dy \
  --phone 13800138000 \
  -f "/Users/me/videos/demo.mp4" \
  -t "测试标题"
```

## Example 2: Login then publish

User intent: 首次登录后发布。

```bash
matrixmedia cli login -p dy --phone 13800138000

matrixmedia cli publish \
  -p dy \
  --phone 13800138000 \
  -f "/Users/me/videos/demo.mp4" \
  -t "矩媒CLI发布演示" \
  --name "CLI演示任务" \
  --tags "开源,CLI,自动化"
```

## Example 3: Show window for debugging

```bash
matrixmedia cli publish \
  -p dy \
  --phone 13800138000 \
  -f "/Users/me/videos/demo.mp4" \
  -t "调试模式" \
  --show \
  --no-close-window
```

## Example 4: Audit all account login status

User intent: 每天早上快速看一遍哪些账号掉登录了。

```bash
matrixmedia cli accounts --logged-out
```

Output (table mode):

```
账号           平台      登录态    失效时间            说明
-----------  ------  -----  ----------------  -------------
13800138000  抖音      未登录    -                 无登录 cookie
13900139000  视频号     未登录    2026-04-15 09:10  cookie 已过期
```

## Example 5: JSON feed for orchestration

User intent: 给上层调度系统喂当前登录态快照。

```bash
matrixmedia cli accounts --json > /tmp/mm-accounts.json
```

Each row: `{ phone, pt, partition, loggedIn, reason, expireAt, createdAt }`.

## Example 6: Review recent publish failures

User intent: 这周抖音发布失败的都是啥。

```bash
matrixmedia cli history -p dy -s failed -d 7
```

## Example 7: Explicit date range + machine output

```bash
matrixmedia cli history \
  --since 2026-04-01 \
  --until 2026-04-18 \
  --json > /tmp/mm-april-history.json
```

## Example 8: 视频号 — 短标 + 空格分隔标签（最典型）

User intent: 发布视频号视频，长标题 + 单独短标 + 3 个标签。

```bash
matrixmedia cli publish \
  -p sph \
  --phone 13800138000 \
  -f "/Users/me/videos/run5km.mp4" \
  -t "新手第一天跑步就坚持 5 公里是什么体验" \
  --bt2 "5公里新手挑战" \
  --tags "跑步 新手 减脂"
```

Why it matters:
- `--bt2` is 7 chars, within 6–16; no punctuation that would be stripped.
- Tags use **single space**. 视频号 会把它们拼到描述后面（想成 hashtag 需自己写 `"#跑步 #新手 #减脂"`）。
- 不传 `--bt2` 会触发 warn 并回退到 `--title`，基本必翻车。

## Example 9: 抖音 — hashtag 风格标签

抖音把 `bq` 拼在 `bt2` 之后作为描述。想做 hashtag 显式加 `#`：

```bash
matrixmedia cli publish \
  -p dy \
  --phone 13800138000 \
  -f "/Users/me/videos/demo.mp4" \
  -t "新手第一天跑步就坚持5公里是什么体验" \
  --bt2 "5公里新手挑战" \
  --tags "#跑步 #减脂 #新手"
```

## Example 10: 哔哩哔哩 — 独立标签控件

bilibili 的标签是独立输入 + 回车的控件，前导 `#` 会被剥掉，直接写词：

```bash
matrixmedia cli publish \
  -p blbl \
  --phone 13800138000 \
  -f "/Users/me/videos/demo.mp4" \
  -t "开黑就是快乐" \
  --tags "游戏 解说 开黑"
```

## Example 11: 百家号 — tags 会被忽略

当前 `upLoad/bjh.js` 没有写入 tag 逻辑；不要在这里浪费时间编标签，写好标题 + 地址即可：

```bash
matrixmedia cli publish \
  -p bjh \
  --phone 13800138000 \
  -f "/Users/me/videos/demo.mp4" \
  -t "这家咖啡店必须推给你" \
  --address "北京市朝阳区三里屯"
```

## Example 12: Pre-publish preflight

User intent: 发布前顺手核一次登录态。

```bash
# 1) 检查账号在线
matrixmedia cli accounts -p dy --phone 13800138000

# 2) 若返回「未登录」，先扫码登录
matrixmedia cli login -p dy --phone 13800138000

# 3) 发布
matrixmedia cli publish \
  -p dy \
  --phone 13800138000 \
  -f "/Users/me/videos/demo.mp4" \
  -t "今日发布"

# 4) 回查最近一条记录
matrixmedia cli history --phone 13800138000 -p dy -n 1
```
