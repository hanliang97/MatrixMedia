"use strict";

/**
 * 本地代理桥：Electron → 127.0.0.1:<bridgePort>（本地 HTTP 代理，无认证）
 *            → 上游代理（SOCKS5 用户名/密码认证，或 HTTP Basic 预发认证）
 *            → 目标站点
 *
 * 为什么需要：
 * 1. Chromium 的 `socks5=` 代理规则在协议层面不支持账号密码认证，凭据完全不生效。
 * 2. Chromium 对 HTTP 代理采用「407 挑战应答」认证，而实测（Electron 24）：
 *    - session 级 `login` 事件对代理认证不触发，只有 app 级触发；
 *    - 主进程 net 模块（SimpleURLLoader，如 sphAuthProbe 探测）根本不触发任何
 *      login 事件，407 无人应答 → net::ERR_TUNNEL_CONNECTION_FAILED 且以
 *      未捕获异常形式弹出。
 *    本地桥在连上游时预发 Proxy-Authorization（与 curl 行为一致），彻底绕开
 *    Electron 的认证事件链。
 *
 * 纯 Node 实现，不依赖 Electron，可单独测试。
 */

import net from "net";
import http from "http";

const HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const IDLE_CLOSE_MS = 10 * 60 * 1000;

/** @type {Map<string, { server: http.Server, port: number, idleTimer: NodeJS.Timeout, lastUsed: number }>} */
const bridges = new Map();

function bridgeKey({ scheme, host, port, username, password }) {
  return `${scheme || "http"}://${encodeURIComponent(
    username || ""
  )}:${encodeURIComponent(password || "")}@${host}:${port}`;
}

function basicAuthHeader({ username, password }) {
  if (!username && !password) return null;
  return (
    "Basic " +
    Buffer.from(`${username || ""}:${password || ""}`, "utf8").toString("base64")
  );
}

/* ---------------- SOCKS5 上游（RFC 1928 + RFC 1929） ---------------- */

function expandIPv6(input) {
  const [headPart, tailPart] = input.split("::");
  const head = headPart ? headPart.split(":") : [];
  const tail = tailPart ? tailPart.split(":") : [];
  const missing = 8 - head.length - tail.length;
  const groups = [...head, ...Array(Math.max(missing, 0)).fill("0"), ...tail];
  return groups.map((g) => g.padStart(4, "0"));
}

/**
 * SOCKS5 握手，建立到目标的隧道。
 * @returns {Promise<net.Socket>}
 */
