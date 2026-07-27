import { defineConfig } from "vitepress";

const siteUrl = "https://hanliang97.github.io/MatrixMedia/";
const siteTitle = "矩媒 MatrixMedia — 自媒体矩阵批量发布工具";
const siteDescription =
  "矩媒 MatrixMedia：开源自媒体矩阵工具。支持抖音、快手、小红书、视频号、B站、百家号、头条、番茄视频等多平台批量发布，提供 GUI、CLI、HTTP API 与 MCP，便于脚本与 AI 智能体编排。";

export default defineConfig({
  base: "/MatrixMedia/",
  lang: "zh-CN",
  title: "矩媒 MatrixMedia",
  description: siteDescription,
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  // 避免继承仓库根 .postcssrc.js（需要根项目的 autoprefixer）
  vite: {
    css: {
      postcss: {
        plugins: [],
      },
    },
  },

  head: [
    ["link", { rel: "icon", href: "/MatrixMedia/favicon.ico" }],
    ["meta", { name: "robots", content: "index,follow" }],
    ["meta", { name: "theme-color", content: "#0f766e" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "矩媒 MatrixMedia" }],
    ["meta", { property: "og:title", content: siteTitle }],
    ["meta", { property: "og:description", content: siteDescription }],
    ["meta", { property: "og:url", content: siteUrl }],
    ["meta", { property: "og:image", content: `${siteUrl}og.png` }],
    ["meta", { property: "og:locale", content: "zh_CN" }],
    ["meta", { name: "twitter:card", content: "summary" }],
    ["meta", { name: "twitter:title", content: siteTitle }],
    ["meta", { name: "twitter:description", content: siteDescription }],
    ["meta", { name: "twitter:image", content: `${siteUrl}og.png` }],
    ["link", { rel: "canonical", href: siteUrl }],
  ],

  sitemap: {
    hostname: siteUrl,
  },

  themeConfig: {
    logo: "/logo.png",
    siteTitle: "矩媒 MatrixMedia",
    outline: { label: "本页目录" },
    lastUpdated: { text: "最后更新" },
    docFooter: { prev: "上一页", next: "下一页" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题",

    nav: [
      { text: "首页", link: "/" },
      { text: "指南", link: "/guide/getting-started" },
      {
        text: "参考",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "HTTP API", link: "/reference/http-api" },
          { text: "MCP", link: "/reference/mcp" },
        ],
      },
      {
        text: "下载",
        items: [
          {
            text: "GitHub Releases",
            link: "https://github.com/hanliang97/MatrixMedia/releases",
          },
          {
            text: "Gitee Releases",
            link: "https://gitee.com/gzlingyi_0/pubtw/releases/",
          },
        ],
      },
      {
        text: "GitHub",
        link: "https://github.com/hanliang97/MatrixMedia",
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [{ text: "快速开始", link: "/guide/getting-started" }],
        },
      ],
      "/reference/": [
        {
          text: "参考",
          items: [
            { text: "CLI", link: "/reference/cli" },
            { text: "HTTP API", link: "/reference/http-api" },
            { text: "MCP", link: "/reference/mcp" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/hanliang97/MatrixMedia" },
    ],

    footer: {
      message: "开源自媒体矩阵批量发布工具 · GPL-2.0",
      copyright:
        'Copyright © MatrixMedia · <a href="https://github.com/hanliang97/MatrixMedia">GitHub</a>',
    },

    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "搜索", buttonAriaLabel: "搜索" },
          modal: {
            displayDetails: "显示详情",
            resetButtonTitle: "清除查询",
            backButtonTitle: "返回",
            noResultsText: "无结果",
            footer: {
              selectText: "选择",
              navigateText: "切换",
              closeText: "关闭",
            },
          },
        },
      },
    },
  },

  transformPageData(pageData) {
    const isHome = pageData.relativePath === "index.md";
    const path = isHome ? "" : pageData.relativePath.replace(/\.md$/, "");
    const url = `${siteUrl}${path}`.replace(/\/index$/, "/");
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(["link", { rel: "canonical", href: url }]);
    pageData.frontmatter.head.push([
      "meta",
      { property: "og:url", content: url },
    ]);
    if (!isHome && pageData.title) {
      pageData.frontmatter.head.push([
        "meta",
        {
          property: "og:title",
          content: `${pageData.title} | 矩媒 MatrixMedia`,
        },
      ]);
    }
  },

  transformHead({ pageData }) {
    if (pageData.relativePath !== "index.md") return [];
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "矩媒 MatrixMedia",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Windows, macOS, Linux",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "CNY",
      },
      description: siteDescription,
      url: siteUrl,
      downloadUrl: "https://github.com/hanliang97/MatrixMedia/releases",
      license: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
      codeRepository: "https://github.com/hanliang97/MatrixMedia",
    };
    return [
      ["script", { type: "application/ld+json" }, JSON.stringify(jsonLd)],
    ];
  },
});
