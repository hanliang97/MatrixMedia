---
name: matrixmedia-cli-publish
description: Run MatrixMedia in CLI mode for login, video publishing, account status inspection, and publish history review. Covers argument building, preflight checks, and failure handling. Use when the user asks to publish via CLI, check 登录状态 / 发布记录, mentions OpenClaw/external command orchestration, or asks AI to execute cli login/publish/accounts/history in this repository.
---

# MatrixMedia CLI

## Subcommands

| Subcommand | Platform coverage | Purpose | Writes state? |
|------------|-------------------|---------|---------------|
| `cli login` | **Douyin only** (`-p dy`) | Scan-to-login via terminal QR or headless puppeteer | yes (session cookies) |
| `cli publish` | **All 6 platforms** (`dy \| tt \| ks \| blbl \| bjh \| sph`) | Publish a local video via puppeteer automation | yes (pushData log) |
| `cli accounts` | All platforms | List all accounts from the GUI account tree and report current login state | no |
| `cli history` | All platforms | Read local publish records (pushData) with platform/phone/status filters | no |

> **Non-Douyin platforms cannot log in via CLI.** Ask the user to log in **once in the GUI**; CLI then reuses the same `persist:<phone><platform>` session partition for `cli publish` / `cli accounts`. If `cli accounts` reports `cookie 已过期`, send the user back to the GUI to re-login — there is no CLI flow for bilibili/kuaishou/baijiahao/toutiao/shipinhao login today.

## Quick Start

Use this skill when the user asks to:
- use CLI mode instead of GUI
- publish videos by command line
- inspect account login status or publish history from the command line
- automate login/publish in OpenClaw or other agent workflows

Default publish sequence:
1. Preflight checks
2. `cli accounts` to verify the target account is logged in (optional but recommended)
3. `cli login` (only when needed)
4. `cli publish`
5. Verify exit code, optionally `cli history -n 5` to confirm the new record
6. Summarize result

## Preflight Checklist

Before running publish commands, ensure:
- current directory is repository root
- video file path exists
- `ELECTRON_RUN_AS_NODE` is not globally forced to `1`
- platform and account identifier are provided

If the user gives incomplete parameters, ask for:
- `platform` (`dy` for Douyin as default)
- `phone` (preferred) or `partition`
- `file` path
- `title`

## Canonical Commands

Installed app (recommended) examples:

```bash
# show login help
matrixmedia cli login --help

# login (Douyin)
matrixmedia cli login -p dy --phone 13800138000

# show publish help
matrixmedia cli publish --help

# publish
matrixmedia cli publish \
  -p dy \
  --phone 13800138000 \
  -f "/absolute/path/to/video.mp4" \
  -t "视频标题" \
  --name "任务名" \
  --tags "标签1,标签2"

# list all accounts with login status
matrixmedia cli accounts

# list only logged-out Douyin accounts in JSON form
matrixmedia cli accounts -p dy --logged-out --json

# last 7 days of publish records
matrixmedia cli history

# failed publishes on Douyin in the last 30 days
matrixmedia cli history -p dy -d 30 -s failed
```

Development mode (repo local) examples:

```bash
# show publish help in source workspace
ELECTRON_RUN_AS_NODE= electron . cli publish --help
```

Windows installer behavior:
- NSIS installer writes install directory to user `PATH`.
- Executable command is unified as `matrixmedia`.
- Users should not need to choose between Chinese/English executable names.

macOS installer behavior:
- `.dmg` only delivers the `.app` bundle; it cannot touch user `PATH`.
- Recommend users run a one-time symlink after drag-installing:

  ```bash
  sudo ln -sf /Applications/matrixmedia.app/Contents/MacOS/matrixmedia /usr/local/bin/matrixmedia
  ```

  After that, plain `matrixmedia cli ...` works in any terminal. The link survives app upgrades as long as the `.app` stays at `/Applications/matrixmedia.app`.
- If the user refuses `sudo`, fall back to an alias in their shell rc:

  ```bash
  alias mm='/Applications/matrixmedia.app/Contents/MacOS/matrixmedia'
  ```

- When scripting on Mac without the symlink, always spell the full binary path — `/Applications/matrixmedia.app/Contents/MacOS/matrixmedia cli ...`.

## Argument Mapping

Map user intent to CLI args:
- `-p`, `--platform`: target platform
- `--phone` or `--partition`: account/session partition
- `-f`, `--file`: local video path
- `-t`, `--title`: required video title
- `--name`, `--book-name`: task name
- `--bt2`: short summary title（see "Per-Platform Field Semantics" below — **mandatory for 视频号**)
- `--tags`, `--bq`: video tags（space-separated; `#` prefix semantics vary per platform)
- `--address`: location field (Baidu use case)
- `--show`: show automation window
- `--no-close-window`: keep window open when `--show` is enabled

