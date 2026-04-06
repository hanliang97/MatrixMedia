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
