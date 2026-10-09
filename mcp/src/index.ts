#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listAccountsTool, handleListAccounts } from './tools/accounts.js';
import { listHistoryTool, handleListHistory } from './tools/history.js';
import { publishArticleTool, handlePublishArticle } from './tools/publishArticle.js';
import { publishVideoTool, handlePublishVideo } from './tools/publish.js';
import { getPublishStatusTool, handleGetPublishStatus } from './tools/publishStatus.js';
import { describeJob, inlineWaitMs, startJob, waitForJob } from './jobs.js';
import {
  getAccountStatsTool,
  handleGetAccountStats,
  syncAccountStatsTool,
  handleSyncAccountStats,
  getWorkStatsTool,
  handleGetWorkStats,
} from './tools/stats.js';

const server = new Server(
  { name: 'matrixmedia', version: '0.3.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      listAccountsTool,
      listHistoryTool,
      publishVideoTool,
      publishArticleTool,
      getPublishStatusTool,
      getAccountStatsTool,
      syncAccountStatsTool,
      getWorkStatsTool,
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args: Record<string, unknown> = request.params.arguments ?? {};
  try {
    let result: string;
    switch (name) {
      case 'list_accounts':
        result = await handleListAccounts(args);
        break;
      case 'list_history':
        result = await handleListHistory(args);
        break;
      case 'publish_video':
        result = await runAsJob(
          'publish_video',
          args,
          { platform: args.platform, phone: args.phone, title: args.title, file: args.file },
          () => handlePublishVideo(args)
        );
        break;
      case 'publish_article':
        result = await runAsJob(
          'publish_article',
          args,
          { platform: args.platform, phone: args.phone, title: args.title },
          () => handlePublishArticle(args)
        );
        break;
      case 'get_publish_status':
        result = await handleGetPublishStatus(args);
        break;
      case 'get_account_stats':
        result = await handleGetAccountStats(args);
        break;
      case 'sync_account_stats':
        result = await handleSyncAccountStats(args);
        break;
      case 'get_work_stats':
        result = await handleGetWorkStats(args);
        break;
      default:
        throw new Error('Unknown tool: ' + name);
    }
    return { content: [{ type: 'text', text: result }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
});

/**
 * Long-running publishes run in the background. The call waits up to INLINE_WAIT_MS; if the job
 * finished by then the final result is returned directly (preserving error semantics), otherwise
 * a jobId is returned for get_publish_status.
 */
async function runAsJob(
  kind: string,
  args: Record<string, unknown>,
  summary: Record<string, unknown>,
  run: () => Promise<string>
): Promise<string> {
  const { job, reused } = startJob(kind, kind + ':' + JSON.stringify(args), summary, run);
  await waitForJob(job, inlineWaitMs());
  if (job.status === 'failed') {
    throw new Error(job.error ?? '发布失败');
  }
  return JSON.stringify(
    describeJob(job, reused ? { reused: true, note: '相同参数的发布任务已在执行，未重复发起。' } : undefined)
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