## Per-Platform Field Semantics

Each platform consumes `bt1` / `bt2` / `bq` differently — this is the single most common source of "looks right but publishes ugly" bugs. Use this table instead of guessing:

| Platform | `--title` (bt1) | `--bt2` short description | `--tags` (bq) |
|----------|-----------------|---------------------------|---------------|
| **视频号** (sph) | Concatenated into description: `bt1 + " " + bq` | **Required.** Separate input box hinting "6–16 字符". Code strips `，。、/,;:!?'"()[]{}<>` → space. Falling back to `bt1` is almost always wrong. | Concatenated into description with `bt1`. Add `#` yourself if you want hashtag styling. |
| **抖音** (dy) | Title field `.semi-input` | Leads the description: `bt2 + " " + bq`. Falls back to `bt1` if not provided. | Concatenated after `bt2` in description. Add `#` yourself for hashtag styling. |
| **快手** (ks) | Description: `bt1 + " " + bq` | unused | Concatenated after `bt1` in description. Add `#` for hashtag styling. |
| **哔哩哔哩** (blbl) | Submission title | unused | **Independent tag widget.** Code does `split(/\s+/)` then strips leading `#`, types each tag followed by Enter. Leading `#` is harmless but redundant. |
| **百家号** (bjh) | Article title | unused | **unused by current automation** — tags won't be written regardless. |
| **头条** (tt) | Up to 30 chars | unused | **unused** — a fixed category checkbox is auto-selected instead. |
| **小红书** (xhs, experimental) | Title (falls back to `bt2`) | Body fallback (falls back to `bdText`) | `normalizeTagList` splits `\s+`, strips leading `#`, then re-inserts each as `#tag` in the body. |

### 视频号短标生成规则（最常踩坑）

When publishing to 视频号, the agent **must** either accept `--bt2` from the user or generate one. Rules when generating:

1. Length: **6–16 characters (Chinese chars and ASCII letters each count as 1)**. Aim for 8–12 to be safe.
2. Punctuation blacklist (will be replaced with space by the uploader): `，。、/ , ; : ! ? ' " ( ) [ ] { } < >`. Avoid entirely, don't try to style with them.
3. Content: distill the video's core hook / outcome / number — not a truncation of the long title.
4. Don't reuse `--title` verbatim; the long title already goes into the description, duplicating it in the short-title box looks spammy on feed cards.
5. Style: short declarative phrase, optionally an emotional beat or a number, no trailing punctuation.

Good vs bad (long title "新手第一天跑步就坚持 5 公里是什么体验"):

- ✅ `"5公里新手挑战"` — 7 chars, no punctuation, keeps the hook (number + identity).
- ✅ `"第一天跑5公里"` — 8 chars.
- ❌ `"新手第一天跑步就坚持5公里是什么体验"` — 18 chars, exceeds hint, also redundant with title.
- ❌ `"第一天！跑5公里！"` — punctuation will be stripped to spaces, becoming `第一天  跑5公里 `.

When the user hands over only a long title and asks the agent to publish to 视频号, **auto-generate a short title** that satisfies the rules, and echo it back in the result summary so the user can audit.

### 标签写法规范

1. **最多 4 个话题**。这是 agent 生成 `--tags` 时的硬上限：不管用户给了多少候选，选出**最相关的 4 个**，多余的丢掉。少于 4 个 OK；不要为了凑数塞弱相关词。CLI 对 > 4 的输入会打 warn。
2. **视频号 / 抖音 / 快手 必须带 `#` 前缀**。这三个平台把 `--tags` 整串拼进描述末尾，不加 `#` 就只是普通尾缀文字，不成话题。典型写法：`"#减脂 #健身 #新手 #跑步"`（4 个，空格分隔，每个前置 `#`）。
3. **哔哩哔哩 / 小红书 可不带 `#`**。这俩走独立标签控件，`split(/\s+/)` 后剥前导 `#`；为清晰推荐不写 `#`，数量同样上限 4。
4. **百家号 / 头条 不消费 `--tags`**。不要为这两个平台耗费思考生成标签，写也被忽略。
5. **分隔符**：严格 ASCII 空格。`,` `，` `、` `;` `；` `|` 都会被 `split(/\s+/)` 视为标签字符一部分，CLI 会 warn。
6. **字符集**：中文 / 英文 / 数字；单个标签内部不要空格；哔哩哔哩控件会静默吞 emoji。
7. **避免跨字段重复**：不要把同一个词同时出现在 `--title` / `--bt2` / `--tags` 里，视频号 / 抖音 / 快手 上会在描述里重复三次，观感极差。

Good vs bad（视频号 / 抖音 / 快手）：

