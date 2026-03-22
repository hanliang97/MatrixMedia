import path from "path";

async function findBilibiliArticlesByName(page, name, window, cardSelector) {
  const sel =
    cardSelector && String(cardSelector).trim()
      ? String(cardSelector).trim()
      : ".video-card-zQ02ng";
  await page.waitForSelector(sel, { timeout: 5000 });
  const items = await page.$$(sel);
  for (const item of items) {
    try {
      const titleHandle = await item.$(".info-title-text-YTLo9y");
      const title = titleHandle ? await page.evaluate(el => el.innerText.trim(), titleHandle) : "";
      if (!title || !title.includes(name)) continue;
      // ① 先设置 handler 等待捕获
      const urlPromise = new Promise(resolve => {
        window.webContents.setWindowOpenHandler(({ url }) => {
          resolve("https://www.douyin.com/video" + url.split("work-detail")[1].split("?")[0]); // 把 URL 传出
          return { action: "deny" }; // 拒绝弹出窗口
        });
      });
      // ② 然后触发点击（window.open）
      await titleHandle.click();
      // ③ 等待 URL 捕获完成
      const url = await urlPromise;

      // ④ 返回你的最终结构
      return {
        title,
        url,
        status: true,
      };
    } catch (e) {
      console.warn("处理出错:", e);
    }
  }

  return null;
}

export default async function (page, data, window, event) {
  console.log("开始处理抖音:", data);
  await page.waitForTimeout(1000 * 5);
  const result = await findBilibiliArticlesByName(page, data.bt, window, data.statusCalss);
  if (result) {
    console.log("找到抖音视频:", result);
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
  window.close();
}
