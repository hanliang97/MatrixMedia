"use strict";

export function isPlatformLoginUrl(platform, currentUrl) {
  const pt = String(platform || "");
  const rawUrl = String(currentUrl || "");
  if (pt !== "视频号") return false;
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === "https://channels.weixin.qq.com" &&
      (url.pathname === "/login.html" || url.pathname.startsWith("/login/"))
    );
  } catch (_) {
    return rawUrl.startsWith("https://channels.weixin.qq.com/login");
  }
}
