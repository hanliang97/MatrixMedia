"use strict";

/** 将平台自动化回执统一为 CLI / HTTP / MCP 可消费的结果。 */
export function resolvePublishCompletion(payload) {
  const ok = Boolean(payload && payload.status === true);
  const message =
    (payload && payload.message) || (ok ? "上传成功" : "上传失败");
  const fallbackDraft = Boolean(
    ok &&
      payload.needsAttention === true &&
      payload.outcome === "draft_saved"
  );
  // 发布成功后平台会自动跳成功页；5 秒后地址未变化时主进程标记 publishAbnormal，
  // 这里统一降级为「发布异常」，避免当成成功。
  const publishAbnormal = Boolean(ok && payload.publishAbnormal === true);
  const savedAsDraft = Boolean(
    ok &&
      !publishAbnormal &&
      (fallbackDraft ||
        payload.publishMode === "draft" ||
        payload.publishToDraft === true)
  );
  return {
    ok,
    message,
    fallbackDraft,
    publishAbnormal,
    savedAsDraft,
    recordStatus: publishAbnormal
      ? "abnormal"
      : savedAsDraft
        ? "draft"
        : ok
          ? "success"
          : "failed",
    status: publishAbnormal
      ? "publish_abnormal"
      : fallbackDraft
        ? "needs_attention"
        : savedAsDraft
          ? "draft"
          : ok
            ? "success"
            : "failed",
    exitCode: publishAbnormal ? 4 : fallbackDraft ? 4 : ok ? 0 : 3,
  };
}