- ✅ `--tags "#减脂 #健身 #新手 #跑步"` — 4 个话题，都带 `#`，空格分隔
- ✅ `--tags "#跑步 #新手"` — 2 个话题也合法，相关性优先
- ❌ `--tags "#减脂 #健身 #新手 #跑步 #效率 #自律 #打卡"` — 7 个超出上限，agent 应裁到最相关 4 个
- ❌ `--tags "减脂 健身 新手 跑步"` — 没有 `#`，在这三个平台会变成描述的普通尾缀文字
- ❌ `--tags "#减脂,#健身,#跑步"` — 逗号分隔，会被当作一个整体串；用空格

Good vs bad（哔哩哔哩 / 小红书）：

- ✅ `--tags "游戏 解说 开黑"` — ≤ 4，无 `#` 更直观
- ✅ `--tags "#游戏 #解说 #开黑"` — 带 `#` 也 OK（会被剥离），不推荐

## Login Rules

- `cli login` **only implements Douyin** today. Do not attempt `cli login -p tt/ks/blbl/bjh/sph` — the parser rejects it.
- For non-Douyin platforms: instruct the user to log in once in the GUI; CLI automatically reuses the same `persist:<phone><platform>` session partition for `cli publish` / `cli accounts`.
- If a publish fails with login/session errors:
  - Douyin → run `cli login -p dy --phone <phone>` first, then retry publish.
  - Other platforms → ask the user to re-login in the GUI, then retry `cli publish`.
- On Linux headless/SSH, prefer `xvfb-run -a` for the Douyin login display pipeline.
- `cli accounts` is non-interactive — it only reads session cookies and never triggers login; use it to pick the right `--phone` / `--partition` before login or publish, and to diagnose expired cookies.

## Accounts Command

Inspect login state for every account the GUI already knows about:

```bash
matrixmedia cli accounts [options]
```

Key flags:
- `-p, --platform <id>`: filter by platform (`dy|tt|ks|blbl|bjh|sph`).
- `--phone <id>`: filter by full phone string stored in the account tree.
- `--logged-in` / `--logged-out`: keep only one side (mutually exclusive).
- `--json`: machine-readable output (objects with `phone/pt/partition/loggedIn/reason/expireAt/createdAt`).

Rules used per platform (cookie in the persist partition for that site):
- 抖音 → `passport_assist_user`
- 百家号 → `BDUSS`
- 头条 → `odin_tt` (value length > 65)
- 视频号 → `sessionid`
- 哔哩哔哩 → `SESSDATA`
- 快手 → `userId`

Expired cookies report `loggedIn: false` with reason `cookie 已过期`.

## History Command

Read the local publish log (`<Documents>/MatrixMedia/data/pushData/YYYY-MM-DD.json`):

```bash
matrixmedia cli history [options]
```

Key flags:
- `-p, --platform <id>`: platform filter.
- `--phone <id>`: phone filter.
- `-s, --status <s>`: `success | failed | publishing`（中文同义 `成功 | 失败 | 发布中`）。
- `-d, --days <n>`: look-back window (default 7).
- `--since <YYYY-MM-DD>` / `--until <YYYY-MM-DD>`: explicit range; overrides `--days`.
- `-n, --limit <n>`: cap rows (default 50, sorted by last publish time desc).
- `--json`: machine-readable output.

Record-status inference: prefer `publishStatus`; fall back to `publishSuccessCount > 0 → success`, `publishFailCount > 0 → failed`, otherwise `publishing`. Attempt column shows `successCount/attemptCount`, matching what GUI 视频管理 renders.

## Execution Policy For Agents

1. Run `cli <sub> --help` once when flags are uncertain (applies to publish/login/accounts/history).
2. Quote paths that may contain spaces.
3. Prefer absolute file paths for `--file`.
4. Before publishing, run `cli accounts -p <platform> --phone <phone>` (or `--logged-out` variant) to confirm the session is still valid — it avoids wasting a 35-minute publish timeout on an expired cookie.
5. After execution, inspect exit code:
   - `0`: success
   - `2`: argument error, fix arguments and rerun
   - `3`: task failure (often login/session/upload), recover then rerun
6. When debugging a failed publish, `cli history --phone <phone> -p <platform> -n 5` shows the most recent attempts and the `lastPublishMessage` that GUI displays.
7. Return a concise result summary: command intent, key args, outcome, next action.

## Output Template

Use this response structure after command execution:

```markdown
执行结果：
- 命令：`cli publish ...`
- 参数：平台/账号/文件/标题
- 退出码：0|2|3
- 结论：成功 或 失败原因
- 下一步：是否需要先 `cli login` 或调整参数重试
```

## Additional Reference

- CLI overview: `docs/cli.md`
- Repository quick intro and OpenClaw marker: `README.md`
