import path from "path";
export default async function (page, data, window, event,onFinish) {
  console.log("上传文件-----------:", data);
  setTimeout(() => {
    onFinish && onFinish();
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
    window.close();

  }, 5000);
}
