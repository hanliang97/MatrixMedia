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
  const savedAsDraft = Boolean(
    ok &&
      (fallbackDraft ||
        payload.publishMode === "draft" ||
        payload.publishToDraft === true)
  );
  return {
    ok,
    message,
    fallbackDraft,
    savedAsDraft,
    recordStatus: savedAsDraft ? "draft" : ok ? "success" : "failed",
    status: fallbackDraft
      ? "needs_attention"
      : savedAsDraft
        ? "draft"
        : ok
          ? "success"
          : "failed",
    exitCode: fallbackDraft ? 4 : ok ? 0 : 3,
  };
}
