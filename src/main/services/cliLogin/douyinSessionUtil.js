"use strict";

import { session } from "electron";

export const CREATOR_ORIGIN = "https://creator.douyin.com";

export function normalizeDouyinPartition(partition) {
  return String(partition || "").split("-")[0];
}

export async function hasDouyinSession(partition) {
  const part = normalizeDouyinPartition(partition);
  const ses = session.fromPartition(part);
  const cookies = await ses.cookies.get({ url: CREATOR_ORIGIN });
  return cookies.some(c => c.name === "passport_assist_user" && c.value);
}

/** --force 重新登录：清掉该分区的抖音 Cookie，避免服务端已失效的旧会话被当成「已登录」 */
export async function clearDouyinSession(partition) {
  const ses = session.fromPartition(normalizeDouyinPartition(partition));
  const cookies = (await ses.cookies.get({})).filter(c => /(^|\.)douyin\.com$/.test(c.domain.replace(/^\./, "")));
  for (const c of cookies) {
    await ses.cookies.remove(`https://${c.domain.replace(/^\./, "")}${c.path || "/"}`, c.name);
  }
  await ses.cookies.flushStore();
  return cookies.length;
}
