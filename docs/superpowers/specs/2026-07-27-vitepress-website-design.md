# VitePress 官网（GitHub Pages）设计

## 目标

为 MatrixMedia / 矩媒增加可部署到 GitHub Pages 的静态官网：产品落地首页 + 公开文档，并做好基础 SEO。  
访问地址：`https://hanliang97.github.io/MatrixMedia/`。

## 非目标（v1）

- 不新开独立官网仓库；站点落在本仓库 `website/`
- 不接 Cloudflare / 国内 CDN / 自定义域名（后续可扩展）
- 不把 `docs/superpowers/` 或其它内部规格编入站点
- 不做英文站、不做复杂营销动效、不引入文档全文搜索以外的后端服务
- 不改造 Electron 应用本体

## 方案选型

采用 **独立 `website/` + VitePress SSG + GitHub Actions → `gh-pages`**：

- 站点与 Electron 根依赖隔离
- 公开文档从根目录 `docs/cli.md`、`docs/http-api.md`、`docs/mcp.md` **精简拷贝**进 `website/`（方案 1，单一边界清晰）
- `base: '/MatrixMedia/'` 适配 Project Pages 子路径

## 目录结构

```
website/
  package.json
  .vitepress/
    config.ts
    theme/                 # 仅首页需要时轻量扩展
  index.md                 # 官网落地首页
  guide/
    getting-started.md
  reference/
    cli.md
    http-api.md
    mcp.md
  public/
    favicon.ico
    og.png
.github/workflows/
  deploy-website.yml
```

约定：

- 根 `package.json` 不强制安装 VitePress；本地与 CI 均在 `website/` 内 `npm i` / `npm run build`
- 根 README 增加官网链接（部署可用后）
- 语言：`lang: 'zh-CN'`，文案中文为主，产品名保留「矩媒 / MatrixMedia」

## 信息架构与导航

**顶栏**

- 首页
- 指南（快速开始）
- 参考（CLI / HTTP API / MCP）
- 下载 → GitHub Releases（次要：Gitee Releases）
- GitHub 仓库

**侧栏（文档区）**

- 指南 → 快速开始
- 参考 → CLI、HTTP API、MCP

**落地首页区块**

1. Hero：Logo + 一句话定位 + CTA（下载 / 查看文档）
2. 支持平台：抖音、快手、百家号、B 站、头条、视频号、小红书、番茄视频
3. 能力要点：GUI 矩阵发布、CLI、HTTP API、MCP / AI 编排
4. 快速入口：三份参考文档 + 既有 B 站教程链接
5. Footer：GPL-2.0、仓库链接；可选一行极简说明

首页保持「一屏一个主叙事」，避免仪表盘式堆砌。

## SEO

在 VitePress `head` / frontmatter 中落实：

| 项 | 约定 |
| --- | --- |
| 站点标题 | 矩媒 MatrixMedia — 自媒体矩阵批量发布工具 |
| description | 覆盖：多平台矩阵、批量发布、CLI、MCP、支持平台等核心词 |
| `lang` | `zh-CN` |
| canonical | `https://hanliang97.github.io/MatrixMedia/`（及各页路径） |
| Open Graph / Twitter | `og:title`、`og:description`、`og:image`（`public/og.png`）、`og:url`、`og:type` |
| favicon | `public/favicon.ico`（可来自现有 `lib/icons`） |
| robots | 允许索引 |
| 结构化数据 | 首页 JSON-LD `SoftwareApplication`（name、description、url、applicationCategory 等） |
| sitemap | VitePress 内置或轻量插件生成 `sitemap.xml` |
| 关键词 | 复用 README 关键词思路，写入 description / 正文自然出现，不堆砌隐藏关键词块 |

每篇文档页使用独立 `title` + `description` frontmatter，避免全站同质 title。

## 文档同步策略（v1）

- 手工（或实现时一次性）将根 `docs/cli.md`、`http-api.md`、`mcp.md` 拷入 `website/reference/`
- 站内链接改为相对站点路径；去掉仅对仓库开发者有用的内部锚点若造成死链
- `docs/superpowers/**` 永不拷贝、永不列入 sidebar
- 后续若嫌双份维护，可升级为构建前白名单拷贝脚本（本设计 v1 不做强制）

## 部署

**Workflow**：`.github/workflows/deploy-website.yml`

- 触发：`main` 上 `website/**` 变更，或手动 `workflow_dispatch`
- 步骤：checkout → setup Node → `cd website && npm ci && npm run build` → 将 `website/.vitepress/dist` 部署到 `gh-pages` 分支
- 权限：`contents: write`（或官方 `actions/deploy-pages` + Pages environment，二选一；实现时选仓库已启用的那种）

**仓库设置（需人工一次）**

- GitHub → Settings → Pages → Source：`gh-pages` 分支（或 GitHub Actions 作为 source）
- 无需自定义域名；无需 Cloudflare（后续可选：Pages 前挂 CF 代理或改部署到 CF Pages）

**本地预览**

```bash
cd website && npm i && npm run docs:dev
```

构建产物需在 `base: '/MatrixMedia/'` 下资源路径正确（本地可用 VitePress 的 base 预览）。

## 验收标准

1. `website` 本地 `docs:dev` 可打开首页与三篇参考文档
2. CI 构建成功，Pages 可访问 `https://hanliang97.github.io/MatrixMedia/`
3. 查看源码可见 title、description、og 标签；首页含 JSON-LD
4. 站点内无 `superpowers` 路径或内容
5. README 含官网入口链接

## 后续扩展（不在 v1）

- Cloudflare 代理自定义域名，或改部署 Cloudflare Pages
- 构建前从根 `docs/*.md` 白名单同步
- 中英双语、更完整指南（安装排错、平台差异表等）
