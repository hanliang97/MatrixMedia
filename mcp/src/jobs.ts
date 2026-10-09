import { randomUUID } from 'node:crypto';

/**
 * In-process registry for long-running publish jobs.
 *
 * WorkBuddy (and most MCP hosts) expect a tool call to answer within ~30s, but uploading a
 * video can take tens of minutes. Publish tools therefore start a job, wait briefly, and
 * return a jobId if it is still running; the agent polls get_publish_status.
 */

export type JobStatus = 'running' | 'succeeded' | 'failed';

export interface Job {
  id: string;
  kind: string;
  summary: Record<string, unknown>;
  dedupeKey: string;
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  result: unknown;
  error: string | null;
  done: Promise<void>;
}

/** Max time a tool call blocks before handing back a jobId. Keep well under the 30s budget. */
export function inlineWaitMs(): number {
  const v = Number(process.env.MATRIXMEDIA_INLINE_WAIT_MS);
  return Number.isFinite(v) && v >= 0 ? v : 20000;
}
export const MAX_STATUS_WAIT_MS = 25000;
const MAX_FINISHED_JOBS = 200;

const jobs = new Map<string, Job>();

function parseResult(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function pruneFinished(): void {
  const finished = [...jobs.values()].filter(j => j.status !== 'running');
  const excess = finished.length - MAX_FINISHED_JOBS;
  if (excess <= 0) return;
  finished
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    .slice(0, excess)
    .forEach(j => jobs.delete(j.id));
}

/**
 * Start a job. If an identical job (same dedupeKey) is still running, return it instead of
 * starting a second upload of the same video — agents sometimes retry on perceived slowness.
 */
export function startJob(
  kind: string,
  dedupeKey: string,
  summary: Record<string, unknown>,
  run: () => Promise<string>
): { job: Job; reused: boolean } {
  for (const existing of jobs.values()) {
    if (existing.status === 'running' && existing.dedupeKey === dedupeKey) {
      return { job: existing, reused: true };
    }
  }

  const job: Job = {
    id: randomUUID(),
    kind,
    summary,
    dedupeKey,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
    done: Promise.resolve(),
  };

  job.done = run()
    .then(
      raw => {
        job.status = 'succeeded';
        job.result = parseResult(raw);
      },
      err => {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
      }
    )
    .finally(() => {
      job.finishedAt = Date.now();
      pruneFinished();
    });

  jobs.set(job.id, job);
  return { job, reused: false };
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Resolve when the job finishes or after `ms`, whichever comes first. */
export async function waitForJob(job: Job, ms: number): Promise<void> {
  if (job.status !== 'running' || ms <= 0) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    job.done,
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Shape returned to the agent for any job state. */
export function describeJob(job: Job, extra?: Record<string, unknown>): Record<string, unknown> {
  const elapsedSeconds = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  const base = { jobId: job.id, kind: job.kind, ...job.summary, elapsedSeconds, ...extra };
  if (job.status === 'running') {
    return {
      ...base,
      status: 'running',
      message:
        '任务仍在后台执行（上传视频通常需要数分钟）。请稍后调用 get_publish_status 查询结果，不要重新发起发布。',
    };
  }
  if (job.status === 'failed') {
    return { ...base, status: 'failed', error: job.error };
  }
  const result = (job.result ?? {}) as Record<string, unknown>;
  return { ...base, ...result, status: (result.status as string) ?? 'success' };
}
