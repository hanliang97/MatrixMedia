"use strict";

const express = require("express");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const Portfinder = require("portfinder");

const DEFAULT_PORT = 30999;
const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodePathname(value) {
  return value
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isInsideBuild(buildDir, targetPath) {
  const relative = path.relative(buildDir, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveBuildPath(buildDir, requestPath) {
  const rawPath = decodeURIComponent(requestPath || "/");
  const relativePath = path.normalize(rawPath.replace(/^[/\\]+/, ""));
  return path.resolve(buildDir, relativePath);
}

function getOriginalPath(req) {
  return (req.originalUrl || req.url || "/").split("?")[0];
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sanitizeUploadFileName(name) {
  if (!name) return null;
  const base = path.basename(String(name)).replace(/[\0]/g, "");
  if (!base || base === "." || base === "..") return null;
  return base;
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("文件过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartBuffer(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!match) {
    throw new Error("无效的上传请求");
  }

  const boundary = "--" + (match[1] || match[2]).trim();
  const body = buffer.toString("latin1");
  const parts = body.split(boundary);
  const fields = {};
  const files = [];

  for (let i = 1; i < parts.length; i++) {
    let part = parts[i];
    if (part.startsWith("--")) break;
    if (part.startsWith("\r\n")) part = part.slice(2);
    if (part.endsWith("\r\n")) part = part.slice(0, -2);

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = part.slice(0, headerEnd);
    const rawBody = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    const filenameMatch = /filename="([^"]*)"/.exec(headers);
    const fieldName = nameMatch ? nameMatch[1] : "";
    const data = Buffer.from(rawBody, "latin1");

    if (filenameMatch && filenameMatch[1] !== "") {
      files.push({
        name: fieldName,
        filename: filenameMatch[1],
        data,
      });
    } else if (fieldName) {
      fields[fieldName] = data.toString("utf8");
    }
  }

  return { fields, files };
}

function resolveUploadDir(buildDir, dirField) {
  const requestPath = dirField && dirField !== "/" ? `/${dirField}` : "/";
  const targetPath = resolveBuildPath(buildDir, requestPath);

  if (!isInsideBuild(buildDir, targetPath)) {
    throw new Error("禁止上传到该目录");
  }

  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error("目标不是目录");
  }

  return targetPath;
}

function saveUploadedFiles(buildDir, uploadDir, files) {
  const saved = [];

  files.forEach((file) => {
    const safeName = sanitizeUploadFileName(file.filename);
    if (!safeName) return;

    const dest = path.join(uploadDir, safeName);
    if (!isInsideBuild(buildDir, dest)) return;

    fs.writeFileSync(dest, file.data);
    saved.push(safeName);
  });

  return saved;
}

function renderDirectoryPage(buildDir, currentPath, entries) {
  const normalizedPath =
    currentPath === "/"
      ? ""
      : currentPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const uploadDirValue = escapeHtml(normalizedPath);
  const parentPath = normalizedPath.split("/").slice(0, -1).join("/");
  const rows = [];

  if (normalizedPath) {
    rows.push(`<li><a href="/${encodePathname(parentPath)}">../</a></li>`);
  }

  entries.forEach((entry) => {
    const childPath = [normalizedPath, entry.name].filter(Boolean).join("/");
    const href = `/${encodePathname(childPath)}${entry.isDirectory ? "/" : ""}`;
    const suffix = entry.isDirectory ? "/" : "";
    const meta = entry.isDirectory ? "目录" : formatFileSize(entry.size);
    rows.push(
      `<li><a href="${href}">${escapeHtml(
        entry.name
      )}${suffix}</a><span>${escapeHtml(meta)}</span></li>`
    );
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MatrixMedia Dev Build</title>
  <style>
    body { margin: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2937; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0 0 24px; color: #6b7280; }
    ul { max-width: 760px; padding: 0; margin: 0; list-style: none; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 16px; border-top: 1px solid #e5e7eb; }
    li:first-child { border-top: 0; }
    a { color: #2563eb; text-decoration: none; word-break: break-all; }
    a:hover { text-decoration: underline; }
    span { flex: 0 0 auto; color: #6b7280; }
    .upload-box { max-width: 760px; margin: 0 0 24px; padding: 28px 16px; border: 2px dashed #cbd5e1; border-radius: 8px; text-align: center; color: #6b7280; background: #f8fafc; }
    .upload-box.dragover { border-color: #2563eb; background: #eff6ff; color: #2563eb; }
    .upload-box p { margin: 0 0 12px; }
    .upload-status { margin-top: 12px; min-height: 20px; font-size: 14px; }
    form { margin: 24px 0 0; }
    button { padding: 8px 14px; border: 1px solid #dc2626; border-radius: 6px; background: #fff; color: #dc2626; cursor: pointer; }
    button:hover { background: #fef2f2; }
  </style>
</head>
<body>
  <h1>MatrixMedia Dev Build</h1>
  <p>${escapeHtml(buildDir)}</p>
  <div class="upload-box" id="upload-box">
    <p>拖入文件到此处上传${
      normalizedPath ? `（当前目录：/${escapeHtml(normalizedPath)}）` : ""
    }</p>
    <p>或 <label><input type="file" id="file-input" multiple hidden>点击选择文件</label></p>
    <div class="upload-status" id="upload-status"></div>
  </div>
  <ul>${rows.join("") || "<li>build 目录暂无文件</li>"}</ul>
  <form method="post" action="/__shutdown">
    <button type="submit">关闭下载服务</button>
  </form>
  <script>
    (function () {
      var uploadBox = document.getElementById('upload-box')
      var fileInput = document.getElementById('file-input')
      var statusEl = document.getElementById('upload-status')
      var uploadDir = '${uploadDirValue}'

      function setStatus(text, isError) {
        statusEl.textContent = text
        statusEl.style.color = isError ? '#dc2626' : '#059669'
      }

      function uploadFiles(fileList) {
        if (!fileList || !fileList.length) return
        var formData = new FormData()
        formData.append('dir', uploadDir || '/')
        Array.prototype.forEach.call(fileList, function (file) {
          formData.append('file', file, file.name)
        })
        setStatus('上传中...')
        fetch('/__upload', { method: 'POST', body: formData })
          .then(function (res) { return res.json().then(function (data) { return { res: res, data: data } }) })
          .then(function (result) {
            if (!result.res.ok || !result.data.ok) {
              throw new Error((result.data && result.data.error) || '上传失败')
            }
            setStatus('已上传: ' + result.data.files.join(', '))
            setTimeout(function () { location.reload() }, 600)
          })
          .catch(function (error) {
            setStatus(error.message || '上传失败', true)
          })
      }

      ;['dragenter', 'dragover'].forEach(function (eventName) {
        uploadBox.addEventListener(eventName, function (event) {
          event.preventDefault()
          uploadBox.classList.add('dragover')
        })
      })
      ;['dragleave', 'drop'].forEach(function (eventName) {
        uploadBox.addEventListener(eventName, function (event) {
          event.preventDefault()
          uploadBox.classList.remove('dragover')
        })
      })
      uploadBox.addEventListener('drop', function (event) {
        uploadFiles(event.dataTransfer.files)
      })
      fileInput.addEventListener('change', function () {
        uploadFiles(fileInput.files)
        fileInput.value = ''
      })
    })()
  </script>
</body>
</html>`;
}

function listDirectory(buildDir, targetPath, requestPath, res) {
  const entries = fs
    .readdirSync(targetPath, { withFileTypes: true })
    .map((dirent) => {
      const entryPath = path.join(targetPath, dirent.name);
      const stat = fs.statSync(entryPath);
      return {
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        size: stat.size,
      };
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  res.type("html").send(renderDirectoryPage(buildDir, requestPath, entries));
}

function createDevDownloadApp(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, "..");
  const buildDir = options.buildDir || path.join(rootDir, "build");
  const maxUploadBytes = options.maxUploadBytes || DEFAULT_MAX_UPLOAD_BYTES;
  const app = express();
  const onShutdown =
    typeof options.onShutdown === "function" ? options.onShutdown : null;

  app.post("/__upload", async (req, res) => {
    try {
      const body = await readRequestBody(req, maxUploadBytes);
      const parsed = parseMultipartBuffer(body, req.headers["content-type"]);
      const uploadDir = resolveUploadDir(buildDir, parsed.fields.dir);
      const saved = saveUploadedFiles(buildDir, uploadDir, parsed.files);

      if (!saved.length) {
        res.status(400).json({ ok: false, error: "没有可保存的文件" });
        return;
      }

      res.json({ ok: true, files: saved });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "上传失败" });
    }
  });

  app.post("/__shutdown", (req, res) => {
    if (onShutdown) {
      res.on("finish", onShutdown);
    }
    res.type("html").send("<h1>下载服务已关闭</h1>");
  });

  app.get("*", (req, res) => {
    const requestPath = getOriginalPath(req);
    let targetPath;
    try {
      targetPath = resolveBuildPath(buildDir, requestPath);
    } catch (error) {
      res.status(400).send("Bad request");
      return;
    }

    if (!isInsideBuild(buildDir, targetPath)) {
      res.status(403).send("Forbidden");
      return;
    }

    if (!fs.existsSync(targetPath)) {
      res.status(404).send("Not found");
      return;
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      listDirectory(buildDir, targetPath, requestPath, res);
      return;
    }

    res.download(targetPath);
  });

  return app;
}

function isIpv4(item) {
  return item.family === "IPv4" || item.family === 4;
}

function getLanUrls(port) {
  const urls = [`http://127.0.0.1:${port}/`];
  const interfaces = os.networkInterfaces();

  Object.keys(interfaces).forEach((name) => {
    interfaces[name].forEach((item) => {
      if (isIpv4(item) && !item.internal) {
        urls.push(`http://${item.address}:${port}/`);
      }
    });
  });

  return urls;
}

function ensureBuildDir(buildDir) {
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
}

function startDevDownloadServer(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, "..");
  const buildDir = options.buildDir || path.join(rootDir, "build");
  const port =
    options.port || Number(process.env.DEV_DOWNLOAD_PORT) || DEFAULT_PORT;
  const host = options.host || "0.0.0.0";

  ensureBuildDir(buildDir);
  Portfinder.basePort = port;

  return new Promise((resolve, reject) => {
    Portfinder.getPort((error, availablePort) => {
      if (error) {
        reject(error);
        return;
      }

      let server;
      const app = createDevDownloadApp({
        ...options,
        rootDir,
        buildDir,
        onShutdown: () => {
          server.close(() => {
            console.log(
              "\n下载服务已关闭。如需再次分享，请重新执行 pnpm xz 或 yarn dev:download\n"
            );
            process.exit(0);
          });
        },
      });
      server = http.createServer(app);

      server.on("error", reject);
      server.listen(availablePort, host, () => {
        const urls = getLanUrls(availablePort);
        const requestedPort = port;
        console.log("\nDev build 下载服务已启动（终端需保持运行）:");
        if (availablePort !== requestedPort) {
          console.log(
            `  注意: ${requestedPort} 已被占用，实际端口为 ${availablePort}`
          );
        }
        urls.forEach((url) => console.log(`  ${url}`));
        console.log("  同网段设备请用上面的局域网地址访问");
        console.log("  支持拖入/选择文件上传到 build 目录");
        console.log(
          "  按 Ctrl+C 停止；页面上的「关闭下载服务」也会停止本服务\n"
        );
        resolve({ server, port: availablePort, urls, buildDir });
      });
    });
  });
}

if (require.main === module) {
  startDevDownloadServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    console.log("\n下载服务已停止");
    process.exit(0);
  });
}

module.exports = {
  createDevDownloadApp,
  startDevDownloadServer,
  sanitizeUploadFileName,
  parseMultipartBuffer,
  resolveUploadDir,
  saveUploadedFiles,
};
