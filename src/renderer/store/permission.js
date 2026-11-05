import { defineStore } from "pinia";
import Layout from "@/layout";
import { ipcRenderer } from "electron";
import router from "@/router";
import VueRouter from "vue-router";

import { constantRouterMap } from "@/router";
import dataRequest from "@/utils/dataRequest";
import {
  setAccountLoginFlag,
  clearAccountLoginFlag,
} from "@/utils/accountLoginFlag";
import {
  buildGroupOrderMap,
  sortGroupRoutes,
} from "../../shared/accountGroupOrder.js";
import {
  buildAccountPartitionOf,
  accountLoginFlagNameOf,
  recordGroupOf,
  recordAccountKeyOf,
} from "../../shared/accountIdentity.js";

const getCookieTaskHandlers = new Map();
let getCookieListenerBound = false;

function ensureGetCookieDoneListener() {
  if (getCookieListenerBound) return;
  getCookieListenerBound = true;
  ipcRenderer.on("getCookie-done", (event, data) => {
    const { taskId } = data;
    const handler = getCookieTaskHandlers.get(taskId);
    if (handler) {
      handler(data);
      getCookieTaskHandlers.delete(taskId);
    }
  });
}

/**
 * 拉取账号数据，失败自动重试。
 *
 * 窗口刚启动时内置服务（30088）可能尚未就绪，首次请求会失败；
 * 不重试会导致读到空列表、整个会话都无法进入媒体平台管理。
 * 统一走 dataRequest（自动附内置服务令牌），重试只是包在它外面。
 */
function fetchAccountsWithRetry(retryLeft = 10, intervalMs = 800) {
  return dataRequest({
    type: "get",
    fileName: "account",
    pageSize: 9999,
  }).then((r) => {
    const ok = r && typeof r === "object" && r.data != null;
    if (!ok && retryLeft > 0) {
      return new Promise((resolve) =>
        setTimeout(resolve, intervalMs)
      ).then(() => fetchAccountsWithRetry(retryLeft - 1, intervalMs));
    }
    return r;
  });
}

function addFetchRoute(routes) {
  return new Promise((resolve) => {
    // 统一走 dataRequest：自动附内置服务令牌（打包下无 Origin 也能过守卫）
    fetchAccountsWithRetry()
      .then((r) => {
        const endData = {};
        const payload = r && typeof r === "object" ? r : {};
        const raw =
          payload.data != null &&
          typeof payload.data === "object" &&
          !Array.isArray(payload.data)
            ? payload.data
            : {};
        const groupOrderMap = buildGroupOrderMap(raw);

        for (const item in raw) {
          const v = raw[item];
          v.forEach((i) => {
            if (!i || !i.phone) return;
            // 新分组模型：侧边栏分组 = group 字段（回退历史 phone "-" 前缀），
            // 同一分组可挂多个同平台账号（各自独立登录分区）
            const group = recordGroupOf(i);
            if (!group) return;
            if (!endData[group]) {
              endData[group] = {
                path: "/accountManager/" + group,
                name: `accountManager-${group}`,
                component: Layout,
                redirect: "accountManager",
                meta: {
                  title: group,
                  phone: group,
                  groupOrder: groupOrderMap[group],
                },
                children: [],
              };
            }
            // 子路由 path：同分组首个该平台账号保留纯平台 path（兼容旧链接），
            // 后续同平台多账号按 accountKey 追加，避免路径冲突
            const groupNode = endData[group];
            const hasSamePt = groupNode.children.some(
              (child) => (child.meta && child.meta.pt) === i.pt
            );
            const accountKey = recordAccountKeyOf(i);
            const childPath = hasSamePt ? `${i.pt}-${accountKey || i.id}` : i.pt;
            groupNode.children.push({
              path: childPath,
              name: `accountManager-${group}-${i.id || accountKey}-${i.pt}`,
              component: () => import("@/views/accountManager/index"),
              // group 放在展开之后：保证 meta.group 恒为派生分组名
              meta: { title: i.pt, ...i, group, date: item },
            });
            const taskId = Date.now() + Math.random();
            const partition = buildAccountPartitionOf(i, i.pt);

            ensureGetCookieDoneListener();
            ipcRenderer.send("getCookie", {
              taskId,
              partition,
              url: i.url,
              pt: i.pt,
              name: accountLoginFlagNameOf(i, i.pt),
            });
            getCookieTaskHandlers.set(taskId, (data) => {
              const flagName =
                data.flagName || accountLoginFlagNameOf(i, i.pt);
              if (data.success) {
                if (data.result) {
                  setAccountLoginFlag(flagName, data.loginExpiresAtMs);
                  try {
                    document.cookie = data.result;
                  } catch (e) {
                    /* file:// 下 document.cookie 常不可用 */
                  }
                } else {
                  clearAccountLoginFlag(flagName);
                }
              } else {
                clearAccountLoginFlag(flagName);
                console.error(`[${accountKey}${i.pt}] 登录状态失败:`, data.error);
              }
            });
          });
        }

        const sortedRoutes = sortGroupRoutes(
          Object.values(endData),
          groupOrderMap
        );
        sortedRoutes.forEach((route) => {
          routes.push(route);
        });
        // 数据统计模块：与媒体平台管理同源的「分组 → 平台」二级导航（顺序一致）
        sortedRoutes.forEach((route) => {
          const phone = route.meta && route.meta.phone;
          if (!phone) return;
          const statsChildren = (route.children || [])
            .map((child) => {
              const pt = child.meta && child.meta.pt;
              if (!pt) return null;
              return {
                path: pt,
                name: `dataStats-${phone}-${pt}`,
                component: () => import("@/views/dataStats/group"),
                meta: { title: pt, phone, pt },
              };
            })
            .filter(Boolean)
            // 同分组同平台多账号共享一份（分组 × 平台）统计数据，路由去重
            .filter(
              (child, idx, arr) =>
                arr.findIndex((c) => c.path === child.path) === idx
            );
          routes.push({
            path: "/data-stats/group/" + phone,
            name: `dataStats-${phone}`,
            component: Layout,
            meta: {
              navModule: "dataStats",
              title: phone,
              phone,
              groupOrder: route.meta.groupOrder,
            },
            children: statsChildren,
          });
        });
        localStorage.setItem("accountTree", JSON.stringify(endData));

        resolve(routes);
      });
  });
}

export const usePermissionStore = defineStore({
  id: "permission",
  state: () => ({
    routers: [],
  }),
  actions: {
    GenerateRoutes() {
      return new Promise(async (resolve) => {
        let accessedRouters = [];
        accessedRouters = await addFetchRoute(accessedRouters);

        const newRouter = new VueRouter({
          routes: constantRouterMap,
        });

        router.matcher = newRouter.matcher;

        accessedRouters.forEach((item) => {
          router.addRoute(item);
        });

        this.routers = constantRouterMap.concat(accessedRouters);

        const { fullPath } = router.currentRoute;
        if (fullPath && fullPath !== "/") {
          const resolved = router.resolve(fullPath);
          if (resolved.route.matched.length) {
            router.replace(fullPath).catch(() => {});
          }
        }

        resolve(this.routers);
      });
    },
  },
});
