import path from "path";
/**
 * 查找指定标题的视频封面 clientCacheKey
 * @param {puppeteer.Page} page Puppeteer 页面对象
 * @param {string} name 视频标题关键词，如 "舔狗逆袭被跪求"
 * @returns {Promise<{title: string, key: string} | null>}
 */
async function findVideoClientCacheKey(page, name) {
  await page.waitForSelector('.video-item',{timeout:10000});
  const items = await page.$$('.video-item');
   for (const item of items) {
    try {
      // 获取标题文本
      const titleHandle = await item.$('.video-item__detail__row__title');
      if (!titleHandle) continue;

      const rawTitle = await page.evaluate(el => el.textContent || '', titleHandle);
      const title = rawTitle.replace(/\s+/g, '').trim();

      if (!title.includes(name)) continue;

      // 获取状态文本
      const statusHandle = await item.$('.video-item__detail__row__status');
      const statusText = statusHandle ? await page.evaluate(el => el.textContent.trim(), statusHandle) : '';
      const isPublished = statusText.includes('已发布');

      // 获取封面图片 src
      const imgHandle = await item.$('.video-item__cover img');
      if (!imgHandle) continue;

      const src = await page.evaluate(el => el.getAttribute('src'), imgHandle);
      const match = src.match(/clientCacheKey=([^&]+)/);
      const key = match ? match[1] : null;

      return {
        title,
        url:'https://www.kuaishou.com/short-video/'+key.split('.')[0],
        status: isPublished
      };
    } catch (err) {
      console.warn('处理某个 video-item 出错:', err);
    }
  }

  return null;
}

export default async function (page, data, window,event) {
  console.log("获取审核状态 快手", data);
  await page.waitForTimeout(1000 * 5);
  const result = await findVideoClientCacheKey(page, data.bt);
  if (result) {
    console.log('找到快手视频:', result);
    event.reply("puppeteerFile-done", {
        taskId: data.taskId,
        ...result
      });
  } else {
    event.reply("puppeteerFile-done", {
      taskId: data.taskId,
      status: false,
    });
    console.log('未找到指定视频');
  }
  window.close();
  
}