export function socksConnect({
  host,
  port,
  username,
  password,
  targetHost,
  targetPort,
  timeoutMs = HANDSHAKE_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const upstream = net.connect({
      host,
      port: Number(port),
    });
    upstream.setTimeout(timeoutMs);

    let stage = "greeting";
    let buffered = Buffer.alloc(0);

    const fail = (err) => {
      cleanup();
      upstream.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const finish = () => {
      upstream.setTimeout(0);
      cleanup();
      resolve(upstream);
    };

    const cleanup = () => {
      upstream.removeListener("data", onData);
      upstream.removeListener("error", fail);
      upstream.removeListener("close", onClose);
      upstream.removeListener("timeout", onTimeout);
    };

    const writeAll = (buf) => {
      if (!upstream.write(buf)) {
        return new Promise((r) => upstream.once("drain", r));
      }
      return Promise.resolve();
    };

    const sendGreeting = () => {
      stage = "greeting";
      // 总是同时提供「无认证」和「账号密码认证」两种方式，跟随服务器选择；
      // 与 curl 行为一致，兼容只接受其中一种的代理
      writeAll(Buffer.from([0x05, 0x02, 0x00, 0x02])).catch(fail);
    };

    const sendAuth = () => {
      stage = "auth";
      const user = Buffer.from(String(username || ""), "utf8");
      const pass = Buffer.from(String(password || ""), "utf8");
      const buf = Buffer.concat([
        Buffer.from([0x01, user.length]),
        user,
        Buffer.from([pass.length]),
        pass,
      ]);
      writeAll(buf).catch(fail);
    };

    const sendRequest = () => {
      stage = "request";
      const tPort = Number(targetPort);
      let atyp;
      let addr;
      if (net.isIPv4(targetHost)) {
        atyp = 0x01;
        addr = Buffer.from(targetHost.split(".").map(Number));
      } else if (net.isIPv6(targetHost)) {
        atyp = 0x04;
        const buf6 = Buffer.alloc(16);
        const parts = expandIPv6(targetHost);
        if (parts.length !== 8) return fail(new Error("目标 IPv6 地址无效"));
        for (let i = 0; i < 8; i++) {
          buf6.writeUInt16BE(parseInt(parts[i], 16), i * 2);
        }
        addr = buf6;
      } else {
        atyp = 0x03;
        const hostBuf = Buffer.from(String(targetHost), "utf8");
        if (hostBuf.length > 255) return fail(new Error("目标域名过长"));
        addr = Buffer.concat([Buffer.from([hostBuf.length]), hostBuf]);
      }
      const req = Buffer.alloc(6 + addr.length);
      req[0] = 0x05;
      req[1] = 0x01; // CONNECT
      req[2] = 0x00; // RSV
      req[3] = atyp;
      addr.copy(req, 4);
      req.writeUInt16BE(tPort, 4 + addr.length);
      writeAll(req).catch(fail);
    };

    const consume = (need) => {
      if (buffered.length < need) return null;
      const out = buffered.subarray(0, need);
      buffered = buffered.subarray(need);
      return out;
    };

    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      try {
        if (stage === "greeting") {
          const head = consume(2);
          if (!head) return;
          if (head[0] !== 0x05) return fail(new Error("SOCKS5 握手失败：协议版本异常"));
          if (head[1] === 0x00) return sendRequest();
          if (head[1] === 0x02) return sendAuth();
          return fail(new Error("SOCKS5 代理不接受无认证/账号密码认证方式"));
        }
        if (stage === "auth") {
          const head = consume(2);
          if (!head) return;
          if (head[0] !== 0x01) return fail(new Error("SOCKS5 认证子协商版本异常"));
          if (head[1] !== 0x00) return fail(new Error("SOCKS5 用户名或密码错误"));
          return sendRequest();
        }
        if (stage === "request") {
          const head = consume(4);
          if (!head) return;
          if (head[0] !== 0x05) return fail(new Error("SOCKS5 响应版本异常"));
          if (head[1] !== 0x00) {
            const reasons = {
              0x01: "SOCKS5 代理一般性失败",
              0x02: "SOCKS5 代理不允许该连接",
              0x03: "SOCKS5 目标网络不可达",
              0x04: "SOCKS5 目标主机不可达",
              0x05: "SOCKS5 连接被拒绝",
              0x06: "SOCKS5 TTL 过期",
              0x07: "SOCKS5 不支持的命令",
              0x08: "SOCKS5 不支持的目标地址类型",
            };
            return fail(new Error(reasons[head[1]] || `SOCKS5 连接失败（代码 ${head[1]}）`));
          }
          // 跳过剩余应答字段（BND.ADDR + BND.PORT）
          let skip = 0;
          if (head[3] === 0x01) skip = 4 + 2;
          else if (head[3] === 0x04) skip = 16 + 2;
          else if (head[3] === 0x03) {
            if (buffered.length < 1) return;
            skip = buffered[0] + 2;
          } else return fail(new Error("SOCKS5 应答地址类型异常"));
          if (buffered.length < skip) return;
          buffered = buffered.subarray(skip);
          cleanup();
          return finish();
        }
      } catch (err) {
        fail(err);
      }
    };

    const onClose = () => {
      if (stage !== "done") fail(new Error("SOCKS5 代理在握手期间断开连接"));
    };
    const onTimeout = () => fail(new Error("SOCKS5 握手超时"));

    upstream.on("data", onData);
    upstream.on("error", fail);
    upstream.on("close", onClose);
    upstream.on("timeout", onTimeout);

    upstream.once("connect", sendGreeting);
  });
}

/* ---------------- HTTP 上游（预发 Proxy-Authorization） ---------------- */

/**
 * 对 HTTP 代理发 CONNECT（带预发 Basic 认证），建立到目标的隧道。
 * 上游瞬时 502/503/504（常见于隧道代理抖动、目标暂不可达）自动重试一次。
 * @returns {Promise<net.Socket>}
 */
