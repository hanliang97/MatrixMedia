import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runCli } from '../runner.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const COMMENTS_PLATFORM_ENUM = ['dy', 'ks', 'sph'] as const;

function fmt(result: { exitCode: number; lastJson: unknown; stderr: string }): string {
  if (result.lastJson) return JSON.stringify(result.lastJson, null, 2);
  return result.stderr || `exit code ${result.exitCode}`;
}

/* ---------------- 1. 拉取评论列表（只读） ---------------- */

export const listCommentsTool: Tool = {
  name: 'list_comments',
  description:
    'List comments on published works of one MatrixMedia account (group × platform: dy/ks/sph), ' +
    'using its logged-in session. Read-only. Returns normalized JSON: ' +
    '{workId, workTitle, commentId, content, nickname, createTime, likeCount, replied, ...}.',
  inputSchema: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Account group name (媒体平台管理中的分组名)' },
      platform: { type: 'string', enum: COMMENTS_PLATFORM_ENUM, description: 'dy=抖音 ks=快手 sph=视频号' },
      limit: { type: 'number', description: 'Max comments to return (default 200)' },
      work: { type: 'string', description: 'Optional filter: work title (substring) or workId' },
    },
    required: ['phone', 'platform'],
  },
};

export async function handleListComments(args: Record<string, unknown>): Promise<string> {
  const cliArgs = [
    'comments',
    '-p', String(args.platform ?? ''),
    '--phone', String(args.phone ?? ''),
  ];
  if (args.limit != null) cliArgs.push('--limit', String(args.limit));
  if (args.work) cliArgs.push('--work', String(args.work));
  const r = await runCli(cliArgs);
  return fmt(r);
}

/* ---------------- 2. 回复评论（写操作，confirm 门控） ---------------- */

export const replyCommentTool: Tool = {
  name: 'reply_comment',
  description:
    'Reply to a comment (or post a top-level comment when comment_id is omitted) on dy/ks/sph. ' +
    'WRITE OPERATION — publishes public content under the account. ' +
    'Default confirm=false runs a DRY-RUN (validates target existence, publishes nothing). ' +
    'Set confirm=true ONLY after the human user explicitly approved this exact reply text. ' +
    'Every call (dry or real) is recorded to the local reply ledger (reply-log.jsonl). ' +
    'dy/ks locate the target comment by match_content (original comment text); ' +
    'sph uses comment_id + work_id/work_title.',
  inputSchema: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Account group name' },
      platform: { type: 'string', enum: COMMENTS_PLATFORM_ENUM, description: 'dy=抖音 ks=快手 sph=视频号' },
      content: { type: 'string', description: 'Reply text to publish' },
      comment_id: { type: 'string', description: 'Target comment id (omit = top-level comment on the work)' },
      work_id: { type: 'string', description: 'Work id (sph: objectId/exportId; dy: aweme_id; ks: photoId)' },
      work_title: { type: 'string', description: 'Work title substring (sph resolves work by title when work_id absent)' },
      match_content: { type: 'string', description: 'dy/ks required: original comment text for DOM matching' },
      root_comment_id: { type: 'string', description: 'sph optional: root comment id when replying inside a thread' },
      confirm: { type: 'boolean', description: 'false (default) = dry-run; true = actually publish (human approval required)' },
    },
    required: ['phone', 'platform', 'content'],
  },
};

export async function handleReplyComment(args: Record<string, unknown>): Promise<string> {
  const entry: Record<string, string> = { content: String(args.content ?? '') };
  if (args.comment_id) entry.commentId = String(args.comment_id);
  if (args.work_id) entry.workId = String(args.work_id);
  if (args.work_title) entry.workTitle = String(args.work_title);
  if (args.match_content) entry.matchContent = String(args.match_content);
  if (args.root_comment_id) entry.rootCommentId = String(args.root_comment_id);

  // 不可预测的私有临时目录（mkdtemp），replies.json 写在目录内，用完整目录删除
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-reply-'));
  try {
    const file = path.join(dir, 'replies.json');
    writeFileSync(file, JSON.stringify({ replies: [entry] }), 'utf8');
    const cliArgs = [
      'comments-reply',
      '-p', String(args.platform ?? ''),
      '--phone', String(args.phone ?? ''),
      '--file', file,
    ];
    if (args.confirm === true) cliArgs.push('--execute', '--max', '1');
    const r = await runCli(cliArgs);
    return fmt(r);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
