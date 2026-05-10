import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';

export const listAccountsTool: Tool = {
  name: 'list_accounts',
  description:
    'List MatrixMedia locally logged-in accounts. Returns JSON array with phone/platform/partition fields.',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: ['dy', 'ks', 'blbl', 'bjh', 'tt', 'sph', 'xhs'],
        description:
          'Optional platform filter. dy=Douyin ks=Kuaishou blbl=Bilibili bjh=Baijiahao tt=Toutiao sph=Shipinhao xhs=Xiaohongshu',
      },
    },
    required: [],
  },
};

export async function handleListAccounts(
  args: Record<string, unknown>
): Promise<string> {
  const platform = args.platform;
  const cliArgs: string[] = [
    'accounts',
    '--json',
    ...(platform !== undefined && platform !== null
      ? ['-p', String(platform)]
      : []),
  ];

  const result = await runCli(cliArgs);
  if (result.exitCode === 0) {
    return JSON.stringify(result.lastJson ?? result.jsonLines);
  }
  throw new Error(
    'list_accounts failed (exit ' + String(result.exitCode) + '): ' + result.stderr
  );
}
