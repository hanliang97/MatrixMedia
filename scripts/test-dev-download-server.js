/*
 * @Description:
 * @Date: 2026-05-16 13:55:31
 * @Author: Do not edit
 * @LastEditors: liuhanliang
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  createDevDownloadApp,
  sanitizeUploadFileName,
} = require("../.electron-vue/dev-download-server");

function buildMultipart(fields, files) {
  const boundary = "----matrixmedia-test-boundary";
  const chunks = [];

  Object.keys(fields).forEach((key) => {
    chunks.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${fields[key]}\r\n`
    );
  });

  files.forEach((file) => {
    chunks.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n` +
        `${file.data}\r\n`
    );
  });

  chunks.push(`--${boundary}--\r\n`);

  return {
    body: Buffer.from(chunks.join(""), "utf8"),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function request(server, pathname, method = "GET", options = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: options.headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "matrixmedia-dev-download-")
  );
  const buildDir = path.join(tempRoot, "build");
  fs.mkdirSync(path.join(buildDir, "nested"), { recursive: true });
  fs.writeFileSync(
    path.join(buildDir, "MatrixMedia-0.6.2-mac-arm64.dmg"),
    "installer"
  );
  fs.writeFileSync(path.join(buildDir, "notes.txt"), "notes");
  fs.writeFileSync(path.join(tempRoot, "package.json"), "{}");

  let shutdownCount = 0;
  const app = createDevDownloadApp({
    rootDir: tempRoot,
    onShutdown: () => {
      shutdownCount += 1;
    },
  });
  const server = await listen(app);

  try {
    const index = await request(server, "/");
    assert.strictEqual(index.statusCode, 200);
    assert.match(index.headers["content-type"], /text\/html/);
    assert.match(
      index.body.toString("utf8"),
      /MatrixMedia-0\.6\.2-mac-arm64\.dmg/
    );
    assert.match(index.body.toString("utf8"), /notes\.txt/);
    assert.match(index.body.toString("utf8"), /关闭下载服务/);
    assert.match(index.body.toString("utf8"), /拖入文件到此处上传/);

    const multipart = buildMultipart({ dir: "/" }, [
      { name: "file", filename: "uploaded.txt", data: "upload-body" },
    ]);
    const upload = await request(server, "/__upload", "POST", {
      headers: {
        "Content-Type": multipart.contentType,
        "Content-Length": multipart.body.length,
      },
      body: multipart.body,
    });
    assert.strictEqual(upload.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(upload.body.toString("utf8")), {
      ok: true,
      files: ["uploaded.txt"],
    });
    assert.strictEqual(
      fs.readFileSync(path.join(buildDir, "uploaded.txt"), "utf8"),
      "upload-body"
    );

    const nestedMultipart = buildMultipart({ dir: "nested" }, [
      { name: "file", filename: "nested.bin", data: "nested-data" },
    ]);
    const nestedUpload = await request(server, "/__upload", "POST", {
      headers: {
        "Content-Type": nestedMultipart.contentType,
        "Content-Length": nestedMultipart.body.length,
      },
      body: nestedMultipart.body,
    });
    assert.strictEqual(nestedUpload.statusCode, 200);
    assert.strictEqual(
      fs.readFileSync(path.join(buildDir, "nested", "nested.bin"), "utf8"),
      "nested-data"
    );

    assert.strictEqual(sanitizeUploadFileName("../evil.exe"), "evil.exe");
    assert.strictEqual(sanitizeUploadFileName(".."), null);

    const file = await request(server, "/MatrixMedia-0.6.2-mac-arm64.dmg");
    assert.strictEqual(file.statusCode, 200);
    assert.strictEqual(file.body.toString("utf8"), "installer");
    assert.match(file.headers["content-disposition"], /attachment/);

    const blocked = await request(server, "/%2e%2e/package.json");
    assert.strictEqual(blocked.statusCode, 403);

    const shutdown = await request(server, "/__shutdown", "POST");
    assert.strictEqual(shutdown.statusCode, 200);
    assert.match(shutdown.body.toString("utf8"), /下载服务已关闭/);
    assert.strictEqual(shutdownCount, 1);
  } finally {
    server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log("dev download server tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
