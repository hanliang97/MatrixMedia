# Scheduled Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-time scheduled publishing for GUI and CLI, with every scheduled task represented in publish history.

**Architecture:** Extract reusable main-process helpers for scheduled time parsing, record creation, and task execution. GUI and CLI write complete `pushData` records with `publishStatus: "scheduled"`; a main-process scheduler scans those records on app startup and executes or expires them.

**Tech Stack:** Electron main process, Vue 2 + Element UI renderer, existing `changeData` / `dataRequest` data layer, existing `runPuppeteerTask` publish queue, Node-based helper tests.

---

### Task 1: Scheduler Helper Tests

**Files:**
- Create: `scripts/test-scheduled-publish.js`
- Create: `src/main/services/scheduledPublish.js`

- [ ] **Step 1: Write failing tests**

Create `scripts/test-scheduled-publish.js` that imports helper functions from `src/main/services/scheduledPublish.js` and asserts:

- `parsePublishAt("2026-05-05 20:30:00")` returns a valid timestamp.
- invalid time strings return an error object.
- past CLI times are rejected.
- `createScheduledRecord()` stores full publish data and `publishStatus: "scheduled"`.
- `isExpiredScheduledRecord()` identifies old scheduled records.

- [ ] **Step 2: Run test and verify RED**

Run: `node scripts/test-scheduled-publish.js`

Expected: fails because `src/main/services/scheduledPublish.js` does not exist yet.

### Task 2: Main Scheduler Service

**Files:**
- Modify: `src/main/services/scheduledPublish.js`
- Modify: `src/main/index.js`

- [ ] **Step 1: Implement pure helpers**

Add:

- `parsePublishAt(value, nowMs)`
- `createScheduledRecord(recordItem, publishAtText, nowMs)`
- `isExpiredScheduledRecord(record, nowMs)`
- `buildTaskPayloadFromRecord(record)`

- [ ] **Step 2: Run helper tests and verify GREEN**

Run: `node scripts/test-scheduled-publish.js`

Expected: all assertions pass.

- [ ] **Step 3: Implement runtime scheduler**

Add:

- `startScheduledPublishScheduler()`
- `schedulePublishRecord(record)`
- scan `pushData` date files on startup
- mark overdue scheduled records as `expired`
- execute due tasks with `runPuppeteerTask`

- [ ] **Step 4: Wire startup**

Call `startScheduledPublishScheduler()` in `src/main/index.js` after Electron is ready for normal GUI mode.

### Task 3: CLI `--publish-at`

**Files:**
- Modify: `src/main/cli/parsePublishArgs.js`
- Modify: `src/main/cli/index.js`
- Modify: `docs/cli.md`
- Modify: `CLI_SKILLS.md`
- Modify: `.cursor/skills/matrixmedia-cli-publish/SKILL.md`

- [ ] **Step 1: Add parser test case**

Extend `scripts/test-scheduled-publish.js` to cover `parsePublishArgs(["-p", "dy", "--phone", "13800138000", "-f", "./v.mp4", "-t", "标题", "--publish-at", "2026-05-05 20:30:00"])`.

- [ ] **Step 2: Run test and verify RED**

Run: `node scripts/test-scheduled-publish.js`

Expected: fails because parser does not expose `publishAt`.

- [ ] **Step 3: Parse and document `--publish-at`**

Add `publishAt` to parsed publish args and help text.

- [ ] **Step 4: Make CLI create scheduled records**

When `publishAt` exists, validate future time, write a complete scheduled `pushData` record, notify the running scheduler if possible, print JSON summary, and exit `0` without running puppeteer immediately.

### Task 4: GUI Scheduled Publish

**Files:**
- Modify: `src/renderer/components/LocalVideoPublish.vue`
- Modify: `src/main/services/puppeteerFile.js` or scheduler IPC module if needed
- Modify: `src/main/services/ipcMain.js` if a new IPC registration is needed

- [ ] **Step 1: Add scheduled publish fields**

Add an Element UI switch / datetime picker in `LocalVideoPublish.vue` for immediate vs scheduled publish.

- [ ] **Step 2: Write scheduled records from GUI**

When scheduled mode is enabled, write full history records with `publishStatus: "scheduled"` and send an IPC message to refresh scheduler registration. Do not call `puppeteerFile` immediately.

- [ ] **Step 3: Keep immediate publish unchanged**

Verify existing immediate publish still sends `puppeteerFile` and writes `publishing` records.

### Task 5: History Status and Republish

**Files:**
- Modify: `src/renderer/views/videoManager/index.vue`
- Modify: `src/main/cli/runHistoryCli.js`
- Modify: `src/main/cli/parseHistoryArgs.js` if status filtering needs aliases

- [ ] **Step 1: Display new states**

Render `scheduled` as `等待定时发布` and `expired` as `任务过期`.

- [ ] **Step 2: Allow republish**

Ensure expired records use the same republish action as failed records.

- [ ] **Step 3: Update CLI history**

Make `cli history` understand `scheduled` and `expired` status filters and summaries.

### Task 6: Verification

**Files:**
- Verify touched files only.

- [ ] **Step 1: Run helper tests**

Run: `node scripts/test-scheduled-publish.js`

Expected: all tests pass.

- [ ] **Step 2: Run lints for edited files**

Use IDE lints on edited files and fix introduced issues.

- [ ] **Step 3: Manual smoke commands**

Run:

- `ELECTRON_RUN_AS_NODE= electron . cli publish --help`
- `ELECTRON_RUN_AS_NODE= electron . cli publish -p dy --phone 13800138000 -f ./missing.mp4 -t "标题" --publish-at "2099-01-01 00:00:00"`

Expected: help includes `--publish-at`; scheduled command creates a history record without starting upload.
