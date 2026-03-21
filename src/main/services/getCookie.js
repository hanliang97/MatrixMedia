import { ipcMain, session } from "electron";

export default function () {
  ipcMain.on("getCookie", async (event, args) => {
    try {
      const ses = session.fromPartition(args.partition);
      const cookies = await ses.cookies.get({ url: args.url });
      let result = "";
      
      cookies.forEach(cookie => {
        
        if (cookie.name === "passport_assist_user" && args.pt == "抖音" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
        } else if (cookie.name === "BDUSS" && args.pt == "百家号" && cookie.value) {
         result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
        } else if (cookie.name === "odin_tt" && args.pt == "头条" && cookie.value.length > 65) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
        } else if (cookie.name === "sessionid" && args.pt == "视频号" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
        } else if (cookie.name === "SESSDATA" && args.pt == "哔哩哔哩" && cookie.value) {
         result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
        } else if (cookie.name === "userId" && args.pt == "快手" && cookie.value) {
          result = `${args.name}=true; expires=${new Date(cookie.expirationDate * 1000).toUTCString()}; path=/`;
        }
      });
      event.reply("getCookie-done", {
        taskId: args.taskId,
        success: true,
        result: result,
        pt:args.pt,
        cookies
      });
    } catch (err) {
      console.error("获取 cookie 失败:", err);
      event.reply("getCookie-done", {
        taskId: args.taskId,
        success: false,
        error: err.message,
      });
    }
  });
}
