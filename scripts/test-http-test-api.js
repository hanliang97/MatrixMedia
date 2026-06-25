"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");
const indexRouter = require("../src/main/server/routes/index");

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, pathname) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "GET",
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const app = express();
  app.use("/", indexRouter);
  app.use((req, res) => {
    res.status(404).json({ error: 404 });
  });

  const server = await listen(app);

  try {
    const response = await request(server, "/test");
    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(response.body), {
      success: true,
      message: "ok",
    });
  } finally {
    server.close();
  }

  console.log("test-http-test-api passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
