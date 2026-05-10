import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';

export const loginDouyinTool: Tool = {
  name: 'login_douyin',
  description:
    'Login to Douyin (抖音) via QR code scan. ONLY supports Douyin -- other platforms (Kuaishou, ' +
    'Bilibili, Baijiahao, Toutiao, Shipinhao) require GUI login. Requires a desktop environment ' +
    '(macOS or Windows with display). A browser window will open for QR code scanning.',
  inputSchema: {
    type: 'object',
    properties: {
      phone: {
        type: 'string',
        description: 'Phone number, used as partition identifier.',
      },
      partition: {
        type: 'string',
        description: 'Custom partition override.',
      },
      show: {
        type: 'boolean',
        description: 'Whether to show the browser window. Default true.',
      },
    },
    required: ['phone'],
  },
};

export async function handleLoginDouyin(
  args: Record<string, unknown>
): Promise<string> {
  const phone = args.phone;
  const partition = args.partition;
  const show = args.show;

  if (typeof phone !== 'string' || phone.length === 0) {
    throw new Error('phone must be non-empty string');
  }

  const cliArgs: string[] = [
    'login',
    '-p',
    'dy',
    '--phone',
    phone,
    ...(partition ? ['--partition', String(partition)] : []),
    ...(show !== false ? ['--show'] : []),
  ];

  const result = await runCli(cliArgs);

  if (result.exitCode === 0) {
    return '抖音登录成功';
  }

  throw new Error('登录失败: ' + result.stderr.slice(0, 300));
}
