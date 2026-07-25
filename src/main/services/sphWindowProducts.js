"use strict";

import axios from "axios";
import {
  SPH_ORIGIN,
  hasSphSession,
  normalizeSphPartition,
} from "./cliLogin/sphSessionUtil.js";
import { normalizeSphWindowProducts } from "../../shared/sphWindowProductList.js";

export { normalizeSphWindowProducts };

const LIST_URL =
  "https://channels.weixin.qq.com/shop-faas/mmecfinderassistantnode/live/cgi/get_all_window_products?_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Fmicro%2Fcontent%2Fpost%2Fcreate";

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
async function requestWindowProducts(partition, body, sessionFactory) {
  const cookie = await buildCookieHeader(partition, sessionFactory);
  if (!cookie) {
    const error = new Error("视频号登录 Cookie 为空，请重新登录");
    error.code = "empty_cookie";
    throw error;
  }
  const response = await axios.post(LIST_URL, body, {
    headers: {
      accept: "*/*",
      "content-type": "application/json",
      Origin: SPH_ORIGIN,
      Referer: "https://channels.weixin.qq.com/micro/content/post/create",
      Cookie: cookie,
    },
    timeout: 20000,
    validateStatus: () => true,
  });
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.data,
  };
}

export async function listSphWindowProducts(
  partition,
  { fetchImpl, sessionFactory, hasSessionImpl } = {}
) {
  const part = normalizeSphPartition(partition);
  if (!part) {
    return { ok: false, error: "缺少视频号账号 partition", products: [] };
  }

  const checkSession =
    typeof hasSessionImpl === "function" ? hasSessionImpl : hasSphSession;
  const loggedIn = await checkSession(part);
  if (!loggedIn) {
    return {
      ok: false,
      error: "视频号未登录或登录已失效，请先重新登录",
      products: [],
    };
  }

  const body = {
    status: 1,
    lastBuffer: "",
    notNeedTestProduct: 1,
    miniAppsVersion: 2,
    order: 1,
    orderType: 2,
    branchId: 0,
    notNeedProductOn: 0,
    sourceType: 1,
    fromScene: 2,
    timestamp: String(Date.now()),
    _log_finder_uin: "",
    rawKeyBuff: "",
    pluginSessionId: null,
    scene: 7,
    reqScene: 7,
  };

  try {
    const fetcher =
      fetchImpl ||
      ((url, init) =>
        requestWindowProducts(part, JSON.parse(init.body), sessionFactory)
      );

    const response = await fetcher(LIST_URL, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        Origin: SPH_ORIGIN,
        Referer:
          "https://channels.weixin.qq.com/micro/content/post/create",
      },
      body: JSON.stringify(body),
    });

    if (!response || typeof response.json !== "function") {
      return { ok: false, error: "橱窗商品接口响应无效", products: [] };
    }
    if (response.ok === false) {
      return {
        ok: false,
        error: `橱窗商品接口失败（HTTP ${response.status || "?"}）`,
        products: [],
      };
    }

    const payload = await response.json();
    const products = normalizeSphWindowProducts(payload);
    return { ok: true, products, raw: payload };
  } catch (error) {
    return {
      ok: false,
      error:
        (error && error.message) ||
        String(error || "拉取橱窗商品失败"),
      products: [],
    };
  }
}

export function registerSphWindowProductsIpc(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== "function") return;
  ipcMain.handle("sph:list-window-products", async (_event, args = {}) => {
    return listSphWindowProducts(args.partition || args.part || "");
  });
}
