"use strict";

import axios from "axios";
import {
  SPH_ORIGIN,
  hasSphSession,
  normalizeSphPartition,
} from "./cliLogin/sphSessionUtil.js";
import {
  ENTITY_LIST_CONFIG,
  buildSphEntityPageBody,
  collectSphEntityOptions,
} from "../../shared/sphEntityOptions.js";

export { ENTITY_LIST_CONFIG };

/**
 * 视频号「可挂载实体列表」拉取服务（小程序短剧 / 视频号剧集）。
 *
 * 与橱窗商品（sphWindowProducts.js）同一思路：主进程用 partition cookie
 * 直调平台接口，不走发布页。接口属 mmfinderassistant-bin 同族，
 * 该族（post_list 等）已验证 bare cookie 可用，无需 X-WECHAT-UIN / _aid。
 *
 * 平台行为：空关键词即返回默认列表，currentPage / pageSize 分页；
 * GUI 拿到全量后由 el-select filterable 做本地搜索。
 *
 * 分页编排与归一化在 shared/sphEntityOptions.js（无 electron 依赖，可单测），
 * 本模块只负责会话校验与 HTTP 收发。
 */

const POST_CREATE_URL = "https://channels.weixin.qq.com/micro/content/post/create";

function getElectronSession() {
  // 延迟加载，避免纯 Node 单测 import 时拉起 electron。
  return require("electron").session;
}

async function buildCookieHeader(partition, sessionFactory) {
  const ses =
    typeof sessionFactory === "function"
      ? sessionFactory(partition)
      : getElectronSession().fromPartition(partition);
  const cookies = await ses.cookies.get({ url: SPH_ORIGIN });
  return (cookies || [])
    .filter((item) => item && item.name && item.value)
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

/** Electron 24 无 session.fetch；用 partition cookie + axios 代发。 */
async function requestEntityPage(partition, url, body, sessionFactory) {
  const cookie = await buildCookieHeader(partition, sessionFactory);
  if (!cookie) {
    const error = new Error("视频号登录 Cookie 为空，请重新登录");
    error.code = "empty_cookie";
    throw error;
  }
  const response = await axios.post(url, body, {
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      Origin: SPH_ORIGIN,
      Referer: POST_CREATE_URL,
      Cookie: cookie,
    },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.data;
}

/**
 * 拉取可挂载实体全量列表（自动翻页）。
 *
 * @param {string} partition 视频号账号 partition
 * @param {"drama"|"series"} kind
 * @returns {Promise<{ok: boolean, entities?: Array, error?: string}>}
 */
export async function listSphEntityOptions(
  partition,
  kind,
  { fetchPageImpl, sessionFactory, hasSessionImpl, pageSize, maxPages } = {}
) {
  const config = ENTITY_LIST_CONFIG[kind];
  if (!config) {
    return { ok: false, error: `未知的视频号实体类型：${kind}`, entities: [] };
  }
  const part = normalizeSphPartition(partition);
  if (!part) {
    return { ok: false, error: "缺少视频号账号 partition", entities: [] };
  }

  const checkSession =
    typeof hasSessionImpl === "function" ? hasSessionImpl : hasSphSession;
  const loggedIn = await checkSession(part);
  if (!loggedIn) {
    return {
      ok: false,
      error: "视频号未登录或登录已失效，请先重新登录",
      entities: [],
    };
  }

  const url = `${SPH_ORIGIN}${config.path}?_pageUrl=${encodeURIComponent(
    POST_CREATE_URL
  )}`;
  const fetchPage =
    typeof fetchPageImpl === "function"
      ? fetchPageImpl
      : (currentPage, size) =>
          requestEntityPage(
            part,
            url,
            buildSphEntityPageBody(currentPage, size),
            sessionFactory
          );

  try {
    const result = await collectSphEntityOptions(fetchPage, {
      pageSize,
      maxPages,
    });

    if (result.envelopeError) {
      return {
        ok: false,
        error: `${config.label}列表接口返回错误：${result.envelopeError}`,
        entities: [],
      };
    }
    if (result.unknownRowKeys.length) {
      console.log(
        `[sph][entity-list] ${config.label}行字段未识别，首行键: ${result.unknownRowKeys.join(",")}`
      );
    }
    console.log(
      `[sph][entity-list] ${config.label}列表拉取完成，共 ${result.entities.length} 条（${result.pages} 页）`
    );
    return { ok: true, entities: result.entities };
  } catch (error) {
    const status = error && error.status ? `（HTTP ${error.status}）` : "";
    return {
      ok: false,
      error: `${config.label}列表接口失败${status}：${
        (error && error.message) || error
      }`,
      entities: [],
    };
  }
}

export function registerSphEntityOptionsIpc(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== "function") return;
  for (const kind of Object.keys(ENTITY_LIST_CONFIG)) {
    const config = ENTITY_LIST_CONFIG[kind];
    ipcMain.handle(config.ipcChannel, async (_event, args = {}) =>
      listSphEntityOptions(args.partition || args.part || "", kind)
    );
  }
}
