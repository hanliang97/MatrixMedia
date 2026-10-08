"use strict";

/**
 * 视频号「可挂载实体列表」归一化与分页编排（小程序短剧 / 视频号剧集）。
 *
 * 数据源：发布页选择弹窗的同族接口
 *   /micro/content/cgi-bin/mmfinderassistant-bin/post/search_drama_component（短剧，已抓包验证）
 *   /micro/content/cgi-bin/mmfinderassistant-bin/post/search_series_component（剧集，同族推测，待实测）
 * 空关键词即返回默认列表，currentPage / pageSize 分页。
 *
 * 本模块不依赖 electron，分页合并逻辑可纯 Node 单测；
 * 主进程服务（sphEntityOptions.js）只负责会话校验与 HTTP 收发。
 *
 * 响应字段名没有公开文档，按多候选键容错提取；平台改版时只需调整
 * 下面的候选表（每项保留 raw，便于对照真实响应排查）。
 */

/** 两类实体的接口配置：平台改版 / 路径修正只需改这里 */
export const ENTITY_LIST_CONFIG = {
  drama: {
    // 已抓包验证（发布页「选择需要关联的短剧」弹窗数据源）
    path: "/micro/content/cgi-bin/mmfinderassistant-bin/post/search_drama_component",
    label: "短剧",
    ipcChannel: "sph:list-dramas",
  },
  series: {
    // 按短剧同族路径推测，未实测；若报错按 docs/sph-links.md 排查清单抓包后改这里
    path: "/micro/content/cgi-bin/mmfinderassistant-bin/post/search_series_component",
    label: "剧集",
    ipcChannel: "sph:list-series",
  },
};

export const ENTITY_LIST_DEFAULT_PAGE_SIZE = 20;
/** 分页上限保护：20 × 10 = 200 条，覆盖绝大多数账号 */
export const ENTITY_LIST_DEFAULT_MAX_PAGES = 10;

/** 从响应里挑出实体行数组（兼容 data 包裹与根级平铺） */
export function pickEntityRows(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : {};
  const lists = [
    data.list,
    data.dramaList,
    data.seriesList,
    data.componentList,
    data.itemList,
    data.items,
    root.list,
    root.dramaList,
    root.seriesList,
    root.componentList,
  ];
  for (const list of lists) {
    if (Array.isArray(list) && list.length) return list;
  }
  return [];
}

/** 实体名称：短剧/剧集在弹窗里展示的主文案，挂载自动化也按它匹配 */
export function pickEntityName(item) {
  const candidates = [
    item && item.name,
    item && item.title,
    item && item.dramaName,
    item && item.drama_name,
    item && item.seriesName,
    item && item.series_name,
    item && item.showName,
    item && item.show_name,
    item && item.nickName,
    item && item.nick_name,
  ];
  for (const value of candidates) {
    const name = String(value == null ? "" : value).trim();
    if (name) return name;
  }
  return "";
}

/** 副标题（小程序名 / 来源名等），用于在同名短剧间做区分 */
export function pickEntitySubTitle(item) {
  const candidates = [
    item && item.appName,
    item && item.app_name,
    item && item.miniProgramName,
    item && item.wxaAppName,
    item && item.sourceName,
    item && item.source_name,
    item && item.appid,
  ];
  for (const value of candidates) {
    const sub = String(value == null ? "" : value).trim();
    if (sub) return sub;
  }
  return "";
}

export function pickEntityCover(item) {
  const candidates = [
    item && item.coverUrl,
    item && item.cover_url,
    item && item.cover,
    item && item.imgUrl,
    item && item.img_url,
    item && item.thumb,
    item && item.headImg,
    item && item.head_img,
  ];
  for (const value of candidates) {
    const url = String(value == null ? "" : value).trim();
    if (url) return url;
  }
  return "";
}

/**
 * 归一化一页响应为实体选项数组（按名称去重，无名称的行丢弃）。
 * @returns {Array<{name: string, title: string, subTitle: string, cover: string, raw: object}>}
 */
