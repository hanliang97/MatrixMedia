import path from "path";
export default async function (page, data, window, event) {
  console.log("page----", data);
  setTimeout(() => {
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      message: "上传成功",
    });
    window.close();
  }, 5000);
}
