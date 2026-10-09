import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MAX_STATUS_WAIT_MS, describeJob, getJob, waitForJob } from '../jobs.js';

export const getPublishStatusTool: Tool = {
  name: 'get_publish_status',
  description:
    '查询 publish_video / publish_article 返回的后台任务状态。status 为 running 时稍后再查；' +
    'succeeded 后返回发布结果（success / scheduled / needs_attention），failed 时返回错误原因。' +
    '默认最多等待 20 秒再返回，可减少轮询次数。',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'publish_video / publish_article 返回的 jobId。',
      },
      waitSeconds: {
        type: 'number',
        description: '任务未完成时最多等待的秒数，默认 20，最大 25；传 0 立即返回。',
      },
    },
    required: ['jobId'],
  },
};

export async function handleGetPublishStatus(args: Record<string, unknown>): Promise<string> {
  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
  if (!jobId) {
    throw new Error('jobId must be non-empty string');
  }
  const job = getJob(jobId);
  if (!job) {
    throw new Error(
      '未找到该任务（可能是连接器重启后任务记录已丢失）。请调用 list_history 查看最近的发布记录确认结果，不要直接重新发布。'
    );
  }
  const requested = typeof args.waitSeconds === 'number' ? args.waitSeconds * 1000 : 20000;
  const waitMs = Math.max(0, Math.min(requested, MAX_STATUS_WAIT_MS));
  await waitForJob(job, waitMs);
  return JSON.stringify(describeJob(job));
}
