const { clipboard } = require("electron");

/**
 * 查找第一个包含关键词的标题并复制视频链接
 * @param {*} page Puppeteer 页面对象
 * @param {string} name 关键词
 * @returns {Promise<{ title: string, url: string, status: boolean }>}
 */
async function findFirstMatchingPostAndCopyUrl(page, name) {
  const sel = "wujie-app.wujie_iframe >>> .post-feed-item";
  await page.waitForSelector(sel, { timeout: 5000 });
  const items = await page.$$(sel);
  for (const item of items) {
    try {
      // 获取标题
      const titleHandle = await item.$(".post-title");
      const title = await page.evaluate(el => el?.innerText?.trim(), titleHandle);
      if (!title || !title.includes(name)) {
        console.log("标题不匹配:", title);
        return null;
      }
      console.log("找到标题:", title);

      // Hover 分享按钮（触发浮层）
      const shareBtn = (await item.$$(".opr-item-wrap .opr-item"))[1];
      if (shareBtn) {
        await shareBtn.hover();
        await page.waitForTimeout(100);
        // 点击分享按钮
        await shareBtn.click();
        await page.waitForTimeout(500);
      }
      console.log("分享按钮已触发浮层");
      const copyBtn = (await shareBtn.$$(".opr-item-wrap .copy-feed-id"))[2];
      await copyBtn.hover();
      await copyBtn.click();
      await page.waitForTimeout(500);
      const url = clipboard.readText().trim();
      console.log("已复制链接:", url);
      return {
        title,
        url,
        status: !!url,
      };
    } catch (err) {
      console.error("处理失败：", err.message);
    }
  }
  return null;
}

/**
 * 主执行函数
 */
export default async function (page, data, window, event,onFinish) {
  console.log("微信视频获取：", data);
  await page.waitForTimeout(1000 * 5);
  const result = await findFirstMatchingPostAndCopyUrl(page, data.bt);
  console.log("视频号链接获取成功:", result);
  if (result) {
    event.reply("puppeteerFile-done", {
      taskId: data.taskId,
      ...result,
    });
  } else {
    event.reply("puppeteerFile-done", {
      taskId: data.taskId,
      status: false,
    });
    console.log("未找到指定视频");
  }
  onFinish && onFinish();
  event.reply("puppeteer-loginOk",{...data,status:true});
  window.close();
}