export function normalizeSphEntityOptions(payload) {
  const rows = pickEntityRows(payload);
  const entities = [];
  const seen = new Set();
  for (const item of rows) {
    const name = pickEntityName(item);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entities.push({
      name,
      title: name,
      subTitle: pickEntitySubTitle(item),
      cover: pickEntityCover(item),
      raw: item,
    });
  }
  return entities;
}

/**
 * 是否继续拉下一页（纯函数）。
 * 停止条件：显式 continueFlag 为假 / 本页为空 / 本页不满页。
 */
export function shouldFetchNextEntityPage(payload, pageRowCount, pageSize) {
  if (!Number.isFinite(pageRowCount) || pageRowCount <= 0) return false;
  if (pageRowCount < pageSize) return false;
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const flag = data.continueFlag != null ? data.continueFlag : root.continueFlag;
  if (flag === false || flag === 0 || flag === "0") return false;
  if (flag === true || flag === 1 || flag === "1") return true;
  // 无显式标记且满页：按还有下一页处理（另有 maxPages 与"无新增"双保险）
  return true;
}

/** 请求体构造（与发布页抓包一致；_log_finder_id 置空，同族 post_list 已验证可行） */
export function buildSphEntityPageBody(currentPage, pageSize, now) {
  return {
    currentPage,
    pageSize,
    timestamp: String(now == null ? Date.now() : now),
    _log_finder_uin: "",
    _log_finder_id: "",
    rawKeyBuff: "",
    pluginSessionId: null,
    scene: 7,
    reqScene: 7,
  };
}

/** 响应信封检查：mmfinderassistant-bin 族用 errCode/errMsg，返回 "" 表示正常 */
export function sphEntityEnvelopeError(payload) {
  if (!payload || typeof payload !== "object" || !("errCode" in payload)) {
    return "";
  }
  const code = Number(payload.errCode);
  if (!Number.isFinite(code) || code === 0) return "";
  return String(payload.errMsg || payload.errmsg || `errCode=${code}`);
}

/**
 * 分页拉全量并合并（去重、防死循环）。
 *
 * @param {(currentPage: number, pageSize: number) => Promise<object>} fetchPage
 *        拉取单页并返回解析后的 JSON；HTTP/传输层错误由调用方在 fetchPage 内处理
 * @returns {Promise<{ entities: Array, pages: number, envelopeError: string,
 *                     unknownRowKeys: string[] }>}
 */
export async function collectSphEntityOptions(
  fetchPage,
  { pageSize, maxPages } = {}
) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : ENTITY_LIST_DEFAULT_PAGE_SIZE;
  const cap = Number(maxPages) > 0 ? Number(maxPages) : ENTITY_LIST_DEFAULT_MAX_PAGES;

  const entities = [];
  const seen = new Set();
  let unknownRowKeys = [];
  let pages = 0;

  for (let currentPage = 1; currentPage <= cap; currentPage++) {
    const payload = await fetchPage(currentPage, size);
    pages += 1;

    const envelopeError = sphEntityEnvelopeError(payload);
    if (envelopeError) return { entities, pages, envelopeError, unknownRowKeys };

    const pageOptions = normalizeSphEntityOptions(payload);
    const pageRowCount = pickEntityRows(payload).length;

    // 诊断：接口返回了行但一个都认不出来 → 记录首行字段名，便于按真实响应调候选表
    if (pageRowCount > 0 && pageOptions.length === 0 && !unknownRowKeys.length) {
      unknownRowKeys = Object.keys(pickEntityRows(payload)[0] || {});
    }

    let added = 0;
    for (const item of pageOptions) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      entities.push(item);
      added += 1;
    }

    if (!shouldFetchNextEntityPage(payload, pageRowCount, size)) break;
    if (added === 0) break; // 满页但无新增：平台忽略页码循环返回，防死循环
  }

  return { entities, pages, envelopeError: "", unknownRowKeys };
}
