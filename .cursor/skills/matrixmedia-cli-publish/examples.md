# Examples

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

## Example 8: Pre-publish preflight

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
