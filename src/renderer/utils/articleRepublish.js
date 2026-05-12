export function parseArticleTags(raw) {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function buildArticleRepublishState(record = {}) {
  return {
    articleFilePath: record.articleFilePath || "",
    coverPath: record.coverPath || "",
    form: {
      title: (record.bt || record.title || record.textOtherName || record.bookName || "").trim(),
      content: record.content || "",
      category: (record.category || "前端").trim() || "前端",
      summary: (record.summary || "").trim(),
    },
    tags: parseArticleTags(record.bq || record.tags || "前端 electron"),
  };
}
