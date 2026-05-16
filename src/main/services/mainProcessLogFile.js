"use strict";

import fs from "fs";
import path from "path";
import util from "util";

const LOG_FILE_NAME_RE = /^\d{4}-\d{2}-\d{2}\.log$/;

let installed = false;
let logFilePath = "";
const sink = { stream: null };

function formatLogDate(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getLogFilePath(app) {
  return path.join(getMainProcessLogDir(app), `${formatLogDate()}.log`);
}

function closeLogStream() {
  try {
    if (sink.stream) {
      sink.stream.end();
      sink.stream = null;
    }
  } catch (_) {
    /* ignore */
  }
}

function openLogStream(app) {
  const p = getLogFilePath(app);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (sink.stream && logFilePath === p) return sink.stream;
  closeLogStream();
  logFilePath = p;
  sink.stream = fs.createWriteStream(logFilePath, { flags: "a" });
  return sink.stream;
}

/**
 * 将主进程 console 输出追加写入应用日志目录下的文件（GUI / CLI 均可用）。
 */
export function installMainProcessLogFile(app) {
  if (installed) return;
  installed = true;
  openLogStream(app).write(
    `[${new Date().toISOString()}] [LOG] MatrixMedia 主进程日志文件已就绪。\n`
  );

  const stamp = () => new Date().toISOString();
  const line = (level, args) => `[${stamp()}] [${level}] ${util.format(...args)}\n`;

  const wrap = (level, orig) =>
    function (...args) {
      try {
        openLogStream(app).write(line(level, args));
      } catch (_) {
        /* ignore disk errors so console still works */
      }
      return orig.apply(console, args);
    };

  console.log = wrap("LOG", console.log);
  console.info = wrap("INFO", console.info);
  console.warn = wrap("WARN", console.warn);
  console.error = wrap("ERROR", console.error);
  console.debug = wrap("DEBUG", console.debug);
}

export function getMainProcessLogDir(app) {
  return app.getPath("logs");
}

export function getMainProcessLogFilePath(app) {
  return getLogFilePath(app);
}

/**
 * 清空主进程日志目录下所有按天保存的日志，并在已安装时重新打开今日日志。
 */
export function clearMainProcessLogFile(app) {
  const logDir = getMainProcessLogDir(app);
  fs.mkdirSync(logDir, { recursive: true });
  closeLogStream();
  fs.readdirSync(logDir).forEach((name) => {
    if (!LOG_FILE_NAME_RE.test(name)) return;
    fs.rmSync(path.join(logDir, name), { force: true });
  });
  if (!installed) {
    logFilePath = "";
    return;
  }
  openLogStream(app).write(
    `[${new Date().toISOString()}] [LOG] MatrixMedia 主进程日志已清空。\n`
  );
}
