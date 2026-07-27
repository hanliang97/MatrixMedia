# VitePress 官网 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本仓库 `website/` 落地 VitePress 官网（产品首页 + 公开文档 + SEO），经 GitHub Actions 部署到 `https://hanliang97.github.io/MatrixMedia/`。

**Architecture:** 独立 `website/` 包，不污染根 `package.json`。公开文档从根 `docs/{cli,http-api,mcp}.md` 拷贝到 `website/reference/` 并改站内链接。VitePress SSG，`base: '/MatrixMedia/'`，Actions 部署 `gh-pages`。

**Tech Stack:** VitePress 1.x、Node 20、GitHub Actions + `peaceiris/actions-gh-pages`（或等价）。

## Global Constraints

- 站点仅在本仓库 `website/`，不新开独立仓
- 不接 Cloudflare / 自定义域名（v1）
- 永不编入 `docs/superpowers/**`
- 文案中文；`lang: 'zh-CN'`
- 根依赖不安装 VitePress

## File Map

| 路径 | 职责 |
| --- | --- |
| `website/package.json` | 站点脚本与 vitepress 依赖 |
| `website/.vitepress/config.mts` | base、nav、sidebar、SEO head、sitemap |
| `website/.vitepress/theme/index.ts` | 默认主题 + 首页样式入口 |
| `website/.vitepress/theme/custom.css` | 首页轻量样式 |
| `website/index.md` | 落地首页 |
| `website/guide/getting-started.md` | 快速开始 |
| `website/reference/{cli,http-api,mcp}.md` | 公开文档副本 |
| `website/public/{favicon.ico,og.png,logo.png}` | 静态资源 |
| `.github/workflows/deploy-website.yml` | 构建并部署 Pages |
| `README.md` | 增加官网链接 |

---

### Task 1: Scaffold VitePress + SEO 配置

**Files:**
- Create: `website/package.json`
- Create: `website/.vitepress/config.mts`
- Create: `website/.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "matrixmedia-website",
  "private": true,
  "type": "module",
  "scripts": {
    "docs:dev": "vitepress dev",
    "docs:build": "vitepress build",
    "docs:preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "^1.6.3"
  }
}
```

- [ ] **Step 2: 写入 config.mts**

要点（实现时写全量）：

- `base: '/MatrixMedia/'`
- `lang: 'zh-CN'`
- `title` / `description` 按 spec
- `head`: favicon、og、twitter、robots、canonical 用 transformPageHtml 或 per-page；首页 JSON-LD 放 `index.md` 的 script 或 config `transformHead`
- `themeConfig.nav` / `sidebar` 按 spec
- `sitemap.hostname: 'https://hanliang97.github.io/MatrixMedia/'`
- `cleanUrls: true` 可选

- [ ] **Step 3: website/.gitignore**

```
node_modules
.vitepress/dist
.vitepress/cache
```

- [ ] **Step 4: 安装并确认 CLI 可用**

Run: `cd website && npm install && npx vitepress --version`  
Expected: 打印 1.x 版本号

- [ ] **Step 5: Commit**

```bash
git add website/package.json website/package-lock.json website/.vitepress/config.mts website/.gitignore
git commit -m "$(cat <<'EOF'
feat(website): 初始化 VitePress 站点与 SEO 配置

- 新增：website 独立包、base=/MatrixMedia/、nav/sidebar/sitemap
EOF
)"
```

---

### Task 2: 静态资源 + 首页 + 快速开始

**Files:**
- Create: `website/public/favicon.ico`（从 `lib/icons/icon.ico` 复制）
- Create: `website/public/logo.png`（从 `lib/icons/icon.png` 复制）
- Create: `website/public/og.png`（同 logo 或导出 1200×630；v1 可用 logo 放大图，文件名 `og.png`）
- Create: `website/.vitepress/theme/index.ts`
- Create: `website/.vitepress/theme/custom.css`
- Create: `website/index.md`
- Create: `website/guide/getting-started.md`

