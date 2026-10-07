import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';

const PLATFORM_ENUM = ['dy', 'sph', 'blbl', 'bjh', 'tt', 'ks', 'xhs'] as const;

function fmt(result: { exitCode: number; lastJson: unknown; stderr: string }): string {
  if (result.lastJson) return JSON.stringify(result.lastJson, null, 2);
  return result.stderr || `exit code ${result.exitCode}`;
}

/* ---------------- 1. 获取账号粉丝数据（本地快照） ---------------- */

export const getAccountStatsTool: Tool = {
  name: 'get_account_stats',
  description:
    'Read MatrixMedia account stats (fans/plays/likes/comments/favorites) from the local snapshot. ' +
    'Call sync_account_stats first if no data has been collected yet.',
  inputSchema: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Account group name (媒体平台管理中的分组名)' },
      platform: { type: 'string', enum: PLATFORM_ENUM, description: 'Platform code' },
    },
    required: ['phone', 'platform'],
  },
};

export async function handleGetAccountStats(args: Record<string, unknown>): Promise<string> {
  const r = await runCli([
    'stats',
    '-p', String(args.platform ?? ''),
    '--phone', String(args.phone ?? ''),
  ]);
  return fmt(r);
}

/* ---------------- 2. 主动采集更新 ---------------- */

export const syncAccountStatsTool: Tool = {
  name: 'sync_account_stats',
  description:
    'Collect the latest stats of one MatrixMedia account (group × platform) from the platform ' +
    'using its logged-in session, and persist to the local snapshot. Requires the account to be logged in the GUI.',
  inputSchema: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Account group name' },
      platform: { type: 'string', enum: PLATFORM_ENUM, description: 'Platform code' },
    },
    required: ['phone', 'platform'],
  },
};

export async function handleSyncAccountStats(args: Record<string, unknown>): Promise<string> {
  const r = await runCli([
    'stats-sync',
    '-p', String(args.platform ?? ''),
    '--phone', String(args.phone ?? ''),
  ]);
  return fmt(r);
}

/* ---------------- 3. 按标题查视频发布数据 ---------------- */

export const getWorkStatsTool: Tool = {
  name: 'get_work_stats',
  description:
    'Query publish stats of one video by exact title from the local snapshot ' +
    '(play/like/comment/share/favorite/fansDelta/publishTime). Data comes from the last sync_account_stats run.',
  inputSchema: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Account group name' },
      platform: { type: 'string', enum: PLATFORM_ENUM, description: 'Platform code' },
      title: { type: 'string', description: 'Full video title (exact match)' },
    },
    required: ['phone', 'platform', 'title'],
  },
};

export async function handleGetWorkStats(args: Record<string, unknown>): Promise<string> {
  const r = await runCli([
    'stats-work',
    '-p', String(args.platform ?? ''),
    '--phone', String(args.phone ?? ''),
    '--title', String(args.title ?? ''),
  ]);
  return fmt(r);
}
