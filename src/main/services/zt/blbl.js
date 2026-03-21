import path from "path";
async function findBilibiliArticlesByName(page, name) {
  const sel = ".article-card";
  await page.waitForSelector(sel, { timeout: 10000 });
  const items = await page.$$(sel);

  let result = null;

  for (const item of items) {
    try {
      const titleHandle = await item.$(".meta-title .name");
      const urlHandle = await item.$(".cover-wrp");

      const title = titleHandle ? await page.evaluate(el => el.innerText.trim(), titleHandle) : "";
      const href = urlHandle ? await page.evaluate(el => el.getAttribute("href"), urlHandle) : "";

      if (!title || !title.includes(name)) continue;
      return {
        title,
        url: href?.startsWith("//") ? "https:" + href : href,
        status: !!href,
      };
    } catch (e) {
      console.warn("处理出错:", e);
    }
  }

  return result;
}

export default async function (page, data, window, event) {
  console.log("开始处理 哔哩哔哩:", data);
  await page.waitForTimeout(1000 * 5);
  const result = await findBilibiliArticlesByName(page, data.bt);
  if (result) {
    console.log("找到哔哩哔哩视频:", result);
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
