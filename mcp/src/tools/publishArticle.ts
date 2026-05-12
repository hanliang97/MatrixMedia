import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';

export function derivePartition(phone: string): string {
  return `persist:${phone}掘金`;
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getCliMessage(result: { lastJson: unknown; stderr: string }, fallback: string): string {
  const lastJson = result.lastJson;
  if (lastJson !== null && typeof lastJson === 'object') {
    const message = (lastJson as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  const stderr = result.stderr.trim();
  return stderr.length > 0 ? stderr.slice(0, 300) : fallback;
}

export const publishArticleTool: Tool = {
  name: 'publish_article',
  description: '发布掘金文章，需要已登录掘金账号。账号会通过 phone 自动推导 session partition。',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: ['juejin'],
        description: '目标平台，目前仅支持 juejin。',
      },
      phone: {
        type: 'string',
        description: '已登录掘金账号的手机号，用于推导 session partition。',
      },
      title: {
        type: 'string',
        description: '文章标题。',
      },
      content: {
        type: 'string',
        description: '文章正文内容。content 和 file 至少提供一个。',
      },
      file: {
        type: 'string',
        description: '文章 Markdown 文件路径。content 和 file 至少提供一个。',
      },
      cover: {
        type: 'string',
        description: '可选本地封面图片路径。',
      },
      category: {
        type: 'string',
        description: '可选文章分类。',
      },
      tags: {
        type: 'string',
        description: '可选标签字符串。',
      },
      summary: {
        type: 'string',
        description: '可选文章摘要。',
      },
      publishAt: {
        type: 'string',
        description: '可选定时发布时间，格式由 CLI 校验。',
      },
      show: {
        type: 'boolean',
        description: '如果为 true，显示底层浏览器窗口。',
      },
    },
    required: ['platform', 'phone', 'title'],
  },
};

export async function handlePublishArticle(args: Record<string, unknown>): Promise<string> {
  if (args.platform !== 'juejin') {
    throw new Error('platform must be juejin');
  }

  const phone = getNonEmptyString(args.phone);
  if (phone === null) {
    throw new Error('phone must be non-empty string');
  }

  const title = getNonEmptyString(args.title);
  if (title === null) {
    throw new Error('title must be non-empty string');
  }

  const content = getNonEmptyString(args.content);
  const file = getNonEmptyString(args.file);
  if (content === null && file === null) {
    throw new Error('content or file must be non-empty string');
  }

  const cover = getNonEmptyString(args.cover);
  const category = getNonEmptyString(args.category);
  const tags = getNonEmptyString(args.tags);
  const summary = getNonEmptyString(args.summary);
  const publishAt = getNonEmptyString(args.publishAt);

  const cliArgs: string[] = [
    'publish-article',
    '-p',
    'juejin',
    '-t',
    title,
    '--partition',
    derivePartition(phone),
    ...(content !== null ? ['--content', content] : []),
    ...(file !== null ? ['--file', file] : []),
    ...(cover !== null ? ['--cover', cover] : []),
    ...(category !== null ? ['--category', category] : []),
    ...(tags !== null ? ['--tags', tags] : []),
    ...(summary !== null ? ['--summary', summary] : []),
    ...(publishAt !== null ? ['--publish-at', publishAt] : []),
    ...(args.show === true ? ['--show'] : []),
  ];

  const result = await runCli(cliArgs);

  if (result.exitCode === 0) {
    const lastJson = result.lastJson;
    if (
      lastJson !== null &&
      typeof lastJson === 'object' &&
      (lastJson as { scheduled?: unknown }).scheduled === true
    ) {
      return JSON.stringify({
        status: 'scheduled',
        id: (lastJson as { id?: unknown }).id ?? null,
        publishAt: (lastJson as { publishAt?: unknown }).publishAt ?? null,
        message: (lastJson as { message?: unknown }).message ?? '定时文章发布任务已创建',
      });
    }
    return JSON.stringify({
      status: 'success',
      message: getCliMessage(result, '文章发布成功'),
    });
  }

  if (result.exitCode === 3) {
    throw new Error(getCliMessage(result, '发布失败'));
  }

  if (result.exitCode === 2) {
    throw new Error('参数错误: ' + getCliMessage(result, '参数错误'));
  }

  throw new Error('发布超时或失败: ' + getCliMessage(result, '发布超时或失败'));
}
