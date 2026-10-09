#!/usr/bin/env node
/**
 * 打包 WorkBuddy 开放平台上架用的 zip：
 *   build/workbuddy/matrixmedia-publish-skill-<ver>.zip   （技能）
 *   build/workbuddy/matrixmedia-connector-<ver>.zip       （连接器 MCP + Skill）
 *   build/workbuddy/matrixmedia-expert-<ver>.zip          （专家，内置技能副本）
 *
 * 用法：node scripts/pack-workbuddy.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "workbuddy");
const outDir = path.join(root, "build", "workbuddy");

function fail(msg) {
  console.error("✖ " + msg);
  process.exit(1);
}

function readFrontmatter(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) fail(`${path.relative(root, file)} 缺少 YAML frontmatter`);
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

function checkSkill(file) {
  const fm = readFrontmatter(file);
  for (const key of ["description", "description_zh", "description_en", "version", "author"]) {
    if (!fm[key]) fail(`${path.relative(root, file)} 缺少必填字段 ${key}`);
  }
  // 引用的 @references/xxx 必须存在
  const body = fs.readFileSync(file, "utf8");
  for (const ref of body.matchAll(/@(references\/[\w./-]+)/g)) {
    if (!fs.existsSync(path.join(path.dirname(file), ref[1]))) {
      fail(`${path.relative(root, file)} 引用的 ${ref[1]} 不存在`);
    }
  }
  return fm;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`${path.relative(root, file)} 不是合法 JSON: ${e.message}`);
  }
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

function hasZhEn(obj) {
  return obj && typeof obj.zh === "string" && obj.zh && typeof obj.en === "string" && obj.en;
}

function zipDir(parent, dirName, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execFileSync("zip", ["-qr", zipPath, dirName, "-x", "*.DS_Store", "-x", "__MACOSX/*"], {
    cwd: parent,
    stdio: "inherit",
  });
  console.log("✔ " + path.relative(root, zipPath));
}

fs.mkdirSync(outDir, { recursive: true });

// ---------- 技能 ----------
const skillParent = path.join(srcRoot, "skill");
const skillName = "matrixmedia-publish";
const skillFm = checkSkill(path.join(skillParent, skillName, "SKILL.md"));
zipDir(skillParent, skillName, path.join(outDir, `${skillName}-skill-${skillFm.version}.zip`));

// ---------- 连接器 ----------
const connParent = path.join(srcRoot, "connector");
const connName = "matrixmedia";
const connDir = path.join(connParent, connName);
for (const f of ["connector-meta.json", "mcp.json", "icon.svg"]) {
  if (!fs.existsSync(path.join(connDir, f))) fail(`连接器缺少必需文件 ${f}`);
}
const meta = readJson(path.join(connDir, "connector-meta.json"));
const mcp = readJson(path.join(connDir, "mcp.json"));
for (const key of ["name", "name_en", "description", "description_zh", "description_en", "source"]) {
  if (!meta[key]) fail(`connector-meta.json 缺少 ${key}`);
}
if (!/^[a-z0-9-]+$/.test(meta.source)) fail("connector-meta.json source 只能包含小写字母、数字、连字符");
const servers = Object.keys(mcp.mcpServers || {});
if (servers.length !== 1) fail("mcp.json 必须且只能配置一个 MCP Server");
if (JSON.stringify(mcp).match(/(sk-|ghp_|Bearer\s+[A-Za-z0-9])/)) fail("mcp.json 疑似包含真实凭证");
const skillsDir = path.join(connDir, "skills");
if (fs.existsSync(skillsDir)) {
  for (const s of fs.readdirSync(skillsDir)) {
    const f = path.join(skillsDir, s, "SKILL.md");
    if (fs.existsSync(f)) checkSkill(f);
  }
}
zipDir(connParent, connName, path.join(outDir, `matrixmedia-connector-${meta.version}.zip`));

// ---------- 专家 ----------
const expertParent = path.join(srcRoot, "expert");
const expertName = "matrixmedia-expert";
const expertDir = path.join(expertParent, expertName);
const plugin = readJson(path.join(expertDir, ".codebuddy-plugin", "plugin.json"));
const rel = p => path.join(expertDir, p.replace(/^\.\//, ""));

for (const key of ["name", "expertType", "version", "description", "agents", "agentName", "avatar", "categoryId", "plugin"]) {
  if (!plugin[key]) fail(`plugin.json 缺少 ${key}`);
}
if (!/^[a-z0-9-]+$/.test(plugin.name)) fail("plugin.json name 只能包含小写字母、数字、连字符");
if (plugin.plugin !== plugin.name) fail("plugin.json plugin 必须与 name 一致");
if (!plugin.author || !plugin.author.name || !plugin.author.email) fail("plugin.json author 需包含 name 和 email");
for (const key of ["displayName", "profession", "displayDescription", "defaultInitPrompt"]) {
  if (!hasZhEn(plugin[key])) fail(`plugin.json ${key} 需包含 zh 和 en`);
}
const descLen = [...plugin.displayDescription.zh].length;
if (descLen < 40 || descLen > 50) fail(`displayDescription.zh 须 40-50 字，当前 ${descLen} 字`);
for (const key of ["tags", "quickPrompts"]) {
  if (!Array.isArray(plugin[key]) || plugin[key].length !== 3 || !plugin[key].every(hasZhEn)) {
    fail(`plugin.json ${key} 必须恰好 3 条，且每条含 zh 和 en`);
  }
}
for (const lang of ["zh", "en"]) {
  if (plugin.defaultInitPrompt[lang] !== plugin.quickPrompts[0][lang]) {
    fail(`defaultInitPrompt.${lang} 必须与 quickPrompts[0].${lang} 一致`);
  }
}
const CATEGORY_IDS = [
  "01-ProductDesign", "02-Engineering", "03-GameSpatial", "04-DataAI", "05-MarketingGrowth",
  "06-ContentCreative", "07-SalesCommerce", "08-FinanceInvestment", "09-OperationsHR",
  "10-ProjectQuality", "11-SecurityCompliance", "12-IndustryConsultant", "13-TencentZone",
];
if (!CATEGORY_IDS.includes(plugin.categoryId)) fail(`categoryId 无效: ${plugin.categoryId}`);

const avatar = rel(plugin.avatar);
if (!fs.existsSync(avatar)) fail(`头像不存在: ${plugin.avatar}`);
const png = pngSize(avatar);
if (png) {
  if (png.width !== 512 || png.height !== 512) fail(`头像须 512×512，当前 ${png.width}×${png.height}`);
  if (png.bytes > 500 * 1024) fail(`头像须 ≤500KB，当前 ${Math.round(png.bytes / 1024)}KB`);
}

for (const agentPath of plugin.agents) {
  const file = rel(agentPath);
  if (!fs.existsSync(file)) fail(`Agent 文件不存在: ${agentPath}`);
  const text = fs.readFileSync(file, "utf8");
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) fail(`${agentPath} 缺少 YAML frontmatter`);
  for (const key of ["name", "description", "displayName", "profession"]) {
    if (!new RegExp(`^${key}:`, "m").test(fm[1])) fail(`${agentPath} frontmatter 缺少 ${key}`);
  }
  const nameLine = fm[1].match(/^name:\s*(.+)$/m);
  if (nameLine[1].trim() !== path.basename(file, ".md")) fail(`${agentPath} 的 name 须与文件名一致`);
}
if (!plugin.agents.some(a => path.basename(a, ".md") === plugin.agentName)) {
  fail(`agentName "${plugin.agentName}" 不对应 agents 中的任何文件`);
}

// 内置技能：打包时从 workbuddy/skill/ 复制，保证与独立上架的技能一致
const staging = fs.mkdtempSync(path.join(require("os").tmpdir(), "wb-expert-"));
const stagedExpert = path.join(staging, expertName);
fs.cpSync(expertDir, stagedExpert, { recursive: true });
for (const skillPath of plugin.skills || []) {
  const skillDirName = path.basename(skillPath);
  const source = path.join(skillParent, skillDirName);
  if (!fs.existsSync(source)) fail(`plugin.json skills 引用的 ${skillDirName} 不在 workbuddy/skill/ 下`);
  const dest = path.join(stagedExpert, skillPath.replace(/^\.\//, ""));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(source, dest, { recursive: true });
  checkSkill(path.join(dest, "SKILL.md"));
}
zipDir(staging, expertName, path.join(outDir, `${expertName}-${plugin.version}.zip`));
fs.rmSync(staging, { recursive: true, force: true });
