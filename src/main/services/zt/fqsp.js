const VIDEO_LIST_URL =
  "https://pugc.yueduwuxian.com/fqvideo/home/video-list";

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, "").trim();
}

function resolveTitleKeyword(data) {
  return normalizeText(
    data.bt || data.title || data.textOtherName || data.bookName || ""
  );
}

function isPendingAuditStatus(statusText) {
  const text = normalizeText(statusText);
  return /审核中|待审核|审核未通过|未通过|驳回|违规|失败/.test(text);
}

function isPublishedStatus(statusText) {
  const text = normalizeText(statusText);
  if (!text) return false;
  if (isPendingAuditStatus(text)) return false;
  return /已发布|发布成功|已上线|公开|正常/.test(text);
}

function extractVideoId(metaText) {
  const match = String(metaText || "").match(/(\d{10,})/);
  return match ? match[1] : null;
}

async function ensureVideoListPage(page) {
  const currentUrl = page.url();
  if (currentUrl.includes("/fqvideo/home/video-list")) return;

  await page.goto(VIDEO_LIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
}

/**
 * 在作品列表页按标题查找视频及审核状态
 * @param {import("puppeteer-core").Page} page
 * @param {string} keyword
 */
async function findFqspVideoInfo(page, keyword) {
  const key = normalizeText(keyword);
  if (!key) return null;

  try {
    await page.waitForSelector(".video-card-title", { timeout: 15000 });
  } catch (error) {
    console.warn("[fqsp] 作品列表加载超时:", error?.message || error);
    return null;
  }

  const maxScrollTimes = 6;
  for (let i = 0; i < maxScrollTimes; i++) {
    const result = await page.evaluate(searchKey => {
      const normalize = text => String(text || "").replace(/\s+/g, "").trim();
      const cards = Array.from(document.querySelectorAll(".video-card"));

      for (const card of cards) {
        const titleEl = card.querySelector(".video-card-title");
        const title = normalize(titleEl && titleEl.textContent);
        if (!title || !title.includes(searchKey)) continue;

        const statusEl = card.querySelector(".video-status");
        const statusText = String(
          (statusEl && statusEl.textContent) || ""
        ).replace(/\s+/g, " ").trim();
        const metaEl = card.querySelector(".video-card-meta-id");
        const metaText = String(
          (metaEl && metaEl.textContent) || ""
        ).replace(/\s+/g, " ").trim();
        const idMatch = metaText.match(/(\d{10,})/);

        return {
          title: String((titleEl && titleEl.textContent) || "").trim(),
          statusText,
          id: idMatch ? idMatch[1] : "",
        };
      }

      return null;
    }, key);

    if (result) {
      const id = result.id || extractVideoId(result.statusText);
      return {
        title: result.title,
        id: id || "",
        statusText: result.statusText,
        status: isPublishedStatus(result.statusText),
        url: VIDEO_LIST_URL,
      };
    }

    await page.evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight, 800));
    });
    await page.waitForTimeout(1000);
  }

  return null;
}

export default async function (page, data, window, event) {
  console.log("[fqsp] 获取审核状态:", data?.bt || data?.title);
  await page.waitForTimeout(1000 * 3);

  try {
    await ensureVideoListPage(page);
  } catch (error) {
    console.warn("[fqsp] 跳转作品列表失败:", error?.message || error);
    event.reply("puppeteerFile-done", {
      taskId: data.taskId,
      status: false,
    });
    window.close();
    return;
  }

  const keyword = resolveTitleKeyword(data);
  const result = await findFqspVideoInfo(page, keyword);

  if (result) {
    console.log("[fqsp] 找到视频:", result);
    event.reply("puppeteerFile-done", {
      taskId: data.taskId,
      ...result,
    });
  } else {
    event.reply("puppeteerFile-done", {
      taskId: data.taskId,
      status: false,
    });
    console.log("[fqsp] 未找到指定视频:", keyword);
  }

  window.close();
}
