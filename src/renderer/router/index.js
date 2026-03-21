import Router from "vue-router";
import Layout from "@/layout";
export const constantRouterMap = [
  {
    path: "/",
    component: Layout,
    redirect: "/",
    hidden: true,
    children: [
      {
        path: "/",
        name: "视频管理",
        component: () => import("@/views/videoManager/index"),
        meta: { noSlide: true },
      },
    ],
  },
  {
    path: "*",
    component: () => import("@/views/404"),
    hidden: true,
  },
];


const createRouter = () =>
  new Router({
    scrollBehavior: () => ({ y: 0 }),
    routes: constantRouterMap,
  });

export function resetRouter() {
  const newRouter = createRouter();
  router.matcher = newRouter.matcher;
}
const router = createRouter();

export default router;
