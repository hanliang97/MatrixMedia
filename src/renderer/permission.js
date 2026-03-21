import router from "./router";
import Performance from "@/tools/performance";
import { usePermissionStore } from "@/store/permission";
import dataRequest from "@/utils/dataRequest";
let addRoute = false;
export function usePermission() {
  let end = null;
  router.beforeEach(async (to, from, next) => {
    end = Performance.startExecute(`${from.path} => ${to.path} 路由耗时`); /// 路由性能监控
    if (!addRoute) {
      const { GenerateRoutes } = usePermissionStore();
      await GenerateRoutes();
      dataRequest({
        fileName: "config",
        type: "config",
        item: {
          action: "get",
        },
      }).then(res => {
        localStorage.setItem("config", JSON.stringify(res.data));
      });
      addRoute = true;
    }
    next();
    setTimeout(() => {
      end();
    }, 0);
  });
}
