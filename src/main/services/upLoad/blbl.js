import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

export default async function (page, data, window,event) {

  console.log(data);
  try {
    let sel = '.bcc-upload input[type="file"]';
    await page.waitForSelector(sel, { timeout: 5000 });
    const uploadInputs = await page.$(sel);
    await uploadInputs.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    const selector = '.input-instance input[placeholder="请输入稿件标题"]';
    await page.waitForSelector(selector, { timeout: 5000 });
    const input = await page.$(selector);
    await input.click({ clickCount: 3 }); // 三击全选
    await page.keyboard.press("Backspace"); // 删除内容
    await page.keyboard.type(data.data.bt1, { delay: 50 });
  } catch (e) {
    console.error("❌ 输入标题失败", e);
  }

  try {
    const selector = ".video-human-type .select-container";
    await page.waitForSelector(selector, { timeout: 5000 });
    const input = await page.$(selector);
    await input.click();
    await page.waitForSelector(".human-type-list", { timeout: 5000 });
    const input2 = await page.$('.human-type-list div[title="影视"]');
    await input2.click();
  } catch (e) {
    console.error("❌ 输入类型失败", e);
  }
  try {
    const selector = ".desc-container .ql-editor";
    await page.waitForSelector(selector, { timeout: 1000 });
    const input = await page.$(selector);
    await input.click();
    await page.keyboard.type(data.data.bdText);
  } catch (e) {
    console.error("❌ 输入简介失败", e);
  }
  try {
    let tag = data.data.bq
      .trim()
      .split(/\s+/)
      .map(tag => tag.replace(/^#/, ""));
    const selector = ".tag-container .input-instance input";
    await page.waitForSelector(selector, { timeout: 5000 });
    const input = await page.$(selector);
    await input.focus();
    // 标签规则是输入一个词后按回车
    console.log(tag);
    for (let i = 0; i < tag.length; i++) {
      await page.keyboard.type(tag[i], { delay: 100 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      await input.focus();
    }
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }

  // 封面设置
  try {
    await page.waitForSelector(".file-item-content-status .success", { timeout: 1000 * 60 * 2 });
    await page.waitForSelector(".cover-main-img .buttons", { timeout: 1000 * 60 * 1 });
    await page.click(".cover-main .buttons span:first-child", { delay: 200 });
    await page.waitForSelector(".cover-select-footer-pick>button:last-child", { timeout: 5000 });
    await page.click(".cover-select-footer-pick>button:last-child", { delay: 200 });
  } catch (e) {}

  try {
    await page.waitForTimeout(500);
    // 点击一下空白的区域
    await page.click("body", { delay: 200 });
    await page.waitForSelector(".submit-container .submit-add", { timeout: 10000 });
    await page.click(".submit-add", { clickCount: 2, delay: 200 });
    // 检测._phone-label_1eni7_34 消失
    console.log("✅ 哔哩哔哩视频上传成功");
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
    maybeClosePublishWindow(data, window);
    console.error("❌ 发布失败", e);
  }
}
