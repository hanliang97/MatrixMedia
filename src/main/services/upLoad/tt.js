import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_UPLOAD_PROCESSING_MS } from "./uploadTimeouts.js";

export default async function (page, data, window,event) {

  console.log(data);
  try {
    await page.waitForSelector('.byte-upload input[type="file"]', { timeout: 5000 });
    const uploadInputs = await page.$$('.byte-upload input[type="file"]');
    const uploadFileHandle = uploadInputs[0];
    await uploadFileHandle.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    const selector = 'input[placeholder="请输入 0～30 个字符"]';
    await page.waitForSelector(selector, { timeout: 1000 });
    // 获取元素句柄
    const input = await page.$(selector);
    // 点击并清空内容
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    // 输入新内容
    await page.type(selector, data.data.bt1, { delay: 50 });
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }
  try {
    await page.click(".byte-checkbox-group span:nth-child(5) > label", { delay: 200 });
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }
  // 设置封面
  try {
    await page.waitForTimeout(2000);
    await page.waitForSelector(".fake-upload-trigger", { timeout: 5000 });
    await page.click(".fake-upload-trigger");
    await page.waitForSelector(".show-img-preview .byte-slider-button", { timeout: 5000 });
    // 获取元素句柄
    let selector = ".show-img-preview .byte-slider-button";
    const input = await page.$(selector);
    // 按住往input左滑动20px
    await input.hover();
    await page.mouse.down();
    await page.mouse.move(50, 0, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.click(".footer .m-button", { delay: 200 });
    await page.waitForTimeout(500);
    await page.click(".footer-btns .btn-sure", { delay: 200 });
    await page.waitForTimeout(500);
    await page.click(".Dialog-container .footer .red", { delay: 200 });
    await page.waitForTimeout(1000);

    await page.waitForSelector(".video-batch-footer .action-footer-btn", { timeout: 10000 });
    await page.waitForTimeout(3000);
    
    await page.waitForFunction(
      () => {
        let els = document.querySelector(".basic-info  .m-right-btn .btn");
        return els && els.textContent.trim() === "重新上传";
      },
      { timeout: WAIT_UPLOAD_PROCESSING_MS }
    );
    await page.click(".video-batch-footer .submit", { delay: 200 });
    console.log("✅ 头条号视频上传成功");
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
