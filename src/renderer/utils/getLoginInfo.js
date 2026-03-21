import { ipcRenderer } from "electron";
import { useAppStore } from "@/store/app";
import ptConfig from "@/utils/configUrl";
// 打开页面保持登录状态
export default async function (endData) {
  const taskHandlers = new Map();
  const taskHandlers2 = new Map();
  ipcRenderer.on("puppeteer-noLogin", (event, data) => {
    const { taskId } = data;
    const handler = taskHandlers.get(taskId);
    if (handler) {
      handler(data);
      taskHandlers.delete(taskId); // 一次性任务，用完移除
    }
  });
  ipcRenderer.on("puppeteer-loginOk", (event, data) => {
    const { taskId } = data;
    const handler = taskHandlers2.get(taskId);
    if (handler) {
      handler(data);
      taskHandlers2.delete(taskId); // 一次性任务，用完移除
    }
  });
  useAppStore().clearLoginData();
  let totalAccout = 0;
  let successAccount = 0;
  for (let i in endData) {
    let item = endData[i];
    console.log(item);
    if (item.children) {
      for (let j of item.children) {
        if (j.name == "视频号") {
          totalAccout++;
          const taskId = Date.now() + Math.random(); // 更唯一些
          // 建立一个任务监听池
          ipcRenderer.send("puppeteerFile", {
            show: false,
            taskId,
            bt: "tst",
            useragent: ptConfig[j.name].useragent,
            partition: "persist:" + j.meta.phone.split('-')[0] + j.name,
            url: ptConfig[j.name].listIndex,
            pt: j.name + "状态",
          });
          taskHandlers.set(taskId, data => {
            console.log(data, "---------");

            useAppStore().addLoginData(data);
            useAppStore().addLoginDataStatus({ [data.partition]: false });
          });
          taskHandlers2.set(taskId, data => {
            successAccount++;
            useAppStore().addLoginDataStatus({ [data.partition]: true });
            console.log("共需登录账号：" + totalAccout + "，成功账号：" + successAccount);
          });
          break;
        }
      }
    }
  }
}
