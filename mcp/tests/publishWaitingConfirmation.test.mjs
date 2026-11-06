import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handlePublishVideo } from '../dist/tools/publish.js';
import { listHistoryTool } from '../dist/tools/history.js';

test('waiting confirmation preserves the publish intent and original outcome through MCP', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mm-waiting-mcp-'));
  const bin = path.join(dir, 'matrixmedia');
  const previous = process.env.MATRIXMEDIA_BIN;
  const receipt = { channel: 'puppeteerFile-done', resultStatus: 'needs_attention',
    publishMode: 'publish', outcome: 'waiting_confirmation', needsAttention: true,
    message: '请在平台完成安全确认，不要重新上传' };
  await writeFile(bin, '#!/usr/bin/env node\nconsole.log(' + JSON.stringify(JSON.stringify(receipt)) + ');process.exit(4);\n');
  await chmod(bin, 0o755);
  process.env.MATRIXMEDIA_BIN = bin;
  try {
    const result = JSON.parse(await handlePublishVideo({ platform: 'dy', phone: 'test', file: '/tmp/synthetic.mp4', title: '等待确认' }));
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.publishMode, 'publish', '等待安全确认不能伪造为已转存草稿');
    assert.equal(result.outcome, 'waiting_confirmation');
    assert.equal(result.needsAttention, true);
    assert.equal(result.message, receipt.message);
    assert.ok(listHistoryTool.inputSchema.properties.status.enum.includes('waiting_confirmation'));
  } finally {
    if (previous === undefined) delete process.env.MATRIXMEDIA_BIN;
    else process.env.MATRIXMEDIA_BIN = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
