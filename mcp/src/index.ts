import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listAccountsTool, handleListAccounts } from './tools/accounts.js';
import { listHistoryTool, handleListHistory } from './tools/history.js';
import { publishVideoTool, handlePublishVideo } from './tools/publish.js';

const server = new Server(
  { name: 'matrixmedia', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [listAccountsTool, listHistoryTool, publishVideoTool] };
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
      case 'publish_video': {
        const progressToken = (request.params as any)._meta?.progressToken as string | undefined;
        result = await handlePublishVideo(args,
          progressToken
            ? (elapsed: number) => {
                server.notification({
                  method: 'notifications/progress',
                  params: { progressToken, progress: Math.floor(elapsed / 1000), total: 2100 },
                });
              }
            : undefined
        );
        break;
      }
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

const transport = new StdioServerTransport();
await server.connect(transport);
