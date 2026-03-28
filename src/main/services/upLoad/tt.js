import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

async function clickFirstSelector(page, selectors, timeout = 5000) {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout });
      await page.click(selector, { delay: 200 });
      return selector;
    } catch (e) {}
  }
  return "";
}

async function clickButtonByText(page, textList) {
  return page.evaluate(list => {
    const normalize = txt => String(txt || "").replace(/\s+/g, "").trim();
    const targets = list.map(normalize);
    const clickable = Array.from(document.querySelectorAll("button, span, div, a"));
    for (const el of clickable) {
      const text = normalize(el.textContent);
      if (!text) continue;
      if (targets.some(t => text === t || text.includes(t))) {
        el.click();
        return text;
      }
    }
    return "";
  }, textList);
}

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
    // 打开封面弹层，选择器兼容不同版本页面结构
    const triggerSelector = await clickFirstSelector(page, [
      ".fake-upload-trigger",
      ".cover-editor-trigger",
      ".video-cover .fake-upload-trigger",
      ".video-cover .cover-trigger",
    ]);
    if (!triggerSelector) {
      throw new Error("未找到头条号封面入口");
    }

    await page.waitForSelector(".show-img-preview .byte-slider-button, .show-img-preview .slider-btn", { timeout: 8000 });
    const slider = (await page.$(".show-img-preview .byte-slider-button")) || (await page.$(".show-img-preview .slider-btn"));
    if (!slider) {
      throw new Error("未找到头条号封面时间轴滑块");
    }

    const box = await slider.boundingBox();
    if (!box) {
      throw new Error("获取头条号封面滑块坐标失败");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // 拖动到略靠后帧，避免默认第一帧黑屏
    await page.mouse.move(startX, startY, { steps: 8 });
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // 弹层内按钮点击：优先 selector，其次按按钮文案兜底
    const firstConfirm = await clickFirstSelector(page, [".footer .m-button", ".cover-editor-footer .m-button"], 1500);
    if (!firstConfirm) {
      await clickButtonByText(page, ["完成", "确定", "下一步"]);
    }
    await page.waitForTimeout(500);

    const secondConfirm = await clickFirstSelector(page, [".footer-btns .btn-sure", ".footer-btns .btn-primary"], 1500);
    if (!secondConfirm) {
      await clickButtonByText(page, ["确定", "保存", "确认"]);
    }
    await page.waitForTimeout(500);

    const finalConfirm = await clickFirstSelector(page, [".Dialog-container .footer .red", ".Dialog-container .footer .btn-primary"], 1500);
    if (!finalConfirm) {
      await clickButtonByText(page, ["提交", "确认", "发布"]);
    }
    await page.waitForTimeout(1000);

    await page.waitForSelector(".video-batch-footer .action-footer-btn", { timeout: 10000 });
    await page.waitForTimeout(3000);
    
    await page.waitForFunction(
      () => {
        let els = document.querySelector(".basic-info  .m-right-btn .btn");
        return els && els.textContent.trim() === "重新上传";
      },
      { timeout: 1000 * 60 * 5 }
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
