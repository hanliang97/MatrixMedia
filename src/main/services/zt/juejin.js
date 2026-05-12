const TITLE_SELECTOR = ".essays-container .title";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function getKeyword(data) {
  return normalizeText(data.bt || data.title || data.textOtherName);
}

async function findJuejinArticleInfo(page, data) {
  const keyword = getKeyword(data);
  if (!keyword) return null;

  try {
    await page.waitForSelector(TITLE_SELECTOR, { timeout: 15000 });
  } catch (error) {
    console.warn("掘金已发布文章列表加载超时:", error?.message || error);
    return null;
  }

  return page.$$eval(
    TITLE_SELECTOR,
    (items, key) => {
      const normalize = value => String(value || "").replace(/\s+/g, "").trim();

      for (const item of items) {
        const title = normalize(item.textContent);
        if (!title || !title.includes(key)) continue;

        const link = item.closest("a") || item.querySelector("a");
        return {
          title,
          status: true,
          url: link ? link.href : "",
        };
      }

      return null;
    },
    keyword
  );
}

export default async function (page, data, window, event) {
  console.log("获取审核状态 掘金", data);

  try {
    await page.waitForTimeout(1000 * 5);
    const result = await findJuejinArticleInfo(page, data);

    if (result) {
      console.log("找到掘金文章:", result);
      event.reply("puppeteerFile-done", {
        taskId: data.taskId,
        ...result,
      });
    } else {
      event.reply("puppeteerFile-done", {
        taskId: data.taskId,
        status: false,
      });
      console.log("未找到指定掘金文章");
    }
  } catch (error) {
    console.error("获取掘金文章状态失败:", error);
    event.reply("puppeteerFile-done", {
      taskId: data.taskId,
      status: false,
    });
  } finally {
    window.close();
  }
}
