"use strict";

/** 进度只更新当前记录，不代表终结或允许重发。 */
export function resolvePublishProgress(payload) {
  if (!payload || !["waiting_confirmation", "verifying"].includes(payload.phase)) return null;
  const waiting = payload.phase === "waiting_confirmation";
  return {
    recordStatus: waiting ? "waiting_confirmation" : "publishing",
    message: payload.message || (waiting ? "等待平台确认" : "正在核验发布结果"),
  };
}

/** 将平台自动化回执统一为 CLI / HTTP / MCP 可消费的结果。 */
export function resolvePublishCompletion(payload) {
  const ok = Boolean(payload && payload.status === true);
  const fallbackDraft = Boolean(
    ok &&
      payload.needsAttention === true &&
      // draft_saved：视频号链接添加失败等已确认存草稿但需人工跟进的场景；
      // draft_unverified：存草稿后页面无成功/失败信号，无法确认是否保存成功（#42）
      (payload.outcome === "draft_saved" ||
        payload.outcome === "draft_unverified")
  );
  const waitingConfirmation = Boolean(ok && payload.outcome === "waiting_confirmation");
  const publishUnverified = Boolean(
    ok && (payload.outcome === "publish_unverified" ||
      (["公众号", "微信公众号"].includes(payload.pt) && payload.publishMode !== "draft" &&
       payload.publishToDraft !== true && payload.publishVerified !== true))
  );
  const message = (payload && payload.message) ||
    (waitingConfirmation ? "等待平台扫码或安全确认，请核对原任务，勿重复发布" :
      publishUnverified ? "尚未核验发表结果，请到平台核查，勿重复发布" :
        ok ? "上传成功" : "上传失败");
  const needsAttention = fallbackDraft || waitingConfirmation || publishUnverified;
  // 发布成功后平台会自动跳成功页；5 秒后地址未变化时主进程标记 publishAbnormal，
  // 这里统一降级为「发布异常」，避免当成成功。
  const publishAbnormal = Boolean(ok && payload.publishAbnormal === true);
  const savedAsDraft = Boolean(
    ok &&
      !publishAbnormal && !waitingConfirmation && !publishUnverified &&
      (fallbackDraft ||
        payload.publishMode === "draft" ||
        payload.publishToDraft === true)
  );
  const draftUnverified = Boolean(ok && payload.draftUnverified === true);
  // 登录态失效：不是内容/流程失败，需要人重新扫码。单独给一个状态和退出码，
  // 让流水线能区分「该重试/该补登录」和「内容有问题」。
  const loginRequired = Boolean(payload && payload.loginRequired === true);
  return {
    ok,
    message,
    fallbackDraft,
    publishAbnormal,
    savedAsDraft,
    // 存草稿结果无法核验（抖音/快手网页端无草稿箱）：点击成功但草稿不存在于任何地方。
    // 这里不降级成失败（不触发自动重试，避免重复发布），只把语义说清楚。
    draftUnverified,
    loginRequired,
    waitingConfirmation,
    needsAttention,
    recordStatus: loginRequired
      ? "login_required"
      : waitingConfirmation
        ? "waiting_confirmation"
        : publishUnverified || publishAbnormal
        ? "abnormal"
        : savedAsDraft
          ? "draft"
          : ok
            ? "success"
            : "failed",
    status: loginRequired
      ? "login_required"
      : waitingConfirmation || publishUnverified
        ? "needs_attention"
        : publishAbnormal
        ? "publish_abnormal"
        : fallbackDraft
          ? "needs_attention"
          : savedAsDraft
            ? "draft"
            : ok
              ? "success"
              : "failed",
    exitCode: loginRequired
      ? 5
      : needsAttention || publishAbnormal
        ? 4
        : fallbackDraft
          ? 4
          : ok
            ? 0
            : 3,
  };
}
