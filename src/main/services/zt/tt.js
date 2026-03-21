/**
 * 查找头条作品信息
 * @param {puppeteer.Page} page
 * @param {string} name 视频标题关键词，如 "舔狗逆袭被跪求"
 * @returns {Promise<{title: string, id: string, status: boolean} | null>}
 */
async function findToutiaoVideoInfo(page, name) {
  await page.waitForSelector(".genre-item", { timeout: 10000 });
  const items = await page.$$(".genre-item");

  for (const item of items) {
    try {
      // 获取标题文本
      const titleHandle = await item.$(".title");
      if (!titleHandle) continue;

      const rawTitle = await page.evaluate(el => el.textContent || "", titleHandle);
      const title = rawTitle.replace(/\s+/g, "").trim();
      if (!title.includes(name)) continue;

      // 获取封面图片的 src
      const imgHandle = await item.$(".cover-img");
      const src = imgHandle ? await page.evaluate(el => el.getAttribute("src"), imgHandle) : "";
      const match = src.match(/gid=(\d+)/);
      const id = match ? match[1] : null;
      if (!id) continue;

      // 判断是否已发布
      const tagHandle = await item.$(".byte-tag.byte-tag-checked");
      const statusText = tagHandle ? await page.evaluate(el => el.textContent.trim(), tagHandle) : "";
      const isPublished = statusText.includes("已发布");

      return {
        title,
        url: "https://www.kuaishou.com/short-video/" + id + "/",
        status: isPublished,
      };
    } catch (err) {
      console.warn("处理某个 genre-item 出错:", err);
    }
  }

  return null;
}

export default async function (page, data, window, event) {
  console.log("获取审核状态 头条", data);
  await page.waitForTimeout(1000 * 5);
  const result = await findToutiaoVideoInfo(page, data.bt);
  if (result) {
    console.log("找到头条视频:", result);
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
