import path from "path";
/**
 * 百家号：查找指定标题的文章信息
 * @param {puppeteer.Page} page Puppeteer 页面对象
 * @param {string} name 标题关键词
 * @returns {Promise<{ title: string, id: string, url: string, status: boolean } | null>}
 */
async function findBaiduVideoInfo(page, name) {
  await page.waitForSelector('.client_pages_content_v2_components_articleItem', { timeout: 10000 });
  const items = await page.$$('.client_pages_content_v2_components_articleItem');

  for (const item of items) {
    try {
      const titleHandle = await item.$('.title a');
      if (!titleHandle) continue;

      const rawTitle = await page.evaluate(el => el.textContent || '', titleHandle);
      const title = rawTitle.replace(/\s+/g, '').trim();
      if (!title.includes(name)) continue;

      const href = await page.evaluate(el => el.getAttribute('href'), titleHandle);
      const match = href.match(/id=(\d+)/);
      const id = match ? match[1] : null;
      if (!id) continue;

      const statusHandle = await item.$('.client_pages_content_v2_components_articleTags_createTag');
      const statusText = statusHandle ? await page.evaluate(el => el.textContent.trim(), statusHandle) : '';
      const isPublished = statusText.includes('已发布');

      return {
        title,
        id,
        url: `https://mbd.baidu.com/newspage/data/videolanding?nid=sv_${id}`,
        status: isPublished
      };
    } catch (err) {
      console.warn('处理某个百家号条目出错:', err);
    }
  }

  return null;
}



export default async function (page, data, window, event) {
  console.log("开始处理 百家号:", data);
  await page.waitForTimeout(1000 * 5);
  const result = await findBaiduVideoInfo(page, data.bt);
  if (result) {
    console.log("百家号链接获取成功:", result);
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