export async function httpProxyTunnel({
  host,
  port,
  username,
  password,
  targetHost,
  targetPort,
  timeoutMs = HANDSHAKE_TIMEOUT_MS,
}) {
  const attempt = () =>
    httpProxyTunnelOnce({
      host,
      port,
      username,
      password,
      targetHost,
      targetPort,
      timeoutMs,
    });
  try {
    return await attempt();
  } catch (err) {
    const message = String((err && err.message) || err);
    if (/(HTTP 50[234])/.test(message)) {
      await new Promise((r) => setTimeout(r, 300));
      return attempt();
    }
    throw err;
  }
}

function httpProxyTunnelOnce({
  host,
  port,
  username,
  password,
  targetHost,
  targetPort,
  timeoutMs = HANDSHAKE_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: Number(port) });
    sock.setTimeout(timeoutMs);

    const fail = (err) => {
      sock.removeListener("data", onData);
      sock.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onTimeout = () => fail(new Error("HTTP 代理隧道握手超时"));
    const onError = (err) => fail(err);

    const onData = (chunk) => {
      const text = chunk.toString("latin1");
      const idx = text.indexOf("\r\n\r\n");
      if (idx === -1) return;
      sock.removeListener("data", onData);
      sock.removeListener("timeout", onTimeout);
      sock.removeListener("error", onError);
      sock.setTimeout(0);
      const statusLine = text.slice(0, text.indexOf("\r\n"));
      const m = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
      const code = m ? Number(m[1]) : 0;
      if (code !== 200) {
        sock.destroy();
        const hint =
          code === 407
            ? "账号密码被拒绝"
            : code === 0
            ? "响应无法解析"
            : `HTTP ${code}`;
        return reject(new Error(`上游代理 CONNECT 失败（${hint}），请检查代理地址与账号密码`));
      }
      const headBytes = Buffer.byteLength(text.slice(0, idx + 4), "latin1");
      if (chunk.length > headBytes) {
        sock.unshift(chunk.subarray(headBytes));
      }
      resolve(sock);
    };

    sock.on("error", onError);
    sock.on("timeout", onTimeout);
    sock.once("connect", () => {
      const headers = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
      ];
      const auth = basicAuthHeader({ username, password });
      if (auth) headers.push(`Proxy-Authorization: ${auth}`);
      headers.push("\r\n");
      sock.write(headers.join("\r\n"));
      sock.on("data", onData);
    });
  });
}

/* ---------------- 桥服务器 ---------------- */

function parseHostPort(hostPort) {
  // CONNECT 里是 "host:port"，可能是 IPv6 字面量 [::1]:443
  const m = hostPort.match(/^\[([^\]]+)\]:(\d+)$/) || hostPort.match(/^(.+):(\d+)$/);
  if (!m) return null;
  return { host: m[1], port: Number(m[2]) };
}

async function openUpstreamTunnel(targetHost, targetPort) {
  const ctx = this;
  if (ctx.scheme === "socks5" || ctx.scheme === "socks" || ctx.scheme === "socks4") {
    return socksConnect({ ...ctx, targetHost, targetPort });
  }
  return httpProxyTunnel({ ...ctx, targetHost, targetPort });
}

async function handleConnect(req, clientSocket, head) {
  const target = parseHostPort(req.url || "");
  if (!target) {
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.destroy();
    return;
  }
  let upstream;
  try {
    upstream = await openUpstreamTunnel.call(this, target.host, target.port);
  } catch (err) {
    // 带上目标地址，便于区分「代理整体不可用」和「代理拒绝特定目标」
    console.warn(
      `[proxy-bridge] CONNECT 建立失败 (目标 ${target.host}:${target.port}, 上游 ${this.scheme}://${this.host}:${this.port}):`,
      (err && err.message) || err
    );
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.destroy();
    return;
  }
  clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (head && head.length) upstream.write(head);
  upstream.pipe(clientSocket);
  clientSocket.pipe(upstream);
  const kill = () => {
    clientSocket.destroy();
    upstream.destroy();
  };
  clientSocket.on("error", kill);
  upstream.on("error", kill);
  clientSocket.on("close", kill);
  upstream.on("close", kill);
}

