const VIDEOHAO_BT2_ALLOWED_REG = /^[\u4e00-\u9fa5A-Za-z0-9\s]+$/;
const VIDEOHAO_BT2_SANITIZE_REG = /[^\u4e00-\u9fa5A-Za-z0-9\s]/g;

export function sanitizeVideohaoBt2Input(value) {
  return String(value || "").replace(VIDEOHAO_BT2_SANITIZE_REG, "");
}

export function validateVideohaoBt2(value) {
  const bt2 = String(value || "").trim();
  if (!bt2) {
    return "发布视频号时，请填写概括短标题";
  }
  const len = Array.from(bt2).length;
  if (len < 6 || len > 16) {
    return "视频号概括短标题长度需为 6～16 字";
  }
  if (!VIDEOHAO_BT2_ALLOWED_REG.test(bt2)) {
    return "视频号概括短标题不能包含特殊标点符号";
  }
  return "";
}

export function isBt2SelectAllShortcut(event) {
  if (!event || (!event.ctrlKey && !event.metaKey)) return false;
  const key = String(event.key || "").toLowerCase();
  return key === "a";
}

export function isVideohaoBt2AllowedChar(value) {
  return VIDEOHAO_BT2_ALLOWED_REG.test(String(value || ""));
}
