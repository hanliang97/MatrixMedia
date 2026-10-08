"use strict";

import { session } from "electron";
import { reconcileSphCookies } from "./sphCookieSession.js";
import { probeSphSession, probeSphCookieSet } from "./sphAuthProbe.js";
import { applyAccountProxyForTask } from "./proxyConfig.js";

/** 仅在主动打开登录入口时整理冲突；读状态的调用不改写登录态。 */
export function prepareSphLoginSession(partition) {
  return reconcileSphCookies(session.fromPartition(partition), cookies =>
    cookies ? probeSphCookieSet(partition, cookies) : probeSphSession(partition)
  );
}

/** 登录准备必须先应用账号代理，再发送候选/原生鉴权请求。 */
export async function prepareSphAccountLoginSession({ partition, phone }) {
  await applyAccountProxyForTask({ partition, phone, pt: "视频号" });
  return prepareSphLoginSession(partition);
}
