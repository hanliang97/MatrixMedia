import { defineStore } from "pinia";
import Layout from "@/layout";
import { ipcRenderer } from "electron";
import router from "@/router";
import VueRouter from "vue-router";


// 引入路由表
import { constantRouterMap } from "@/router";
import {
  setAccountLoginFlag,
  clearAccountLoginFlag,
} from "@/utils/accountLoginFlag";

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

function addFetchRoute(routes) {
  return new Promise(resolve => {
    fetch("http://localhost:30088/changeData", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "get",
        fileName: "account",
        pageSize: 9999,
      }),
    })
      .then(r => r.json())
      .catch(err => {
        console.error("[permission] 拉取账号路由失败:", err);
        return {};
      })
      .then(r => {
        let endData = {};
        const payload = r && typeof r === "object" ? r : {};
        const raw =
          payload.data != null &&
          typeof payload.data === "object" &&
          !Array.isArray(payload.data)
            ? payload.data
            : {};

        for (let item in raw) {
          let v = raw[item];
          v.forEach(i => {
            if (!endData[i.phone]) {
              endData[i.phone] = {
                path: "/accountManager/" + i.phone,
                name: `accountManager-${i.phone}`,
                component: Layout,
                redirect: "accountManager",
                meta: { title: i.phone },
                children: [
                  {
                    path: i.pt,
                    name: `${i.phone}-${i.pt}`,
                    component: () => import("@/views/accountManager/index"),
                    meta: { title: i.pt, ...i, date: item },
                  },
                ],
              };
            } else {
              endData[i.phone].children.push({
                path: i.pt,
                name: `${i.phone}-${i.pt}`,
                component: () => import("@/views/accountManager/index"),
                meta: { title: i.pt, ...i, date: item },
              });
            }
            const taskId = Date.now() + Math.random(); // 更唯一些
            const partition = "persist:" + i.phone.split('-')[0] + i.pt;

            ensureGetCookieDoneListener();
            ipcRenderer.send("getCookie", {
              taskId,
              partition,
              url: i.url,
              pt: i.pt,
              name: `${i.phone.split('-')[0]}${i.pt}登录`,
            });
            getCookieTaskHandlers.set(taskId, data => {
              const flagName = data.flagName || `${i.phone.split("-")[0]}${i.pt}登录`;
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
                console.error(`[${i.phone}${i.pt}] 登录状态失败:`, data.error);
              }
            });
          });
        }
        for (let i in endData) {
          let r = endData[i];
          routes.push(r);
        }
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
      return new Promise(async resolve => {
        let accessedRouters = [];
        accessedRouters = await addFetchRoute(accessedRouters);
        
        // Vue Router 3.x 没有 removeRoute 方法，需要重置路由器
        // 创建一个新的路由器实例来获取新的 matcher
        const newRouter = new VueRouter({
          routes: constantRouterMap
        });
        
        // 替换当前路由器的 matcher
        router.matcher = newRouter.matcher;
        
        // 添加新的动态路由
        accessedRouters.forEach(item => {
          router.addRoute(item);
        });
        
        this.routers = constantRouterMap.concat(accessedRouters);
        resolve(this.routers);
      });
    }
  },
});
