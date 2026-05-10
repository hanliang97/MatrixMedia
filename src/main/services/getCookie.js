import { ipcMain, session } from "electron";

export default function () {
  ipcMain.on("getCookie", async (event, args) => {
    try {
      const ses = session.fromPartition(args.partition);
      const cookies = await ses.cookies.get({ url: args.url });
      let result = "";
      let loginExpiresAtMs = null;
      const xhsLoginCookieNames = [
        "access-token-creator.xiaohongshu.com",
        "customer-sso-sid",
        "galaxy_creator_session_id",
        "x-user-id-creator.xiaohongshu.com",
      ];
      const xhsLoginCookies = new Map();

      cookies.forEach(cookie => {
        const expMs =
          cookie.expirationDate != null && !Number.isNaN(cookie.expirationDate)
            ? Math.floor(cookie.expirationDate * 1000)
            : null;

        if (cookie.name === "passport_assist_user" && args.pt == "抖音" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
          loginExpiresAtMs = expMs;
        } else if (cookie.name === "BDUSS" && args.pt == "百家号" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
          loginExpiresAtMs = expMs;
        } else if (cookie.name === "odin_tt" && args.pt == "头条" && cookie.value.length > 65) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
          loginExpiresAtMs = expMs;
        } else if (cookie.name === "sessionid" && args.pt == "视频号" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
          loginExpiresAtMs = expMs;
        } else if (cookie.name === "SESSDATA" && args.pt == "哔哩哔哩" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
          loginExpiresAtMs = expMs;
        } else if (cookie.name === "userId" && args.pt == "快手" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
          loginExpiresAtMs = expMs;
        }

        if (args.pt == "小红书" && xhsLoginCookieNames.includes(cookie.name) && cookie.value && expMs) {
          xhsLoginCookies.set(cookie.name, expMs);
        }
      });

      if (args.pt == "小红书" && xhsLoginCookieNames.every(name => xhsLoginCookies.has(name))) {
        loginExpiresAtMs = Math.min(...xhsLoginCookies.values());
        result = `${args.name}=true; expires=${new Date(loginExpiresAtMs).toUTCString()}; path=/`;
      }

      event.reply("getCookie-done", {
        taskId: args.taskId,
        success: true,
        result: result,
        flagName: args.name,
        loginExpiresAtMs,
        pt: args.pt,
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
