import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  return VERSION_NOISE.test(trimmed) || DEVTOOLS_NOISE.test(trimmed);
}

function stripNoiseLines(raw: string): string {
  return raw
    .split('\n')
    .filter(line => !isNoiseLine(line))
    .join('\n')
    .trim();
}

export interface RunCliOptions {
  onProgress?: (elapsed: number) => void;
  progressIntervalMs?: number; // default 30000
}

export const NOT_INSTALLED_MESSAGE =
  '未找到 MatrixMedia（矩媒）桌面端。请先安装：' +
  'https://github.com/hanliang97/MatrixMedia/releases （国内：https://gitee.com/gzlingyi_0/pubtw/releases ）。' +
  '已安装但仍提示此错误时，可设置环境变量 MATRIXMEDIA_BIN 指向 matrixmedia 可执行文件。';

interface ResolvedCommand {
  command: string;
  prefixArgs: string[];
  cwd: string | undefined;
  env: NodeJS.ProcessEnv;
}

function findOnPath(name: string): string | null {
  const probe = process.platform === 'win32' ? `where ${name}` : `command -v ${name}`;
  try {
    const out = execSync(probe, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    const first = out.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

export function defaultInstallLocations(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      '/Applications/matrixmedia.app/Contents/MacOS/matrixmedia',
      path.join(home, 'Applications/matrixmedia.app/Contents/MacOS/matrixmedia'),
    ];
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
      (p): p is string => Boolean(p)
    );
    const dirs = ['矩媒', 'matrix-video', 'MatrixMedia'];
    return [
      ...dirs.map(d => path.join(local, 'Programs', d, 'matrixmedia.exe')),
      ...pf.flatMap(p => dirs.map(d => path.join(p, d, 'matrixmedia.exe'))),
    ];
  }
  return ['/opt/矩媒/matrixmedia', '/opt/MatrixMedia/matrixmedia', '/usr/bin/matrixmedia'];
}

/** When running from a source checkout (mcp/dist/runner.js), the repo root is two levels up. */
function inferRepoRoot(): string | null {
  const candidate = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
    return pkg && pkg.name === 'matrix-video' ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Resolution order:
 * 1. MATRIXMEDIA_BIN — explicit path to the installed executable
 * 2. `matrixmedia` on PATH (where / command -v)
 * 3. Default install locations per OS
 * 4. MATRIXMEDIA_DIR — source checkout, run via local electron (developer mode only)
 */
export function resolveMatrixmediaCommand(): ResolvedCommand | null {
  const env: NodeJS.ProcessEnv = { ...process.env };

  const explicit = process.env.MATRIXMEDIA_BIN;
  if (explicit && fs.existsSync(explicit)) {
    return { command: explicit, prefixArgs: ['cli'], cwd: undefined, env };
  }

  const onPath = findOnPath('matrixmedia');
  if (onPath) {
    return { command: onPath, prefixArgs: ['cli'], cwd: undefined, env };
  }

  const installed = defaultInstallLocations().find(p => fs.existsSync(p));
  if (installed) {
    return { command: installed, prefixArgs: ['cli'], cwd: undefined, env };
  }

  const dir = process.env.MATRIXMEDIA_DIR ?? inferRepoRoot();
  if (dir) {
    const electronBin = path.join(
      dir,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'electron.cmd' : 'electron'
    );
    if (fs.existsSync(electronBin)) {
      env.ELECTRON_RUN_AS_NODE = '';
      return {
        command: electronBin,
        prefixArgs: ['.', 'cli'],
        cwd: dir,
        env,
      };
    }
  }

  return null;
}

export async function runCli(args: string[], opts?: RunCliOptions): Promise<CliResult> {
  const resolved = resolveMatrixmediaCommand();
  if (!resolved) {
    // Surface a single actionable message to every tool instead of tool-specific exit-code text.
    throw new Error(NOT_INSTALLED_MESSAGE);
  }

  const { command, prefixArgs, cwd, env } = resolved;
  const spawnArgs = [...prefixArgs, ...args];

  return new Promise<CliResult>((resolve) => {
    const child = spawn(command, spawnArgs, {
      cwd,
      shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
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
      if (isNoiseLine(trimmed)) return;
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
      const cleaned = stripNoiseLines(raw);
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
      resolve({ exitCode: 1, jsonLines, stderr: stripNoiseLines(stderr), lastJson });
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
        stderr: stripNoiseLines(stderr),
        lastJson,
      });
    });
  });
}
