"use strict";

export function isPlatformLoginUrl(platform, currentUrl) {
  const pt = String(platform || "");
  const rawUrl = String(currentUrl || "");
  if (pt === "视频号") {
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
  if (pt === "抖音") {
    try {
      const url = new URL(rawUrl);
      if (url.hostname === "passport.douyin.com") return true;
      if (url.hostname === "creator.douyin.com") {
        return (
          url.pathname === "/" ||
          url.pathname === "" ||
          url.pathname === "/login" ||
          url.pathname.startsWith("/login/") ||
          url.pathname.startsWith("/creator-micro/login")
        );
      }
      if (url.hostname.endsWith(".douyin.com")) {
        return /^\/(login|passport)(\/|$)/i.test(url.pathname);
      }
      return false;
    } catch (_) {
      return (
        rawUrl.startsWith("https://passport.douyin.com") ||
        rawUrl.startsWith("https://creator.douyin.com/login")
      );
    }
  }
  return false;
}
