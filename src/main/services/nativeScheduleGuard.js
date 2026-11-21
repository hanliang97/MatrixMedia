"use strict";

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { canonicalAccountPartition } from "../../shared/accountPartition.js";

const reservations = new WeakMap();

/** GUI / CLI / MCP 共用；wx 文件锁同时阻止跨进程重复上传。 */
export function reserveNativeScheduleTask(data, directory) {
  if (!(data.nativeScheduleAt || data.scheduleMode === "native")) return { ok: true };
  data.nativeSubmitAttempted = false;
  const source = data.remoteFileUrl || data.filePath || "";
  const file = /^https?:\/\//i.test(source) ? source : path.resolve(source);
  const identity = JSON.stringify([
    data.pt, canonicalAccountPartition(data.partition, data.pt),
    process.platform === "win32" && !/^https?:\/\//i.test(file) ? file.toLowerCase() : file,
    data.textType || "local", Number(data.nativeScheduleAt),
  ]);
  const name = createHash("sha256").update(identity).digest("hex") + ".json";
  const filePath = path.join(directory, name);
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(filePath, JSON.stringify({ createdAt: Date.now(), nativeScheduleAt: data.nativeScheduleAt }),
      { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { ok: false, filePath, message: `同一账号、文件和时间的原生排期已有提交记录，未重复上传。请先到平台核对；仅在确认未排期后删除防重记录再试：${filePath}` };
  }
  reservations.set(data, { filePath, submitted: false });
  return { ok: true, filePath };
}

/** 先占位再点击；进程意外退出时保留占位，禁止下一次自动重传。 */
export function markNativeScheduleSubmitting(data) {
  const reservation = reservations.get(data);
  if (!reservation) throw new Error("缺少原生排期防重记录，已停止提交");
  reservation.submitted = true;
  data.nativeSubmitAttempted = true;
}

/** 只有确定尚未点击提交才释放；已提交和结果不明均保留。 */
export function finishNativeScheduleTask(data) {
  const reservation = reservations.get(data);
  if (!reservation) return;
  if (!reservation.submitted) fs.rmSync(reservation.filePath, { force: true });
  reservations.delete(data);
}
