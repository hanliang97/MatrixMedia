import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

export default async function (page, data, window,event) {

  console.log(data);
  try {
    let sel = '#joyride-wrapper input[type="file"]';
    await page.waitForSelector(sel, { timeout: 5000 });
    const uploadInputs = await page.$(sel);
    await uploadInputs.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    const selector = "#work-description-edit";
    await page.waitForSelector(selector, { timeout: 1000 });
    const input = await page.$(selector);
    await input.click();
    await page.keyboard.type(data.data.bt1 + " " + data.data.bq.replace("#解压", ""), { delay: 50 });
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }
  try {
    await page.click(".ant-checkbox-group>label:nth-of-type(2)", { delay: 200 });
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }
  try {
    await page.waitForSelector("#preview-tours video", { timeout: 1000 * 60 * 5 });
    await page.waitForSelector("._button-primary_3a3lq_60", { timeout: 10000 });
    await page.click("._button-primary_3a3lq_60", { delay: 200 });
    console.log("✅ 快手视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (e) {
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
    console.error("❌ 发布失败", e);
  }
}
