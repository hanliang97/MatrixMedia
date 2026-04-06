"use strict";

const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "build");
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch (e) {
  /* ignore */
}
