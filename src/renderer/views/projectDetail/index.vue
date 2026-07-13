<template>
  <div class="page-shell project-detail">
    <div class="page-header">
      <h1 class="page-title">项目详情</h1>
      <p class="page-desc">
        矩媒 MatrixMedia v{{ appVersion }} —
        多平台视频矩阵发布与批量分发工具（Electron + CLI + HTTP + MCP）
      </p>
    </div>

    <div class="tab-toggle">
      <el-button
        :type="activeTab === 'docs' ? 'primary' : 'info'"
        @click="activeTab = 'docs'"
      >📋 项目文档</el-button>
      <el-button
        :type="activeTab === 'dev' ? 'danger' : 'info'"
        @click="activeTab = 'dev'"
      >🚀 快速开发新平台</el-button>
    </div>

    <!-- Tab: 项目文档 -->
    <div v-if="activeTab === 'docs'">
    <el-card class="section-card" shadow="never">
      <div slot="header" class="card-header">
        <span>项目概览</span>
      </div>
      <ul class="overview-list">
        <li>
          支持 GUI 图形界面、CLI 命令行、内置 HTTP API、MCP Server 四种接入方式
        </li>
        <li>CLI 与 GUI 共用同一 session partition，登录态可复用</li>
        <li>
          HTTP API 需 GUI 主进程已启动（默认端口 <code>{{ httpPort }}</code
          >）
        </li>
        <li>MCP Server 通过 stdio 调用 CLI 子进程，不直接请求 HTTP</li>
      </ul>
    </el-card>

    <el-card class="section-card" shadow="never">
      <div slot="header" class="card-header">
        <span>HTTP API</span>
        <span class="card-sub">基础地址：http://127.0.0.1:{{ httpPort }}</span>
      </div>
      <p class="section-tip">
        GUI 启动后自动监听本机端口，与 CLI 共用登录态与发布记录。<code
          >POST /publish</code
        >
        支持下方<strong>全部 {{ videoPlatforms.length }} 个视频平台</strong
        >；可传单平台 <code>platform</code> 或多平台
        <code>platforms</code> 数组（二者不可同时传）。
      </p>
      <el-table :data="httpRoutes" border size="small" class="doc-table">
        <el-table-column prop="method" label="方法" width="80" />
        <el-table-column prop="path" label="路径" width="140" />
        <el-table-column prop="desc" label="说明" />
      </el-table>
      <div class="code-label platform-table-label">
        支持的视频平台（platform / platforms 均可使用 code 或中文名）
      </div>
      <el-table :data="videoPlatforms" border size="small" class="doc-table">
        <el-table-column prop="code" label="推荐 code" width="100" />
        <el-table-column prop="name" label="平台" width="100" />
        <el-table-column prop="aliases" label="别名" width="180">
          <template slot-scope="scope">
            {{ scope.row.aliases.join(" / ") }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="自动化" />
      </el-table>
      <el-table :data="httpPublishParams" border size="small" class="doc-table">
        <el-table-column prop="field" label="字段" width="140" />
        <el-table-column prop="required" label="必填" width="72" />
        <el-table-column prop="desc" label="说明" />
      </el-table>
      <div class="code-block">
        <div class="code-label">单平台发布（platform）</div>
        <pre class="code-pre">{{ curlPublishExample }}</pre>
      </div>
      <div class="code-block">
        <div class="code-label">多平台发布（platforms 字符串数组）</div>
        <pre class="code-pre">{{ curlMultiPublishExample }}</pre>
      </div>
      <div class="code-block">
        <div class="code-label">
          多平台发布（platforms 对象数组，可覆盖各平台 phone）
        </div>
        <pre class="code-pre">{{ curlMultiPublishObjectExample }}</pre>
      </div>
    </el-card>

    <el-card class="section-card" shadow="never">
      <div slot="header" class="card-header">
        <span>MCP 调用方式</span>
      </div>
      <p class="section-tip">
        构建 MCP Server 后，在 Claude Desktop / Cursor / Cline 等工具中配置
        stdio transport。
      </p>
      <div class="code-block">
        <div class="code-label">构建</div>
        <pre class="code-pre">cd mcp && npm install && npm run build</pre>
      </div>
      <div class="code-block">
        <div class="code-label">
          配置示例（.cursor/mcp.json 或 claude_desktop_config.json）
        </div>
        <pre class="code-pre">{{ mcpConfigExample }}</pre>
      </div>
      <el-table :data="mcpTools" border size="small" class="doc-table">
        <el-table-column prop="name" label="Tool" width="160" />
        <el-table-column prop="desc" label="说明" />
        <el-table-column prop="cli" label="底层 CLI" width="200" />
      </el-table>
      <p class="section-note">
        登录说明：所有平台需在 GUI 中完成登录后再通过 MCP 发布；MCP 运行在无头
        stdio 环境，无法弹出扫码窗口。
      </p>
    </el-card>

    <el-card class="section-card" shadow="never">
      <div slot="header" class="card-header">
        <span>CLI 调用方式</span>
      </div>
      <p class="section-tip">
        argv 含子串 <code>cli</code> 即进入无 GUI 流程。
      </p>
      <div class="code-block">
        <div class="code-label">入口</div>
        <pre class="code-pre">
matrixmedia cli &lt;子命令&gt; [选项]
electron . cli &lt;子命令&gt; [选项]   # 开发环境</pre
        >
      </div>
      <el-table :data="cliCommands" border size="small" class="doc-table">
        <el-table-column prop="cmd" label="子命令" width="140" />
        <el-table-column prop="desc" label="说明" />
      </el-table>
      <div class="code-block">
        <div class="code-label">常用示例</div>
        <pre class="code-pre">{{ cliExamples }}</pre>
      </div>
      <el-table :data="exitCodes" border size="small" class="doc-table">
        <el-table-column prop="code" label="退出码" width="80" />
        <el-table-column prop="desc" label="含义" />
      </el-table>
    </el-card>
    </div><!-- /Tab: 项目文档 -->

    <!-- Tab: 快速开发新平台 -->
    <div v-if="activeTab === 'dev'" class="dev-guide-content">
      <el-card class="section-card" shadow="never">
        <div slot="header" class="card-header">
          <span>🚀 二次开发指南 — 新平台接入</span>
          <el-button
            type="danger"
            size="mini"
            style="float: right"
            @click="openGitHubRepo"
          >前往 GitHub 仓库</el-button>
        </div>

        <!-- 第一步：环境准备 -->
        <div class="dev-section">
          <h3>第一步：环境准备</h3>
          <el-table :data="envRequirements" border size="small" class="doc-table">
            <el-table-column prop="name" label="工具" width="140" />
            <el-table-column prop="version" label="版本要求" width="120" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <div class="code-block">
            <div class="code-label">安装项目依赖</div>
            <pre class="code-pre">yarn install</pre>
          </div>
        </div>

        <!-- 第二步：平台配置 -->
        <div class="dev-section">
          <h3>第二步：平台配置（2 个文件需同步修改）</h3>
          <el-table :data="configFiles" border size="small" class="doc-table">
            <el-table-column prop="file" label="文件路径" width="320" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <div class="code-block">
            <div class="code-label">在 configUrl.js 中新增平台配置示例</div>
            <pre class="code-pre">{{ configExample }}</pre>
          </div>
        </div>

        <!-- 第三步：上传逻辑 -->
        <div class="dev-section">
          <h3>第三步：上传视频逻辑</h3>
          <p class="section-tip">
            在 <code>src/main/services/upLoad/</code> 目录下新建平台 JS 文件（如
            <code>mypt.js</code>）， 实现 Puppeteer 自动化上传流程，然后在
            <code>index.js</code> 中注册导出。
          </p>
          <el-table :data="uploadFiles" border size="small" class="doc-table">
            <el-table-column prop="file" label="文件路径" width="320" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <div class="code-block">
            <div class="code-label">新建平台上传文件模板（mypt.js）</div>
            <pre class="code-pre">{{ uploadTemplate }}</pre>
          </div>
          <div class="code-block">
            <div class="code-label">在 upLoad/index.js 中注册</div>
            <pre class="code-pre">export { default as mypt } from "./mypt.js";</pre>
          </div>
        </div>

        <!-- 第四步：获取状态 -->
        <div class="dev-section">
          <h3>第四步：获取发布状态逻辑</h3>
          <p class="section-tip">
            在 <code>src/main/services/zt/</code> 目录下新建同名平台 JS 文件，
            实现从平台列表页抓取视频发布状态的逻辑，然后在
            <code>index.js</code> 中注册。
          </p>
          <el-table :data="statusFiles" border size="small" class="doc-table">
            <el-table-column prop="file" label="文件路径" width="320" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <div class="code-block">
            <div class="code-label">在 zt/index.js 中注册</div>
            <pre class="code-pre">import mypt from "./mypt.js";
// 在 default export 对象中添加
export default {
  // ...已有平台
  mypt,
};</pre>
          </div>
        </div>

        <!-- 第五步：平台图标 -->
        <div class="dev-section">
          <h3>第五步：平台图标</h3>
          <p class="section-tip">
            在 <code>src/renderer/layout/components/Sidebar/ptcion/</code>
            目录下放置平台图标文件， 文件名需与平台在 configUrl.js 中的 key 一致。
          </p>
          <el-table :data="iconFiles" border size="small" class="doc-table">
            <el-table-column prop="file" label="文件路径" width="360" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
        </div>

        <!-- 第六步：渲染层工具 -->
        <div class="dev-section">
          <h3>第六步：渲染层工具与配置</h3>
          <el-table :data="rendererFiles" border size="small" class="doc-table">
            <el-table-column prop="file" label="文件路径" width="320" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
        </div>

        <!-- 第七步：CLI 支持 -->
        <div class="dev-section">
          <h3>第七步：CLI 命令行支持</h3>
          <p class="section-tip">
            如需通过 CLI 发布新平台，需在以下文件中注册平台映射。
          </p>
          <el-table :data="cliFiles" border size="small" class="doc-table">
            <el-table-column prop="file" label="文件路径" width="360" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
        </div>

        <!-- 第八步：MCP 支持 -->
        <div class="dev-section">
          <h3>第八步：MCP Server 支持（可选）</h3>
          <p class="section-tip">
            如需通过 MCP（Claude Desktop / Cursor / Cline）调用新平台发布，需修改 MCP 工具定义。
          </p>
          <el-table :data="mcpFiles" border size="small" class="doc-table">
            <el-table-column prop="file" label="文件路径" width="360" />
            <el-table-column prop="desc" label="说明" />
          </el-table>
          <div class="code-block">
            <div class="code-label">构建 MCP Server</div>
            <pre class="code-pre">cd mcp && npm install && npm run build</pre>
          </div>
        </div>

        <!-- 文件清单汇总 -->
        <div class="dev-section">
          <h3>📋 完整文件清单汇总</h3>
          <el-table :data="allFiles" border size="small" class="doc-table">
            <el-table-column prop="step" label="步骤" width="80" />
            <el-table-column prop="file" label="文件路径" />
            <el-table-column prop="action" label="操作" width="80" />
          </el-table>
        </div>
      </el-card>
    </div><!-- /Tab: 快速开发新平台 -->
  </div>
</template>

<script>
import packageInfo from "../../../../package.json";
import { VIDEO_PUBLISH_PLATFORM_DOCS } from "../../../shared/publishPlatforms.js";

export default {
  name: "ProjectDetail",
  data() {
    const videoPlatforms = VIDEO_PUBLISH_PLATFORM_DOCS.map((item) => ({
      code: item.code,
      name: item.name,
      aliases: item.aliases,
      status: item.automated ? "已自动化" : item.note || "待完善",
    }));
    return {
      appVersion: packageInfo.version,
      httpPort: 30088,
      activeTab: "docs",
      videoPlatforms,
      httpRoutes: [
        { method: "GET", path: "/", desc: "返回 MatrixMedia API 欢迎页" },
        {
          method: "GET",
          path: "/platforms",
          desc: "返回 HTTP 支持的全部视频平台列表（JSON）",
        },
        {
          method: "POST",
          path: "/changeData",
          desc: "读写本地 JSON 数据（账号树、发布历史 pushData 等）；body: { fileName, type, item }，type 含 add/update/delete/get/config",
        },
        {
          method: "POST",
          path: "/publish",
          desc: "发布视频到任意已支持平台；单平台传 platform，多平台传 platforms 数组",
        },
      ],
      httpPublishParams: [
        {
          field: "platform",
          required: "单平台",
          desc: "任一下表平台 code 或中文名，如 xhs / 小红书（与 platforms 二选一）",
        },
        {
          field: "platforms",
          required: "多平台",
          desc: '平台数组，可包含全部 8 个平台；如 ["dy","xhs","ks"] 或对象数组 [{ "platform": "dy", "phone": "138..." }, ...]',
        },
        {
          field: "file",
          required: "是",
          desc: "本地视频绝对路径，或 http(s) 远程 URL",
        },
        { field: "title", required: "是", desc: "视频标题" },
        {
          field: "phone",
          required: "二选一",
          desc: "账号手机号；多平台时作为默认值，对象数组内可单独覆盖",
        },
        {
          field: "partition",
          required: "二选一",
          desc: "完整 session，如 persist:13800138000抖音",
        },
        {
          field: "bt2",
          required: "否",
          desc: "视频号短标（含视频号时建议填写）",
        },
        { field: "tags", required: "否", desc: "标签，空格分隔" },
        {
          field: "publishAt",
          required: "否",
          desc: "定时发布 YYYY-MM-DD HH:mm:ss（多平台时需全部一致）",
        },
      ],
      mcpTools: [
        {
          name: "list_accounts",
          desc: "列出本机已登录账号，支持按平台过滤",
          cli: "cli accounts --json",
        },
        {
          name: "list_history",
          desc: "查询本机发布记录，支持按平台/状态/天数过滤",
          cli: "cli history --json",
        },
        {
          name: "publish_video",
          desc: "发布视频到指定平台（最长约 35 分钟，支持定时发布）",
          cli: "cli publish ...",
        },
        {
          name: "publish_article",
          desc: "发布掘金文章（需已登录掘金账号）",
          cli: "cli publish-article ...",
        },
      ],
      cliCommands: [
        { cmd: "login", desc: "扫码登录，当前支持抖音、视频号" },
        {
          cmd: "publish",
          desc: "发布视频，7 个平台已自动化（抖音/快手/百家号/哔哩哔哩/头条/视频号/小红书）",
        },
        {
          cmd: "publish-article",
          desc: "发布掘金文章，支持 --content 或 --file",
        },
        { cmd: "accounts", desc: "查看本机账号与登录态，--json 输出稳定 JSON" },
        { cmd: "history", desc: "查看发布历史，--json 输出稳定 JSON" },
      ],
      exitCodes: [
        { code: "0", desc: "成功" },
        { code: "1", desc: "未捕获异常" },
        { code: "2", desc: "参数错误" },
        { code: "3", desc: "业务失败（未登录、上传失败等）" },
      ],
      curlPublishExample: `curl -X POST http://127.0.0.1:30088/publish \\
  -H "Content-Type: application/json" \\
  -d '{
    "platform": "dy",
    "phone": "13800138000",
    "file": "/path/to/video.mp4",
    "title": "我的视频标题",
    "tags": "减脂 健身"
  }'`,
      curlMultiPublishExample: `curl -X POST http://127.0.0.1:30088/publish \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "13800138000",
    "file": "https://example.com/video.mp4",
    "title": "我的视频标题",
    "bt2": "5公里新手挑战",
    "tags": "跑步 新手",
    "platforms": ["dy", "sph", "blbl", "bjh", "tt", "ks", "xhs"]
  }'`,
      curlMultiPublishObjectExample: `curl -X POST http://127.0.0.1:30088/publish \\
  -H "Content-Type: application/json" \\
  -d '{
    "file": "/path/to/video.mp4",
    "title": "我的视频标题",
    "tags": "日常 vlog",
    "platforms": [
      { "platform": "dy", "phone": "13800138000" },
      { "platform": "sph", "phone": "13800138000" },
      { "platform": "ks", "phone": "13900139000" }
    ]
  }'`,
      mcpConfigExample: `{
  "mcpServers": {
    "matrixmedia": {
      "command": "node",
      "args": ["<MATRIXMEDIA_DIR>/mcp/dist/index.js"],
      "env": {
        "MATRIXMEDIA_DIR": "<MATRIXMEDIA_DIR>"
      }
    }
  }
}`,
      cliExamples: `# 抖音登录
matrixmedia cli login -p dy --phone 13800138000

# 发布视频
matrixmedia cli publish -p dy --phone 13800138000 -f /path/to/video.mp4 -t "标题"

# 发布掘金文章
matrixmedia cli publish-article -p juejin --phone 13800138000 -t "文章标题" --file ./post.md

# 查看账号 / 历史（JSON）
matrixmedia cli accounts --json
matrixmedia cli history --json --days 7`,
      envRequirements: [
        { name: "Node.js", version: "≥ 16.x", desc: "推荐 18 LTS 或 20 LTS" },
        { name: "Yarn", version: "≥ 1.22", desc: "包管理器，yarn install 安装依赖" },
        { name: "Electron", version: "项目内置", desc: "无需单独安装，yarn install 后自动获取" },
        { name: "Puppeteer", version: "项目内置", desc: "核心自动化引擎，用于驱动浏览器上传" },
        { name: "Chrome", version: "≥ 120", desc: "Puppeteer 会自动下载 Chromium，也可使用系统 Chrome" },
      ],
      configFiles: [
        {
          file: "src/renderer/utils/configUrl.js",
          desc: "渲染层平台配置（登录地址 / 上传地址 / UA / 列表页地址）",
        },
        {
          file: "src/main/config/ptConfig.js",
          desc: "主进程平台配置，需与 configUrl.js 保持一致（CLI / 主进程使用）",
        },
      ],
      uploadFiles: [
        {
          file: "src/main/services/upLoad/新平台.js",
          desc: "新建：实现 Puppeteer 上传视频自动化流程（参考 dy.js / ks.js）",
        },
        {
          file: "src/main/services/upLoad/index.js",
          desc: "修改：注册新平台导出 export { default as mypt } from './mypt.js'",
        },
        {
          file: "src/main/services/upLoad/uploadTimeouts.js",
          desc: "参考：选择器等待 / 上传超时等通用常量，按需复用",
        },
        {
          file: "src/main/services/upLoad/closeWindow.js",
          desc: "参考：发布完成后窗口关闭通用逻辑",
        },
      ],
      statusFiles: [
        {
          file: "src/main/services/zt/新平台.js",
          desc: "新建：实现从平台列表页获取视频发布状态（参考 dy.js）",
        },
        {
          file: "src/main/services/zt/index.js",
          desc: "修改：import 新平台并加入 default export 对象",
        },
      ],
      iconFiles: [
        {
          file: "src/renderer/layout/components/Sidebar/ptcion/新平台.png",
          desc: "新建：放置平台图标，文件名与 configUrl.js 中平台 key 一致（png / jpg / svg 均可）",
        },
      ],
      rendererFiles: [
        {
          file: "src/renderer/utils/configUrl.js",
          desc: "平台配置（第二步已涉及）",
        },
        {
          file: "src/renderer/utils/getLoginInfo.js",
          desc: "登录状态检测逻辑，如新平台需特殊登录流程需修改此文件",
        },
        {
          file: "src/renderer/utils/dataRequest.js",
          desc: "本地数据读写工具（账号树 / 发布记录），一般无需修改",
        },
        {
          file: "src/renderer/utils/openLoginWindow.js",
          desc: "打开登录窗口工具，一般无需修改",
        },
      ],
      cliFiles: [
        {
          file: "src/main/cli/index.js",
          desc: "CLI 入口，publish 命令路由，新平台需在此注册或确认已通过 ptConfig 自动路由",
        },
        {
          file: "src/main/cli/parsePublishArgs.js",
          desc: "publish 子命令参数解析，-p 平台参数支持的别名在此定义",
        },
        {
          file: "src/main/cli/parsePublishArticleArgs.js",
          desc: "publish-article 子命令参数解析（掘金文章专用，非视频平台可忽略）",
        },
        {
          file: "src/main/cli/parseLoginArgs.js",
          desc: "login 子命令参数解析，如新平台支持 CLI 登录需修改此文件",
        },
        {
          file: "src/main/cli/parseAccountsArgs.js",
          desc: "accounts 子命令参数解析，一般无需修改",
        },
        {
          file: "src/main/cli/parseHistoryArgs.js",
          desc: "history 子命令参数解析，一般无需修改",
        },
        {
          file: "src/main/cli/runAccountsCli.js",
          desc: "accounts 命令执行逻辑，一般无需修改",
        },
        {
          file: "src/main/cli/runHistoryCli.js",
          desc: "history 命令执行逻辑，一般无需修改",
        },
        {
          file: "src/main/cli/detectArgv.js",
          desc: "CLI 模式检测，一般无需修改",
        },
        {
          file: "src/main/services/cliLogin/",
          desc: "CLI 扫码登录实现目录（douyinCliLogin.js / sphCliLogin.js），如新平台需 CLI 登录在此新建",
        },
      ],
      mcpFiles: [
        {
          file: "mcp/src/tools/publish.ts",
          desc: "publish_video 工具定义，在 PLATFORM_CN 映射表与 enum 中添加新平台 code",
        },
        {
          file: "mcp/src/tools/publishArticle.ts",
          desc: "publish_article 工具定义（掘金专用，非文章平台可忽略）",
        },
        {
          file: "mcp/src/tools/accounts.ts",
          desc: "list_accounts 工具定义，一般无需修改",
        },
        {
          file: "mcp/src/tools/history.ts",
          desc: "list_history 工具定义，一般无需修改",
        },
        {
          file: "mcp/src/index.ts",
          desc: "MCP Server 入口，工具注册，一般无需修改",
        },
        {
          file: "mcp/src/runner.ts",
          desc: "CLI 子进程调用封装，一般无需修改",
        },
      ],
      allFiles: [
        { step: "1", file: "（环境）Node.js ≥ 16 + Yarn", action: "安装" },
        { step: "2", file: "src/renderer/utils/configUrl.js", action: "修改" },
        { step: "2", file: "src/main/config/ptConfig.js", action: "修改" },
        { step: "3", file: "src/main/services/upLoad/新平台.js", action: "新建" },
        { step: "3", file: "src/main/services/upLoad/index.js", action: "修改" },
        { step: "4", file: "src/main/services/zt/新平台.js", action: "新建" },
        { step: "4", file: "src/main/services/zt/index.js", action: "修改" },
        { step: "5", file: "src/renderer/layout/components/Sidebar/ptcion/新平台.png", action: "新建" },
        { step: "6", file: "src/renderer/utils/getLoginInfo.js", action: "按需" },
        { step: "7", file: "src/main/cli/parsePublishArgs.js", action: "修改" },
        { step: "7", file: "src/main/cli/parseLoginArgs.js", action: "按需" },
        { step: "7", file: "src/main/services/cliLogin/新平台.js", action: "按需" },
        { step: "8", file: "mcp/src/tools/publish.ts", action: "修改" },
      ],
      configExample: `export default {
  // ...已有平台
  我的新平台: {
    index: "https://example.com/login",        // 登录页
    upload: "https://example.com/upload",      // 上传页
    useragent: "Mozilla/5.0 (...)",            // User-Agent
    listIndex: "https://example.com/manage",   // 内容管理/列表页（获取状态用）
  },
};`,
      uploadTemplate: `import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { WAIT_SELECTOR_APPEAR_MS, pollPageUntil } from "./uploadTimeouts.js";

export default async function (page, data, window, event) {
  console.log("开始处理新平台:", data);

  // 1. 等待上传页面加载
  await page.waitForSelector('input[type="file"]', {
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });

  // 2. 上传视频文件
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile(data.filePath);

  // 3. 填写标题
  await page.waitForSelector(".title-input", { timeout: WAIT_SELECTOR_APPEAR_MS });
  await page.type(".title-input", data.bt || data.textOtherName || "");

  // 4. 等待上传完成
  await pollPageUntil(page, async () => {
    const progress = await page.$eval(".upload-progress", el => el.textContent);
    return progress.includes("100%");
  });

  // 5. 点击发布按钮
  await page.click(".publish-btn");

  // 6. 等待发布完成并关闭窗口
  await maybeClosePublishWindow(window, page);
}`,
    };
  },
  methods: {
    openGitHubRepo() {
      window.open("https://github.com/hanliang97/MatrixMedia", "_blank");
    },
  },
};
</script>

<style rel="stylesheet/scss" lang="scss" scoped>
@import "@/styles/variables.scss";

.overview-list {
  margin: 0;
  padding-left: 20px;
  color: #606266;
  line-height: 1.8;
  font-size: 14px;
}

.section-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #909399;
  line-height: 1.6;
}

.section-note {
  margin: 12px 0 0;
  font-size: 13px;
  color: #e6a23c;
  line-height: 1.6;
}

.doc-table {
  margin-bottom: 12px;
}

.code-block {
  margin-top: 8px;
}

.code-label {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
}

.platform-table-label {
  margin-top: 4px;
}

.code-pre {
  margin: 0;
  padding: 12px 14px;
  background-color: #1e1e1e;
  color: #d4d4d4;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

code {
  padding: 2px 6px;
  background-color: #f0f2f5;
  border-radius: 3px;
  font-size: 12px;
  color: #c7254e;
}

.tab-toggle {
  margin-bottom: 16px;
  display: flex;
  gap: 12px;
}

.dev-section {
  margin-bottom: 24px;

  h3 {
    margin: 0 0 10px;
    font-size: 16px;
    color: #303133;
    border-left: 4px solid #f56c6c;
    padding-left: 10px;
  }
}
</style>
