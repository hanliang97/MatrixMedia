"use strict";

/**
 * 作品标题归一化与匹配工具（供 CLI stats-work 与本地 HTTP /stats/work 共用）。
 *
 * 背景：抖音创作平台 work_list 接口返回的 it.description 往往是
 * 「标题 简介 #话题1 #话题2」拼接串（可达 200+ 字），
 * 此前直接做 w.title === queryTitle 全等匹配会导致所有带简介/话题的抖音视频必定漏查。
 */

export function normalizeWorkTitle(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 在作品列表中按标题查找对应作品（列表默认按发布时间倒序）：
 * 1) 优先精确匹配归一化后的 w.title 或 w.itemTitle；
 * 2) 若查询串不少于 4 个 Unicode 码点，回退边界感知前缀匹配：
 *    w.title 以 query 开头，且紧随其后为字符串末尾、空白或 '#'，
 *    避免短词（如 "AI"）误匹配 "AI工具..."。
 */
export function findWorkByTitle(works, queryTitle) {
  const list = Array.isArray(works) ? works : [];
  const query = normalizeWorkTitle(queryTitle);
  if (!query) return null;

  // 1. 精确匹配（title 或 itemTitle）
  const exact = list.find((w) => {
    if (!w) return false;
    if (normalizeWorkTitle(w.title) === query) return true;
    if (w.itemTitle && normalizeWorkTitle(w.itemTitle) === query) return true;
    return false;
  });
  if (exact) return exact;

  // 2. 边界感知前缀匹配（兼容抖音「标题 简介 #话题」拼接存储）
  if (Array.from(query).length < 4) return null;
  const boundaryMatch = list.find((w) => {
    if (!w) return false;
    const wt = normalizeWorkTitle(w.title);
    if (!wt.startsWith(query)) return false;
    if (wt.length === query.length) return true;
    const nextChar = wt.slice(query.length, query.length + 1);
    return /^[\s#]$/.test(nextChar);
  });
  return boundaryMatch || null;
}
