import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_UPLOAD_PROCESSING_MS } from "./uploadTimeouts.js";

export default async function (page, data, window,event,onFinish) {
  const isDraftMode = data.publishMode === "draft" || data.publishToDraft === true;

  console.log(data);
  await page.waitForTimeout(1000 * 5);
  try {
    const sel = 'wujie-app.wujie_iframe >>> input[type="file"]';

    const uploadInput = await page.waitForSelector(sel, { timeout: 1000 * 5 });
    if (!uploadInput) throw new Error("上传 input 不存在");
    await uploadInput.uploadFile(path.resolve(data.filePath));
    await uploadInput.evaluate(el => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  } catch (err) {
    console.error("❌ 文件上传失败:", err);
  }

  try {
    const titleInput = await page.waitForSelector("wujie-app.wujie_iframe >>> .post-desc-box .input-editor", { timeout: 5000 });
    // 传统input/textarea的操作
    await titleInput.click();
    await page.keyboard.type(data.data.bt1 + " " + data.data.bq, { delay: 50 });
    const sel2 = 'wujie-app.wujie_iframe >>> input[placeholder="概括视频主要内容，字数建议6-16个字符"]';
    const uploadInput2 = await page.waitForSelector(sel2, { timeout: 10000 });
    await uploadInput2.click();
    let newBt = data.data.bt2.replace(/[，。、\/,;:!?'"()\[\]{}<>]/g, ' ');
    await page.keyboard.type(newBt, { delay: 50 });
  } catch (err) {
    console.error("❌ 输入失败:", err);
  }
  try {
    const yInput = await page.waitForSelector("wujie-app.wujie_iframe >>> .declare-original-checkbox .ant-checkbox-wrapper", { timeout: 5000 });
    // 传统input/textarea的操作
    await yInput.click();

    // 首次使用账号：视频号会先弹一个「声明原创协议」弹窗
    // （.weui-desktop-dialog__bd 里含 .protocol-text + 文本"声明原创"的 primary 按钮），
    // 需要先勾协议再确认，之后才会进入常规的声明原创勾选 dialog。
    // 非首次账号不弹此弹窗，整段需容错、非阻塞：短超时 + 吞错，不影响主流程。
    try {
      await page.waitForSelector(
        "wujie-app.wujie_iframe >>> .weui-desktop-dialog__bd .protocol-text",
        { timeout: 2500 }
      );
      const protocol = await page.$("wujie-app.wujie_iframe >>> .weui-desktop-dialog__bd .protocol-text");
      if (protocol) await protocol.click();
      await page.waitForTimeout(300);
      const clicked = await page.evaluate(() => {
        const app = document.querySelector("wujie-app.wujie_iframe");
        if (!app || !app.shadowRoot) return false;
        const bodies = app.shadowRoot.querySelectorAll(".weui-desktop-dialog__bd");
        for (const body of bodies) {
          const dlg = body.closest(".weui-desktop-dialog") || body.parentElement;
          const btns = (dlg || body).querySelectorAll("button.weui-desktop-btn_primary");
          for (const btn of btns) {
            if (String(btn.textContent || "").trim().includes("声明原创")) {
              btn.click();
              return true;
            }
          }
        }
        return false;
      });
      if (clicked) await page.waitForTimeout(800);
    } catch (_) {
      // 非首次账号或协议弹窗未出现，直接继续
    }

    let cBox = await page.waitForSelector("wujie-app.wujie_iframe >>> .declare-original-dialog .weui-desktop-dialog label.ant-checkbox-wrapper", { timeout: 5000 });
    await cBox.click();
    let aBtn = await page.waitForSelector("wujie-app.wujie_iframe >>> .declare-original-dialog .weui-desktop-dialog button.weui-desktop-btn_primary", { timeout: 5000 });
    await aBtn.click();
  } catch (err) {
    console.error("❌ 声明原创失败:", err);
  }

  try {
    // 等待 .tag-inner 内容变为“删除”
    await page.waitForFunction(
      () => {
        const app = document.querySelector("wujie-app.wujie_iframe");
        if (!app || !app.shadowRoot) return false;
        const tag = app.shadowRoot.querySelector(".tag-inner");
        return tag && tag.textContent.trim() === "删除";
      },
      { timeout: WAIT_UPLOAD_PROCESSING_MS }
    );

    await page.waitForTimeout(2000);
    // 发布到草稿 第一个按钮
    const publishDraftBtn = await page.waitForSelector("wujie-app.wujie_iframe >>> .form-btns>div:first-child button", { timeout: 5000 });
    await publishDraftBtn.click({ delay: 200 });
    if (!isDraftMode) {
      // 发布最后一个按钮
      const publishBtn = await page.waitForSelector("wujie-app.wujie_iframe >>> .form-btns>div:last-child button", { timeout: 5000 });
      await publishBtn.click({ delay: 200 });
      await page.waitForTimeout(1000);
      await publishBtn.click({ delay: 200 });
    }
    console.log(isDraftMode ? "✅ 视频号视频已保存草稿" : "✅ 视频号视频上传成功");
    setTimeout(() => {
      onFinish && onFinish();
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: isDraftMode ? "保存草稿成功" : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (err) {
    onFinish && onFinish();
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
     maybeClosePublishWindow(data, window);
    console.error("❌ 发布失败:", err);
  }
  
}
