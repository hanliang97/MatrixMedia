import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

export default async function (page, data, window,event) {
  // 使用try-catch包装所有可能出错的操作
  try {
     await page.waitForTimeout(2000);
    await page.waitForSelector('.video-main-container input[type="file"]', { timeout: 5000 });
    const uploadInputs = await page.$$('.video-main-container input[type="file"]');
    const uploadFileHandle = uploadInputs[0];
    await uploadFileHandle.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
    // 不抛出错误，继续执行后续步骤
  }

  try {
    await page.waitForTimeout(5000);
    const selector = 'input[placeholder="添加标题获得更多推荐"]';
    await page.waitForSelector(selector, { timeout: 1000 });
    // 获取元素句柄
    const input = await page.$(selector);
    // 点击并清空内容
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    // 输入新内容
    await page.type(selector, data.data.bt1, { delay: 50 });
  } catch (err) {
    console.error("标题处理失败:", err);
  }

  try {
    const address =
      (data.data && String(data.data.address || "").trim()) || "";
    if (address) {
      await page.type("#my-position", address, { delay: 200 });
    }
  } catch (err) {
    console.error("地址填写失败:", err);
  }

  // 点击提交按钮
  try {
    // 等待 .upload-step-progress  .progress-container.uploading 消失
    await page.waitForSelector(".upload-step-progress  .progress-container.uploading", { hidden: true, timeout: 1000 * 60 * 5 });
    await page.waitForTimeout(1000);
    await page.click("#new-operator-content  button.cheetah-btn-primary.cheetah-btn-solid", { delay: 200 });
    console.log("✅ 百家号视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (err) {
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
    console.error("点击提交按钮失败:", err);
  }
}
