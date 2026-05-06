# Changelog

All notable changes to MatrixMedia are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.5.4] - 2026-05-06

### Added
- `verify-cli.sh` — automated CLI contract verification script.
  Tests exit codes (0 success / 2 arg-error / 3 business-failure) and
  `--json` output purity for `cli accounts` and `cli history`.
  22 assertions across 5 sections; env-dependent cases are SKIP'd, not FAIL'd.
  Run: `bash verify-cli.sh [--verbose]`

### Fixed
- `.gitignore`: added `.claude/` to prevent accidental commit of IDE internals.

### Build
- `dist/electron/main.js` rebuilt from current source (`yarn build:dir`).

---

## [0.5.3] - 2026-05-05

### Added
- `cli accounts` — list all accounts and probe real-time cookie login status.
- `cli history` — read `pushData` publish history; supports platform / phone / status / date filters.
- `cli accounts --json` / `cli history --json` — machine-readable JSON stdout for AI agent pipelines.
- `CLI_SKILLS.md` — pointer to `.cursor/skills/matrixmedia-cli-publish/SKILL.md`.
- `scripts/gen-release-notes.js` — helper for generating release notes.
- `scripts/test-scheduled-publish.js` — smoke test for the scheduled-publish flow.
- Exit code contract: `0` success / `1` unexpected error / `2` arg error / `3` business failure.

### Changed
- README: documented CLI exit codes, `--json` flags, AI agent integration guide.
- README: added macOS PATH setup instructions (`sudo ln -sf ...`).

---

## [0.5.2] - 2026-04-xx

### Added
- Scheduled publish (`--publish-at "YYYY-MM-DD HH:mm:ss"`) via `cli publish`.
- `createScheduledRecord` / `startScheduledPublishScheduler` — scheduled task engine.

---

## [0.5.1] - 2026-04-xx

### Added
- `cli login` for Douyin: terminal QR code + Puppeteer headless mode.
- `cli publish` for all 6 platforms via Electron session partitions.

---

## [0.5.0] - 2026-03-xx

### Added
- Initial CLI entry point (`argv` containing `cli` triggers headless mode).
- `detect Argv` / `parsePublishArgs` / `parseLoginArgs` parsers.

---

## [0.4.x] - 2026-03-xx

- GUI-only releases: batch video publishing, account management, platform support.

---

## [0.3.x] - 2026-03-xx

- Early releases: Douyin, Kuaishou, Bilibili, Baidu Baijiahao, Toutiao, WeChat Channel.