async function handleRequest(req, res) {
  // 普通代理请求 req.url 为绝对 URI（http://host/path）
  let target;
  try {
    const parsed = new URL(req.url);
    target = { host: parsed.hostname, port: Number(parsed.port || 80) };
  } catch (_) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }
  try {
    if (this.scheme === "socks5" || this.scheme === "socks") {
      // SOCKS 上游：隧道到源站后转发 origin-form 请求
      const sock = await socksConnect({ ...this, targetHost: target.host, targetPort: target.port });
      relayRequestToSocket(req, res, sock);
      return;
    }
    // HTTP 上游：以转发代理语义直接向代理发绝对 URI 请求（预发认证）
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const auth = basicAuthHeader(this);
    if (auth) headers["Proxy-Authorization"] = auth;
    const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
    agent.createConnection = (_opts, cb) => {
      const s = net.connect({ host: this.host, port: this.port });
      s.once("connect", () => cb(null, s));
      s.once("error", (e) => cb(e));
    };
    const outbound = http.request(
      { method: req.method, path: req.url, headers, agent },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      }
    );
    outbound.on("error", (err) => {
      console.warn("[proxy-bridge] 转发请求失败:", (err && err.message) || err);
      try {
        res.writeHead(502);
        res.end("Bad Gateway");
      } catch (_) {}
    });
    req.pipe(outbound);
    res.on("close", () => outbound.destroy());
  } catch (err) {
    console.warn("[proxy-bridge] 上游代理连接失败:", (err && err.message) || err);
    try {
      res.writeHead(502);
      res.end("Bad Gateway");
    } catch (_) {}
  }
}

function relayRequestToSocket(req, res, sock) {
  const headers = { ...req.headers };
  delete headers["proxy-connection"];
  delete headers["proxy-authorization"];
  // 注意：不能用 agent:false —— Node 会 new 一个空参数的一次性 Agent，
  // 请求里的 createConnection 会被忽略，导致直连目标默认端口。
  const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
  agent.createConnection = (_opts, cb) => cb(null, sock);
  const outbound = http.request(
    {
      method: req.method,
      path: new URL(req.url).pathname + new URL(req.url).search,
      headers,
      agent,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );
  outbound.on("error", (err) => {
    console.warn("[proxy-bridge] 转发请求失败:", (err && err.message) || err);
    try {
      res.writeHead(502);
      res.end("Bad Gateway");
    } catch (_) {}
    sock.destroy();
  });
  req.pipe(outbound);
  res.on("close", () => sock.destroy());
}

/**
 * 取（或启动）一个指向指定上游代理的本地 HTTP 代理桥。
 * @param {{ scheme?: string, host: string, port: string|number, username?: string, password?: string }} upstream
 * @returns {Promise<{ port: number }>}
 */
export function getProxyBridge(upstream) {
  const ctx = {
    scheme: String(upstream.scheme || "http").toLowerCase(),
    host: upstream.host,
    port: Number(upstream.port),
    username: upstream.username || "",
    password: upstream.password || "",
  };
  const key = bridgeKey(ctx);
  const existing = bridges.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return Promise.resolve({ port: existing.port });
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("connect", handleConnect.bind(ctx));
    server.on("request", handleRequest.bind(ctx));
    server.on("clientError", (_err, socket) => {
      if (socket && socket.writable) {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const port = server.address().port;
      const entry = {
        server,
        port,
        lastUsed: Date.now(),
        idleTimer: setInterval(() => {
          if (Date.now() - entry.lastUsed > IDLE_CLOSE_MS) closeProxyBridgeByKey(key);
        }, 60 * 1000),
      };
      if (entry.idleTimer.unref) entry.idleTimer.unref();
      bridges.set(key, entry);
      resolve({ port });
    });
  });
}

/** 兼容旧调用名 */
export const getSocksBridge = getProxyBridge;

function closeProxyBridgeByKey(key) {
  const entry = bridges.get(key);
  if (!entry) return;
  bridges.delete(key);
  clearInterval(entry.idleTimer);
  try {
    entry.server.close();
  } catch (_) {}
}

/** 关闭指定上游的桥 */
export function closeProxyBridge(upstream) {
  closeProxyBridgeByKey(bridgeKey({ scheme: upstream.scheme || "http", ...upstream }));
}

/** 兼容旧调用名 */
export const closeSocksBridge = closeProxyBridge;

/** 关闭全部桥（应用退出时调用） */
export function closeAllSocksBridges() {
  for (const key of Array.from(bridges.keys())) closeProxyBridgeByKey(key);
}
export const closeAllProxyBridges = closeAllSocksBridges;

/** 测试辅助 */
export function _socksBridgeCount() {
  return bridges.size;
}
