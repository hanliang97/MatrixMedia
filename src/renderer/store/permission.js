import { defineStore } from "pinia";
import Layout from "@/layout";
import { ipcRenderer } from "electron";
import router from "@/router";
import VueRouter from "vue-router";


// 引入路由表
import { constantRouterMap } from "@/router";

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
      .then(r => {
        let endData = {};

        for (let item in r.data) {
          let v = r.data[item];
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

            ipcRenderer.send("getCookie", {
              taskId,
              partition,
              url: i.url,
              pt: i.pt,
              name: `${i.phone.split('-')[0]}${i.pt}登录`,
            });
            // 建立一个任务监听池
            const taskHandlers = new Map();
            ipcRenderer.on("getCookie-done", (event, data) => {
              const { taskId } = data;
              const handler = taskHandlers.get(taskId);
              if (handler) {
                handler(data);
                taskHandlers.delete(taskId); // 一次性任务，用完移除
              }
            });
            taskHandlers.set(taskId, data => {
              if (data.success) {
                document.cookie = data.result;
              } else {
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
