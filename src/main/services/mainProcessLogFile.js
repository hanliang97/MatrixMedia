"use strict";

import fs from "fs";
import path from "path";
import util from "util";

const LOG_NAME = "matrixmedia-main.log";

let installed = false;
let logFilePath = "";
const sink = { stream: null };

function getLogFilePath(app) {
  return path.join(app.getPath("logs"), LOG_NAME);
}

/**
 * 将主进程 console 输出追加写入应用日志目录下的文件（GUI / CLI 均可用）。
 */
export function installMainProcessLogFile(app) {
  if (installed) return;
  installed = true;
  const logDir = app.getPath("logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFilePath = path.join(logDir, LOG_NAME);
  sink.stream = fs.createWriteStream(logFilePath, { flags: "a" });
  sink.stream.write(
    `[${new Date().toISOString()}] [LOG] MatrixMedia 主进程日志文件已就绪。\n`
  );

  const stamp = () => new Date().toISOString();
  const line = (level, args) => `[${stamp()}] [${level}] ${util.format(...args)}\n`;

  const wrap = (level, orig) =>
    function (...args) {
      try {
        if (sink.stream) sink.stream.write(line(level, args));
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

export function getMainProcessLogFilePath(app) {
  return logFilePath || getLogFilePath(app);
}

/**
 * 清空主进程日志文件内容并重新打开写入流（需已 install）。
 */
export function clearMainProcessLogFile(app) {
  const p = getMainProcessLogFilePath(app);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    if (sink.stream) {
      sink.stream.end();
      sink.stream = null;
    }
  } catch (_) {
    /* ignore */
  }
  fs.writeFileSync(p, "", "utf8");
  if (!installed) {
    logFilePath = p;
    return;
  }
  sink.stream = fs.createWriteStream(p, { flags: "a" });
  sink.stream.write(
    `[${new Date().toISOString()}] [LOG] MatrixMedia 主进程日志已清空。\n`
  );
}
