"use strict";

import fs from "fs";
import path from "path";

export function createPublishHistoryExportHandler({ dialog, BrowserWindow, app, fileSystem = fs }) {
  return async (event, args = {}) => {
    try {
      const frame = new URL(String((event.senderFrame && event.senderFrame.url) || ""));
      const localFrame = (frame.protocol === "file:" && !frame.hostname) ||
        (["http:", "https:"].includes(frame.protocol) &&
          ["localhost", "127.0.0.1"].includes(frame.hostname));
      if (!localFrame) return { ok: false, message: "不允许外部页面导出记录" };
      const csv = args && args.csv;
      if (typeof csv !== "string" || Buffer.byteLength(csv, "utf8") > 20 * 1024 * 1024) {
        return { ok: false, message: "导出数据无效或超过 20 MB" };
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, message: "窗口已关闭" };
      const result = await dialog.showSaveDialog(win, {
        title: "导出当前发布记录",
        defaultPath: path.join(app.getPath("documents"),
          `MatrixMedia-发布记录-${new Date().toISOString().slice(0, 10)}.csv`),
        filters: [{ name: "CSV 表格", extensions: ["csv"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fileSystem.promises.writeFile(result.filePath, csv, "utf8");
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "导出失败" };
    }
  };
}
