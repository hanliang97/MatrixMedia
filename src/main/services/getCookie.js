import { ipcMain, session } from "electron";
import { evaluateLoginCookies } from "../../shared/loginState.js";
import { probeSphSession } from "./sphAuthProbe.js";

export default function () {
  ipcMain.on("getCookie", async (event, args) => {
    try {
      const ses = session.fromPartition(args.partition);
      const cookies = await ses.cookies.get({ url: args.url });
      let result = "";
      let loginExpiresAtMs = null;

      // 统一登录判定：除了 cookie 存在，还要排除「已过期但仍留在 jar 里」的凭据，
      // 否则 cookie 被服务端提前失效后界面仍显示已登录，用户发布时才失败。
      const verdict = evaluateLoginCookies(args.pt, cookies);

      // 视频号额外做一次真实探测：sessionid 不按时间过期，服务端可随时作废，
      // 此时 cookie 仍在、expires 也没到，只看 cookie 必然误判为已登录。
      if (verdict.loggedIn && args.pt === "视频号") {
        const probed = await probeSphSession(args.partition);
        if (probed.ok && probed.loggedIn === false) {
          console.log(
            `[getCookie] 视频号真实探测判定未登录: ${probed.reason}`
          );
          verdict.loggedIn = false;
          verdict.reason = probed.reason || "会话已失效";
        } else if (!probed.ok) {
          // 网络异常 / 未知错误码：保留 cookie 判定结果，避免断网误判
          console.log(
            `[getCookie] 视频号真实探测未得出结论，沿用 cookie 判定: ${probed.reason}`
          );
        }
      }

      if (verdict.loggedIn) {
        // 命中登录 cookie 但拿不到 expires（会话 cookie，如掘金 / 小红书）时给兜底有效期：
        // 旧实现只对掘金兜底，其它平台会写出 `expires=Invalid Date`，反而更坏。
        // 这里统一兜底，并明确语义为「假定 90 天内有效」，不是服务端承诺。
        const expMs =
          verdict.expireMs || Date.now() + 90 * 24 * 60 * 60 * 1000;
        result = `${args.name}=true; expires=${new Date(expMs).toUTCString()}; path=/`;
        loginExpiresAtMs = expMs;
      } else if (verdict.reason && verdict.reason !== "未知平台") {
        console.log(
          `[getCookie] ${args.pt} 未登录: ${verdict.reason}${
            verdict.expireMs
              ? ` (过期于 ${new Date(verdict.expireMs).toLocaleString()})`
              : ""
          }`
        );
      }

      event.reply("getCookie-done", {
        taskId: args.taskId,
        success: true,
        result: result,
        flagName: args.name,
        loginExpiresAtMs,
        pt: args.pt,
        reason: verdict.reason,
        cookies,
      });
    } catch (err) {
      console.error("获取 cookie 失败:", err);
      event.reply("getCookie-done", {
        taskId: args.taskId,
        success: false,
        error: err.message,
        flagName: args.name,
      });
    }
  });
}
