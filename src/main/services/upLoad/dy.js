import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

export default async function (page, data, window,event) {

  try {
    // 等待 name=upload-btn 的 input 出现
    await page.waitForSelector('input[name="upload-btn"]', { timeout: 5000 });
    const uploadInputs = await page.$$('input[name="upload-btn"]');
    // 取最后一个 input 元素
    const uploadFileHandle = uploadInputs[uploadInputs.length - 1];
    await uploadFileHandle.uploadFile(path.resolve(data.filePath));
  } catch (e) {
    console.error("❌ 输入文件失败", e);
  }
  try {
    await page.waitForSelector(".semi-input", { timeout: 1000 });
    // 获取元素句柄
    const input = await page.$(".semi-input");
    // 点击并清空内容
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    await page.type(".semi-input", data.data.bt1, { delay: 50 });

    const input2 = await page.$(".zone-container.editor-kit-container");
    await input2.click(); // 三击全选
    await page.keyboard.type(data.data.bt2 + " " + data.data.bq, { delay: 50 });
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }
  try {
    await page.waitForSelector(".download-content-Lci5tL", { timeout: 1000 });
    // 获取元素句柄
    const input = await page.$(".download-content-Lci5tL input[value='0']");
    await input.click();
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }

  try {
    // .text-JK4gL5
    // 等待出现.text-JK4gL5 并且文字是 "重新上传"的标签出现
    await page.waitForSelector(".container-b0L1T6>video", { timeout: 1000 * 60 * 5 });
    // 如果出现点击
    await page.click("#popover-tip-container");
    console.log("✅ 抖音视频上传成功");
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
    console.error("❌ 上传失败", e);
  }
}
