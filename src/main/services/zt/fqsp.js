/**
 * 番茄视频：发布状态查询（占位）
 * 作品列表页与标题匹配规则待后续补齐。
 */
export default async function (page, data, window, event) {
  console.log("[fqsp] 番茄视频审核状态查询尚未实现", data?.bt || data?.title);
  event.reply("puppeteerFile-done", {
    taskId: data.taskId,
    status: false,
  });
  window.close();
}
