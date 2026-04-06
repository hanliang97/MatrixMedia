"use strict";

/**
 * 判断是否为 CLI 模式。支持：
 * - 打包后：矩媒.exe cli publish ...
 * - 开发：electron . cli publish ... 或 electron dist/electron/main.js cli ...
 */
export function isCliMode(argv = process.argv) {
  return argv.includes("cli");
}

/**
 * 返回 `cli` 子命令之后的参数（不含 `cli` 本身）
 */
export function getCliSubArgv(argv = process.argv) {
  const i = argv.indexOf("cli");
  if (i === -1) return null;
  return argv.slice(i + 1);
}
