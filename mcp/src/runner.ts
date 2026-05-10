import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CliResult {
  exitCode: number;
  jsonLines: unknown[];
  stderr: string;
  lastJson: unknown | null;
}

const VERSION_NOISE = /^\d+\.\d+\.\d+/;
const DEVTOOLS_NOISE = /^DevTools listening/;
const TIMEOUT_MS = 2400000;

export interface RunCliOptions {
  onProgress?: (elapsed: number) => void;
  progressIntervalMs?: number; // default 30000
}

export async function runCli(args: string[], opts?: RunCliOptions): Promise<CliResult> {
  // Resolve project dir: env var takes priority, then infer from this file's location
  // mcp/src/runner.ts -> mcp/ -> project root
  const defaultDir = path.resolve(
    fileURLToPath(import.meta.url),
    '..', '..', '..'
  );
  const dir = process.env.MATRIXMEDIA_DIR ?? defaultDir;

  let command: string;
  let spawnArgs: string[];
  const env: NodeJS.ProcessEnv = { ...process.env };

  let installed = false;
  try {
    execSync('which matrixmedia', { stdio: 'pipe' });
    installed = true;
  } catch {
    installed = false;
  }

  if (installed) {
    command = 'matrixmedia';
    spawnArgs = ['cli', ...args];
  } else {
    command = path.join(dir, 'node_modules/.bin/electron');
    spawnArgs = ['.', 'cli', ...args];
    env.ELECTRON_RUN_AS_NODE = '';
  }

  return new Promise<CliResult>((resolve) => {
    const child = spawn(command, spawnArgs, {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const startTime = Date.now();
    const interval = opts?.onProgress
      ? setInterval(() => {
          opts.onProgress!(Date.now() - startTime);
        }, opts.progressIntervalMs ?? 30000)
      : null;

    const jsonLines: unknown[] = [];
    let lastJson: unknown | null = null;
    let stdoutRaw = '';   // full stdout accumulated for multi-line JSON
    let stdoutBuf = '';   // line buffer for single-line JSON (publish progress)
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      if (interval) clearInterval(interval);
      resolve({ exitCode: 1, jsonLines, stderr, lastJson });
    }, TIMEOUT_MS);

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      if (VERSION_NOISE.test(trimmed)) return;
      if (DEVTOOLS_NOISE.test(trimmed)) return;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        jsonLines.push(parsed);
        lastJson = parsed;
      } catch {
        /* ignore non-JSON lines */
      }
    };

    // Try to parse the entire stdout as a single JSON value (handles multi-line arrays/objects).
    // Falls back to per-line parsing if whole-buffer parse fails.
    const processFullOutput = (raw: string): void => {
      // Strip noise lines before attempting whole-buffer parse
      const cleaned = raw
        .split('\n')
        .filter(l => !VERSION_NOISE.test(l.trim()) && !DEVTOOLS_NOISE.test(l.trim()))
        .join('\n')
        .trim();
      if (cleaned.length === 0) return;
      try {
        const parsed: unknown = JSON.parse(cleaned);
        jsonLines.push(parsed);
        lastJson = parsed;
      } catch {
        // Not valid as a whole -- fall back to per-line
        cleaned.split('\n').forEach(processLine);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdoutRaw += text;
      // Also do live per-line parsing for publish progress events
      stdoutBuf += text;
      let idx = stdoutBuf.indexOf('\n');
      while (idx !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        processLine(line);
        idx = stdoutBuf.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      stderr += String(err.message);
      resolve({ exitCode: 1, jsonLines, stderr, lastJson });
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      // Re-parse full stdout to catch multi-line JSON arrays (accounts / history)
      // This may add duplicate single-line entries -- reset and reparse cleanly
      jsonLines.length = 0;
      lastJson = null;
      if (stdoutBuf.length > 0) {
        stdoutRaw += stdoutBuf;
        stdoutBuf = '';
      }
      processFullOutput(stdoutRaw);
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        jsonLines,
        stderr,
        lastJson,
      });
    });
  });
}
