"use strict";

function normStr(value) {
  return String(value == null ? "" : value).trim();
}

function fileBaseName(filePath) {
  const s = normStr(filePath).replace(/\\/g, "/");
  if (!s) return "";
  const parts = s.split("/");
  return parts[parts.length - 1] || "";
}

function sameAccount(entry, query) {
  const ePart = normStr(entry.partition);
  const qPart = normStr(query.partition);
  if (ePart && qPart) {
    if (ePart === qPart) return true;
  }
  const ePhone = normStr(entry.phone);
  const qPhone = normStr(query.phone);
  if (ePhone && qPhone && ePhone === qPhone) return true;
  // 历史记录 phone 可能带分组后缀，对比 partition 去掉 persist: 和平台后缀
  if (ePart && qPhone && ePart.includes(qPhone)) return true;
  if (qPart && ePhone && qPart.includes(ePhone)) return true;
  return false;
}

function sameContent(entry, query) {
  const eFile = normStr(entry.selectedFile) || fileBaseName(entry.filePath);
  const qFile = normStr(query.selectedFile) || fileBaseName(query.filePath);
  if (eFile && qFile && eFile === qFile) return true;

  const eOther = normStr(entry.textOtherName);
  const qOther = normStr(query.textOtherName);
  if (eOther && qOther && eOther === qOther) return true;

  const eBook = normStr(entry.bookName);
  const qBook = normStr(query.bookName);
  if (eBook && qBook && eBook === qBook) return true;

  const eTitle = normStr(entry.title);
  const qTitle = normStr(query.title);
  if (eTitle && qTitle && eTitle === qTitle) return true;

  return false;
}

/**
 * 从当前活跃发布窗口列表中，按优先级匹配目标记录对应的窗口条目：
 * 1. recordId 精确匹配
 * 2. taskId 精确匹配
 * 3. 同平台 + 同账号 + 同文件/标题匹配
 * 4. 同平台 + 同账号下唯一运行中的发布窗口兜底
 *
 * @param {Array<object>} entries
 * @param {object} query
 * @returns {object | null}
 */
export function matchPublishWindowEntry(entries, query) {
  if (!Array.isArray(entries) || !entries.length || !query) return null;

  const qRecordId = normStr(query.recordId || query.id);
  if (qRecordId) {
    const byRecord = entries.find(
      (e) => e && normStr(e.recordId) === qRecordId
    );
    if (byRecord) return byRecord;
  }

  const qTaskId = normStr(query.taskId);
  if (qTaskId) {
    const byTask = entries.find((e) => e && normStr(e.taskId) === qTaskId);
    if (byTask) return byTask;
  }

  const qPt = normStr(query.pt);
  const ptPool = qPt
    ? entries.filter((e) => e && normStr(e.pt) === qPt)
    : entries.filter(Boolean);
  if (!ptPool.length) return null;

  const accountPool = ptPool.filter((e) => sameAccount(e, query));
  const byAccountAndContent = accountPool.find((e) => sameContent(e, query));
  if (byAccountAndContent) return byAccountAndContent;

  if (accountPool.length === 1) return accountPool[0];

  const byContentOnly = ptPool.find((e) => sameContent(e, query));
  if (byContentOnly) return byContentOnly;

  return null;
}

/**
 * 从视频管理列表的一行主记录与平台子记录组装查询条件。
 */
export function buildPublishWindowQuery(row, sub) {
  const s = sub || {};
  const r = row || {};
  return {
    recordId: normStr(s.id || r.id),
    pt: normStr(s.pt || r.pt),
    partition: normStr(s.partition || r.partition),
    phone: normStr(s.phone || r.phone),
    selectedFile: normStr(s.selectedFile || r.selectedFile),
    filePath: normStr(s.filePath || r.filePath),
    textOtherName: normStr(s.textOtherName || r.textOtherName),
    bookName: normStr(s.bookName || r.bookName),
    title: normStr(s.title || s.bt || r.title || r.bt),
  };
}