- [ ] **Step 1: 复制图标**

```bash
cp lib/icons/icon.ico website/public/favicon.ico
cp lib/icons/icon.png website/public/logo.png
cp lib/icons/icon.png website/public/og.png
```

- [ ] **Step 2: 主题入口**

`theme/index.ts` 继承默认主题并 `import './custom.css'`。

- [ ] **Step 3: 首页 index.md**

含 Hero（可用 VitePress `layout: home` 的 hero/features），区块覆盖：平台、能力、文档入口、教程视频、Footer 信息。frontmatter 设 `title` / `description`。页面底部或 head 注入 SoftwareApplication JSON-LD。

- [ ] **Step 4: getting-started.md**

下载链接（GitHub / Gitee Releases）、安装提示、指向 reference 三篇文档、B 站教程。

- [ ] **Step 5: 本地预览抽查**

Run: `cd website && npm run docs:dev`  
Expected: 首页与「快速开始」可打开，无 404。

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(website): 增加落地首页与快速开始

- 新增：home layout、指南页、logo/favicon/og 资源
EOF
)"
```

---

### Task 3: 拷贝并适配公开文档

**Files:**
- Create: `website/reference/cli.md`
- Create: `website/reference/http-api.md`
- Create: `website/reference/mcp.md`

- [ ] **Step 1: 拷贝三份 md**

从根 `docs/` 复制到 `website/reference/`。

- [ ] **Step 2: 改链接**

- 去掉或改写「返回 README」为站内「返回首页」`/`
- `./http-api.md` → `/reference/http-api`（或相对 `./http-api`）
- `./mcp.md` → `/reference/mcp`
- `./cli.md` → `/reference/cli`
- 不引入任何 `superpowers` 路径

- [ ] **Step 3: 补 frontmatter**

每页独立 `title` + `description`。

- [ ] **Step 4: 构建验证**

Run: `cd website && npm run docs:build`  
Expected: exit 0；`website/.vitepress/dist` 存在；grep 构建产物无 `superpowers`。

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(website): 同步 CLI / HTTP API / MCP 公开文档

- 新增：reference 三页并适配站内链接与 SEO frontmatter
EOF
)"
```

---

### Task 4: GitHub Actions 部署 + README 入口

**Files:**
- Create: `.github/workflows/deploy-website.yml`
- Modify: `README.md`（软件下载/文档区域上方增加官网链接）

- [ ] **Step 1: 写 deploy-website.yml**

- trigger: `push` paths `website/**`、workflow 自身；`workflow_dispatch`
- node 20；`cd website && npm ci && npm run docs:build`
- `peaceiris/actions-gh-pages@v4`，`publish_dir: website/.vitepress/dist`，`github_token: ${{ secrets.GITHUB_TOKEN }}`

- [ ] **Step 2: README 增加官网**

在显眼位置增加：

`官网（GitHub Pages）：https://hanliang97.github.io/MatrixMedia/`

并注明需在仓库 Settings → Pages 将 source 设为 `gh-pages`（首次部署后）。

- [ ] **Step 3: 再跑一次生产构建**

Run: `cd website && npm run docs:build`  
Expected: success；抽查 dist/index.html 含 description / og:title / application/ld+json 之一。

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(website): 增加 Pages 部署工作流与 README 官网入口

- 新增：deploy-website.yml 构建并推送到 gh-pages
- 新增：README 官网链接
EOF
)"
```

---

## 验收对照

| Spec 验收 | 对应 Task |
| --- | --- |
| 本地 docs:dev 可打开首页与文档 | 2、3 |
| CI 部署 Pages | 4（需人工开 Pages + push） |
| SEO 标签 / JSON-LD | 1、2 |
| 无 superpowers | 3 构建 grep |
| README 官网链接 | 4 |

## 人工一步（实现后提醒用户）

GitHub → Settings → Pages → Build and deployment → Source：`Deploy from a branch` → Branch：`gh-pages` / `(root)`，或按 Actions 产物说明启用。
