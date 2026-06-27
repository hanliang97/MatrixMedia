<template>
  <div class="page-shell project-detail">
    <div class="page-header">
      <h1 class="page-title">项目详情</h1>
      <p class="page-desc">
        矩媒 MatrixMedia v{{ appVersion }} —
        多平台视频矩阵发布与批量分发工具（Electron + CLI + HTTP + MCP）
      </p>
    </div>

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
    };
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
</style>
