"use strict";

import { net, session } from "electron";
import {
  SPH_AUTH_PROBE,
  isSphLoginUrl,
  isSphSessionInvalid,
  isSphSessionValid,
  sphInvalidReason,
} from "../../shared/loginState.js";

const DEFAULT_TIMEOUT_MS = 12000;

/**
 * 真实探测视频号会话是否仍然有效。
 *
 * 背景：sessionid 不按时间过期，服务端可以随时作废它；此时 cookie 仍在 jar 里、
 * expires 也没到，只看 cookie 会把失效账号显示成「已登录」，用户发布时才失败。
 * 这里直接调用视频号鉴权接口（auth_data）拿 errCode 作为最终判据。
 *
 * 走传入 partition 对应的 session，因此会自动带上该分区的 cookie，
 * 不需要手工拼 Cookie 头，也不会影响其他分区。
 *
 * partition 必须是完整值（如 `persist:sph视频号`），不要做 phone 那套
 * `split("-")[0]` 裁剪：partition 里一旦含 `-`，裁剪后就会打在一个没有
 * cookie 的空 session 上，服务端回 300330，把正常账号误判成未登录。
 *
 * 网络异常一律返回 `{ ok: false }`（未知），由调用方回退到 cookie 判定，
 * 避免断网时把正常账号误判成未登录。
 *
 * @param {string} partition 完整 partition，如 `persist:sph视频号`
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:boolean, loggedIn?:boolean, errCode?:number, reason?:string}>}
 */
function probeRequest(partition, timeoutMs, cookieHeader = null) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let request;
    try {
      const ses = session.fromPartition(String(partition || ""));
      request = net.request({
        method: SPH_AUTH_PROBE.method,
        url: SPH_AUTH_PROBE.url,
        session: ses,
        useSessionCookies: cookieHeader === null,
        // 用 manual 自己跟随：失效会话若被 302 到 login.html，能立刻判定未登录，
        // 而不是拿到一坨 HTML 后 JSON 解析失败、退回 cookie 判定继续显示「已登录」。
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          Origin: "https://channels.weixin.qq.com",
          Referer: SPH_AUTH_PROBE.referer,
          ...(cookieHeader === null ? {} : { Cookie: cookieHeader }),
        },
      });
    } catch (e) {
      return done({ ok: false, reason: cookieHeader === null ? `创建请求失败: ${e.message || e}` : "创建候选会话请求失败" });
    }

    const timer = setTimeout(() => {
      try {
        request.abort();
      } catch (_) {
        /* ignore */
      }
      done({ ok: false, reason: "探测超时" });
    }, timeoutMs);

    // 302/303 到登录页 = 会话已失效。manual 模式下必须在事件内同步放行，
    // 否则请求被取消；这里对登录页直接判失效，其余跳转照常跟随。
    request.on("redirect", (statusCode, method, redirectUrl) => {
      if (isSphLoginUrl(redirectUrl)) {
        clearTimeout(timer);
        try {
          request.abort();
        } catch (_) {
          /* ignore */
        }
        return done({
          ok: true,
          loggedIn: false,
          reason: `视频号会话已失效（${statusCode} 跳转登录页）`,
        });
      }
      try {
        request.followRedirect();
      } catch (_) {
        clearTimeout(timer);
        done({ ok: false, reason: "跟随重定向失败" });
      }
    });

    request.on("response", (response) => {
      let raw = "";
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        clearTimeout(timer);
        // 兜底：万一仍拿到 HTML（例如 200 直接吐登录页），按未登录处理，
        // 不能因为「解析失败」退回 cookie 判定而继续显示已登录。
        const contentType = String(
          (response.headers && response.headers["content-type"]) || ""
        );
        if (/text\/html/i.test(contentType)) {
          return done({
            ok: true,
            loggedIn: false,
            reason: "视频号会话已失效（返回登录页）",
          });
        }
        let payload = null;
        try {
          payload = JSON.parse(raw);
        } catch (_) {
          return done({
            ok: false,
            reason: `响应非 JSON (status=${response.statusCode})`,
          });
        }
        if (isSphSessionInvalid(payload)) {
          const code = payload.errCode != null ? payload.errCode : payload.errcode;
          return done({
            ok: true,
            loggedIn: false,
            errCode: Number(code),
            reason: sphInvalidReason(Number(code)),
          });
        }
        if (isSphSessionValid(payload)) {
          return done({ ok: true, loggedIn: true, errCode: 0, reason: "" });
        }
        // 其它错误码含义不明，按「未知」处理，交给 cookie 判定兜底
        const code = payload.errCode != null ? payload.errCode : payload.errcode;
        return done({ ok: false, reason: `未知 errCode=${code}` });
      });
    });

    request.on("error", (e) => {
      clearTimeout(timer);
      done({ ok: false, reason: cookieHeader === null ? `请求失败: ${(e && e.message) || e}` : "候选会话请求失败" });
    });

    request.write(SPH_AUTH_PROBE.body);
    request.end();
  });
}

/** 普通状态检查只读 Cookie，不自动修改会话。 */
export function probeSphSession(partition, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return probeRequest(partition, timeoutMs);
}

/** 在原分区/代理下验证候选 Cookie 头，不先改写 Cookie jar，也不打印凭据。 */
export function probeSphCookieSet(partition, cookies, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const target = new URL(SPH_AUTH_PROBE.url);
  const matching = cookies.filter(cookie => {
    const domain = String(cookie.domain || "").replace(/^\./, "");
    const hostMatches = cookie.hostOnly ? target.hostname === domain :
      target.hostname === domain || target.hostname.endsWith("." + domain);
    const p = cookie.path || "/";
    const pathMatches = target.pathname === p || (target.pathname.startsWith(p) && (p.endsWith("/") || target.pathname[p.length] === "/"));
    const exp = cookie.expirationDate == null ? cookie.expires : cookie.expirationDate;
    return hostMatches && pathMatches && (!(exp > 0) || exp * 1000 > Date.now());
  });
  const header = matching.map(cookie => cookie.name + "=" + cookie.value).join("; ");
  return probeRequest(partition, timeoutMs, header);
}
