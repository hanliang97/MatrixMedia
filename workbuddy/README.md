# WorkBuddy 开放平台上架

本目录存放上架到 [WorkBuddy 开放平台](https://open.workbuddy.cn/docs/skill) 的源文件。

```
workbuddy/
├── skill/matrixmedia-publish/        # 技能：调用 matrixmedia cli
│   ├── SKILL.md
│   └── references/examples.md
├── expert/matrixmedia-expert/        # 专家「矩矩」：一稿多发 + 账号体检 + 数据复盘
│   ├── .codebuddy-plugin/plugin.json
│   ├── agents/matrixmedia-operator.md
│   └── avatars/expert.png            # 打包时自动内置 skill/matrixmedia-publish
└── connector/matrixmedia/            # 连接器：MCP + Skill
    ├── connector-meta.json
    ├── mcp.json                      # npx -y matrixmedia-mcp（stdio）
    ├── icon.svg
    └── skills/matrixmedia-mcp/SKILL.md
```

## 打包

```bash
yarn pack:workbuddy
# → build/workbuddy/matrixmedia-publish-skill-<ver>.zip
# → build/workbuddy/matrixmedia-connector-<ver>.zip
# → build/workbuddy/matrixmedia-expert-<ver>.zip
```

脚本会校验 SKILL.md 必填字段（description / description_zh / description_en / version / author）、
`@references/` 引用、connector-meta.json 必填项、mcp.json 只有一个 Server 且无硬编码凭证。

专家还会校验：plugin.json 必填字段、`displayDescription.zh` 为 40–50 字、`tags` / `quickPrompts` 恰好 3 条、
`defaultInitPrompt` 与 `quickPrompts[0]` 一致、`categoryId` 合法、头像 512×512 且 ≤500KB、Agent 的 `name` 与文件名一致。

## 上架步骤

### 技能
1. 开放平台 → 创建技能 → 上传 `matrixmedia-publish-skill-*.zip`。
2. 解析失败时对照 [技能基础结构](https://open.workbuddy.cn/docs/skill#技能基础结构)；`category` 如与平台枚举不符请改为平台下拉中的值。

### 专家
1. 开放平台 → 创建专家 → 上传 `matrixmedia-expert-*.zip`。
2. 专家直接调用矩媒 CLI（内置技能），**不依赖 npm 包或连接器**，可以先于连接器上架。
3. 头像目前用的是应用图标；平台要求“统一的漫画/插画风格”，审核如有意见，替换 `avatars/expert.png`（512×512 PNG，≤500KB）后重新打包。
4. 连接器上架并发布 npm 包后，可在 plugin.json 加 `"dependencies": { "connectors": ["<连接器ID>"] }`，让专家改用 MCP 工具。

### 连接器

**npm 包发布前的本地调试**：先 `cd mcp && npm install && npm run build`，然后在 WorkBuddy 客户端里手动添加 MCP，
配置参考 `workbuddy/mcp.local.example.json`（把路径换成本机 `mcp/dist/index.js` 的绝对路径）。
用它在对话里试用 `list_accounts`、`publish_video` → `get_publish_status` 的完整流程。正式上架的 zip 仍使用 `npx` 配置。

1. **先发布 npm 包**（连接器通过 `npx -y matrixmedia-mcp@latest` 启动）：
   ```bash
   cd mcp && npm login && npm publish
   ```
2. 开放平台 → 创建连接器 → 选择「MCP + Skill」→ 上传 `matrixmedia-connector-*.zip`。
3. 在测试环境中验证：已安装矩媒时 `list_accounts` 能返回账号；未安装时应提示下载地址。

## 发版

- 技能改动：递增 `SKILL.md` 的 `version`。
- 连接器改动：递增 `connector-meta.json` 的 `version`；MCP 代码改动需同时递增 `mcp/package.json` 并 `npm publish`。
