const assert = require("assert");
const http = require("http");
const net = require("net");

const {
  getSocksBridge,
  closeAllSocksBridges,
  _socksBridgeCount,
} = require("../src/main/services/socksBridge.js");


// ---------- 参考实现：带 Basic 认证的 HTTP 代理 ----------
function startReferenceHttpProxy({ username, password }) {
  const server = http.createServer((req, res) => {
    const auth = req.headers["proxy-authorization"] || "";
    if (auth !== "Basic " + Buffer.from(username + ":" + password).toString("base64")) {
      res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="test"' });
      res.end();
      return;
    }
    const target = new URL(req.url);
    const out = http.request(
      { host: target.hostname, port: target.port || 80, method: req.method, path: target.pathname + target.search, headers: { host: req.headers.host } },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); }
    );
    out.on("error", () => { res.writeHead(502); res.end(); });
    out.end();
  });
  server.on("connect", (req, client, head) => {
    const auth = req.headers["proxy-authorization"] || "";
    if (auth !== "Basic " + Buffer.from(username + ":" + password).toString("base64")) {
      client.write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      client.destroy();
      return;
    }
    const m = (req.url || "").match(/^(.+):(\d+)$/);
    const up = net.connect(Number(m[2]), m[1]);
    up.on("error", () => client.destroy());
    up.on("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---------- 参考实现：带用户名/密码认证的 SOCKS5 服务器 ----------
function startReferenceSocks5({ username, password }) {
  const server = net.createServer((client) => {
    let stage = "greeting";
    client.on("error", () => {});
    client.on("data", async function onData(chunk) {
      if (stage === "greeting") {
        assert.strictEqual(chunk[0], 0x05, "客户端应发送 SOCKS5 版本号");
        const methods = Array.from(chunk.subarray(2, 2 + chunk[1]));
        // 跟真实代理一致：无认证服务器优先选 0x00，否则要求账号密码
        if (methods.includes(0x00) && !username && !password) {
          client.write(Buffer.from([0x05, 0x00]));
          stage = "request";
          return;
        }
        if (!methods.includes(0x02)) {
          client.write(Buffer.from([0x05, 0xff]));
          client.destroy();
          return;
        }
        client.write(Buffer.from([0x05, 0x02]));
        stage = "auth";
        return;
      }
      if (stage === "auth") {
        const ulen = chunk[1];
        const user = chunk.subarray(2, 2 + ulen).toString("utf8");
        const plen = chunk[2 + ulen];
        const pass = chunk.subarray(3 + ulen, 3 + ulen + plen).toString("utf8");
        if (user !== username || pass !== password) {
          client.write(Buffer.from([0x01, 0x01]));
          client.destroy();
          return;
        }
        client.write(Buffer.from([0x01, 0x00]));
        stage = "request";
        return;
      }
      if (stage === "request") {
        const atyp = chunk[3];
        let host;
        let port;
        if (atyp === 0x01) {
          host = Array.from(chunk.subarray(4, 8)).join(".");
          port = chunk.readUInt16BE(8);
        } else if (atyp === 0x03) {
          const len = chunk[4];
          host = chunk.subarray(5, 5 + len).toString("utf8");
          port = chunk.readUInt16BE(5 + len);
        } else if (atyp === 0x04) {
          host = Array.from(chunk.subarray(4, 20))
            .map((b) => b.toString(16).padStart(2, "0"))
            .reduce((acc, b, i) => (i % 2 ? acc + b + ":" : acc + b), "::")
            .replace(/:$/, "");
          port = chunk.readUInt16BE(20);
        } else {
          client.destroy();
          return;
        }
        const upstream = net.connect(port, host);
        upstream.on("error", () => client.destroy());
        upstream.on("connect", () => {
          const reply = Buffer.alloc(10);
          reply[0] = 0x05;
          reply[1] = 0x00;
          reply[3] = 0x01;
          reply.writeUInt16BE(0, 8);
          client.write(reply);
          upstream.pipe(client);
          client.pipe(upstream);
          client.removeListener("data", onData);
        });
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function listenEcho() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`echo:${req.url}:${req.headers.host}`);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function requestViaProxy(proxyPort, url) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(`GET ${url} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let buf = "";
    socket.on("data", (d) => (buf += d.toString()));
    socket.on("end", () => resolve(buf));
    socket.on("error", reject);
  });
}

function connectViaProxy(proxyPort, host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1");
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let head = "";
    const onData = (d) => {
      head += d.toString();
      if (head.includes("\r\n\r\n")) {
        socket.removeListener("data", onData);
        if (!/200 Connection Established/.test(head)) {
          reject(new Error("CONNECT 未成功: " + head.split("\r\n")[0]));
          return;
        }
        resolve(socket);
      }
    };
    socket.on("data", onData);
  });
}

(async () => {
  const echoServer = await listenEcho();
  const echoPort = echoServer.address().port;

  // 1. 正确凭据：HTTP 绝对 URI 转发
  const socksOk = await startReferenceSocks5({ username: "u1", password: "p1" });
  const socksOkPort = socksOk.address().port;
  const bridge1 = await getSocksBridge({
    scheme: "socks5",
    host: "127.0.0.1",
    port: socksOkPort,
    username: "u1",
    password: "p1",
  });
  const body = await requestViaProxy(bridge1.port, `http://127.0.0.1:${echoPort}/a?b=c`);
  assert.ok(body.includes("echo:/a?b=c:127.0.0.1"), "HTTP 转发应返回 echo 内容并保留 Host 头: " + body);
  console.log("✓ HTTP 绝对 URI 经认证 SOCKS5 转发成功");

  // 2. 正确凭据：CONNECT 隧道
  const tunnel = await connectViaProxy(bridge1.port, "127.0.0.1", echoPort);
  tunnel.write(`GET /tunnel HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\nConnection: close\r\n\r\n`);
  let tunnelBuf = "";
  tunnel.on("data", (d) => (tunnelBuf += d.toString()));
  await new Promise((r) => tunnel.on("end", r).on("close", r));
  assert.ok(tunnelBuf.includes("echo:/tunnel"), "CONNECT 隧道应可转发: " + tunnelBuf);
  console.log("✓ CONNECT 隧道经认证 SOCKS5 转发成功");

  // 3. 同一上游复用桥
  const again = await getSocksBridge({
    scheme: "socks5",
    host: "127.0.0.1",
    port: socksOkPort,
    username: "u1",
    password: "p1",
  });
  assert.strictEqual(again.port, bridge1.port, "相同上游应复用同一桥实例");
  console.log("✓ 相同上游复用桥实例");

  // 4. 错误密码：请求应得 502
  const socksBad = await startReferenceSocks5({ username: "u1", password: "p1" });
  const bridgeBad = await getSocksBridge({
    scheme: "socks5",
    host: "127.0.0.1",
    port: socksBad.address().port,
    username: "u1",
    password: "WRONG",
  });
  const badBody = await requestViaProxy(bridgeBad.port, `http://127.0.0.1:${echoPort}/x`);
  assert.ok(badBody.includes("502"), "错误密码应返回 502: " + badBody);
  console.log("✓ SOCKS5 密码错误返回 502");

  // 5. 无认证上游也应可用（桥对无认证场景同样透明）
  const socksNoAuth = await startReferenceSocks5({ username: "", password: "" });
  const bridgeNoAuth = await getSocksBridge({
    scheme: "socks5",
    host: "127.0.0.1",
    port: socksNoAuth.address().port,
    username: "",
    password: "",
  });
  const bodyNoAuth = await requestViaProxy(
    bridgeNoAuth.port,
    `http://127.0.0.1:${echoPort}/noauth`
  );
  assert.ok(bodyNoAuth.includes("echo:/noauth"), "无认证转发应成功: " + bodyNoAuth);
  console.log("✓ 无认证 SOCKS5 转发成功");


  // 6. HTTP 上游 + Basic 认证：GET 绝对 URI（预发 Proxy-Authorization）
  const httpProxyOk = await startReferenceHttpProxy({ username: "hu", password: "hp" });
  const bridgeHttp = await getSocksBridge({
    scheme: "http",
    host: "127.0.0.1",
    port: httpProxyOk.address().port,
    username: "hu",
    password: "hp",
  });
  const httpBody = await requestViaProxy(bridgeHttp.port, `http://127.0.0.1:${echoPort}/httpup`);
  assert.ok(httpBody.includes("echo:/httpup"), "HTTP 上游认证转发应成功: " + httpBody);
  console.log("✓ HTTP 上游 Basic 认证转发成功（预发认证）");

  // 7. HTTP 上游 + Basic 认证：CONNECT 隧道
  const httpTunnel = await connectViaProxy(bridgeHttp.port, "127.0.0.1", echoPort);
  httpTunnel.write(`GET /httptunnel HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\nConnection: close\r\n\r\n`);
  let httpTunnelBuf = "";
  httpTunnel.on("data", (d) => (httpTunnelBuf += d.toString()));
  await new Promise((r) => httpTunnel.on("end", r).on("close", r));
  assert.ok(httpTunnelBuf.includes("echo:/httptunnel"), "HTTP 上游 CONNECT 隧道应成功: " + httpTunnelBuf);
  console.log("✓ HTTP 上游 CONNECT 隧道成功");

  // 8. HTTP 上游错误密码：502
  const httpProxyBad = await startReferenceHttpProxy({ username: "hu", password: "hp" });
  const bridgeHttpBad = await getSocksBridge({
    scheme: "http",
    host: "127.0.0.1",
    port: httpProxyBad.address().port,
    username: "hu",
    password: "WRONG",
  });
  const httpBadBody = await requestViaProxy(bridgeHttpBad.port, `http://127.0.0.1:${echoPort}/bad`);
  assert.ok(
    httpBadBody.includes("407") || httpBadBody.includes("502"),
    "HTTP 上游错误密码不得透传成功: " + httpBadBody
  );
  console.log("✓ HTTP 上游密码错误被拦截（透传 407/502）");

  closeAllSocksBridges();

  assert.strictEqual(_socksBridgeCount(), 0, "closeAllSocksBridges 应清空桥");
  echoServer.close();
  socksOk.close();
  socksBad.close();
  socksNoAuth.close();
  httpProxyOk.close();
  httpProxyBad.close();
  console.log("全部断言通过");
  process.exit(0);
})().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
