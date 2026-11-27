import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handlePublishVideo, publishVideoTool } from '../dist/tools/publish.js';
import { listHistoryTool } from '../dist/tools/history.js';

// 只测试 MCP -> CLI 参数/回执契约；不把这个替身当成真实平台排期证据。
async function withCliReceipt(receipt, exitCode, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mm-native-contract-'));
  const script = path.join(dir, 'fixture.cjs');
  const argvFile = path.join(dir, 'argv.json');
  const previous = process.env.MATRIXMEDIA_BIN;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  try {
    await writeFile(script, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));
console.log(${JSON.stringify(JSON.stringify(receipt))});
process.exit(${exitCode});
`);
    // 使用原生可执行文件，避免 Unix shebang 测试夹具在 Windows 上 ENOENT。
    process.env.MATRIXMEDIA_BIN = process.execPath;
    process.env.NODE_OPTIONS = [previousNodeOptions,
      `--require="${script.replace(/\\/g, '/')}"`].filter(Boolean).join(' ');
    await run(async () => JSON.parse(await readFile(argvFile, 'utf8')));
  } finally {
    if (previous === undefined) delete process.env.MATRIXMEDIA_BIN;
    else process.env.MATRIXMEDIA_BIN = previous;
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    await rm(dir, { recursive: true, force: true });
  }
}

const args = {
  platform: 'dy', phone: 'test-account', file: '/test/video.mp4',
  title: 'native schedule contract', publishAt: '2090-01-02 13:45:00',
  preferNativeSchedule: true,
};

test('native schedule is exposed in publish and history schemas', () => {
  assert.equal(publishVideoTool.inputSchema.properties.preferNativeSchedule.type, 'boolean');
  assert.ok(listHistoryTool.inputSchema.properties.status.enum.includes('native_scheduled'));
});

for (const platform of ['dy', 'sph']) {
  test(`MCP forwards native scheduling for ${platform} and preserves the confirmed receipt`, async () => {
    await withCliReceipt({
      resultStatus: 'native_scheduled', nativeScheduled: true,
      nativeScheduleVerified: true, publishAt: args.publishAt, message: '平台已排期',
    }, 0, async readArgs => {
      const result = JSON.parse(await handlePublishVideo({ ...args, platform }));
      assert.equal(result.status, 'native_scheduled');
      assert.equal(result.nativeScheduled, true);
      assert.equal(result.nativeScheduleVerified, true);
      assert.equal(result.publishAt, args.publishAt);
      const argv = await readArgs();
      assert.equal(argv[argv.indexOf('-p') + 1], platform);
      assert.ok(argv.includes('--prefer-native-schedule'));
      assert.equal(argv[argv.indexOf('--publish-at') + 1], args.publishAt);
      assert.equal(argv[argv.indexOf('-t') + 1], args.title);
      assert.ok(!argv.includes('--draft'));
    });
  });
}

test('unconfirmed native receipt stays needs_attention and is not called a draft', async () => {
  await withCliReceipt({
    resultStatus: 'needs_attention', publishMode: 'publish',
    nativeScheduleVerified: false, publishAt: args.publishAt,
    outcome: 'native_schedule_unverified', message: '请到平台后台核对',
  }, 4, async () => {
    const result = JSON.parse(await handlePublishVideo(args));
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.nativeScheduleVerified, false);
    assert.equal(result.publishMode, 'publish');
    assert.equal(result.outcome, 'native_schedule_unverified');
    assert.equal(result.needsAttention, true);
  });
});

test('local scheduling still omits the native flag', async () => {
  await withCliReceipt({ scheduled: true, publishAt: args.publishAt, message: '等待定时发布' }, 0,
    async readArgs => {
      const result = JSON.parse(await handlePublishVideo({ ...args, preferNativeSchedule: false }));
      assert.equal(result.status, 'scheduled');
      assert.ok(!(await readArgs()).includes('--prefer-native-schedule'));
    });
});
