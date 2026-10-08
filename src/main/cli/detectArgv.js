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
 * 返回 `cli` 子命令之后的参数（不含 `cli` 本身）。
 * 兼容包装脚本/别名重复注入 cli 的情况：
 * 如 matrixmedia cli publish 经包装变为 electron . cli cli publish，
 * 多余的连续 cli 标记直接剥掉，避免误报「未知子命令: cli」。
 */
export function getCliSubArgv(argv = process.argv) {
  const i = argv.indexOf("cli");
  if (i === -1) return null;
  let sub = argv.slice(i + 1);
  while (sub.length > 0 && sub[0] === "cli") {
    sub = sub.slice(1);
  }
  return sub;
}
