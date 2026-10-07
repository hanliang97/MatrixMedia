# 数据统计功能设计（分组环境 · 无头浏览器取数）

> 状态：待评审（接口清单待补充）
> 适用范围：matrix-video v0.11.x，Electron 主进程 + Vue2 渲染层

## 1. 背景与目标

平台目前已有「多账号分组管理 + 视频代发 + 发布历史导出」。发布之后，运营方需要知道**每条视频在各平台的实际表现**（播放、点赞、评论、粉丝变化等），目前只能人工逐个平台后台查看，无法汇总。

本功能目标：

1. 以**当前分组的已登录环境**为单位，自动从各平台后台拉取账号数据与作品数据。
2. 取数方式**只使用浏览器正常页面上下文发起的请求**（携带用户自己登录产生的 Cookie），不做接口签名逆向、不破解加密参数、不绕过风控——因此速度偏慢是可接受的既定代价。
3. 数据落地本地，支持查看、对比（与上次采集的增量）、导出 CSV。

非目标：

- 不做实时刷新（定位为「手动触发 / 定时快照」）。
- 不拉取未登录账号的数据。
- 不跨分组取数（一次任务只跑一个分组，与发布功能的「当前分组」语义一致）。

## 2. 关键约束与合规原则

| 原则 | 落地方式 |
| --- | --- |
| 不逆向 | 不分析/复现接口签名算法（如 X-Bogus、_signature 之类）。凡必须带签名且页面 JS 动态生成的接口，一律改为**在平台页面内执行 fetch**（让页面自己的环境去发），或由页面自身发起、我们被动读响应。 |
| 不绕风控 | 单并发、请求间隔 ≥ 2s、每平台间隔 ≥ 5s、失败指数退避；不伪造 UA（沿用 ptConfig 中既有 UA）。 |
| 用户数据不出本机 | 采集结果仅写本地 userData 目录；导出 CSV 由用户自选路径。 |
| 登录态属于用户 | 只复用现有 partition 中用户主动登录的 Cookie，不保存/传输账号密码。 |

## 3. 现有可复用资产

| 资产 | 位置 | 复用点 |
| --- | --- | --- |
| 分组→partition 规则 | `accountManager/index.vue` (`persist:` + 分组 + 平台) | 枚举当前分组下所有平台环境 |
| 平台清单与入口 URL | `src/main/config/ptConfig.js` | 9 个平台的 index/listIndex，作为「先落地的页面」 |
| Cookie 读取 | `services/getCookie.js` (`session.fromPartition`) | 登录态检测、辅助请求 |
| 登录窗口管理 | `services/accountLoginWindowManager.js` | 防止与登录窗口冲突（同 partition 互斥） |
| 任务队列模式 | `services/puppeteerFile.js` `createPuppeteerTaskRuntime` | 单并发队列 + 取消，采集任务照搬该模式（独立队列实例，不与发布互相阻塞……见 §6.3 决策点） |
| Stealth 环境 | puppeteerFile 中的 `addExtra` + StealthPlugin | 隐藏窗口同样挂 stealth，降低被识别概率 |
| CSV 导出经验 | `services/publishHistoryExport.js` | UTF-8 BOM、转义、公式前缀防护直接沿用 |
| 本地数据读写 | `services/dataRequest.js` + server `/changeData` | 统计快照的持久化走同一通道（或独立 JSON 文件，见 §7） |

## 4. 总体架构

```
┌─ 渲染层（Vue2）───────────────────────────────┐
│  views/dataStats/index.vue（新页面）            │
│   - 分组选择 / 平台勾选 / 页数上限               │
│   - 采集进度条 + 每账号状态                     │
│   - 结果表格（账号概览 + 作品明细）             │
│   - 「导出 CSV」按钮                            │
└──────┬────────────────────────────────────────┘
       │ ipcRenderer.invoke("stats:collect" / "stats:cancel" / "stats:list")
┌──────▼────────────────────────────────────────┐
│ 主进程 services/dataStats/                     │
│  ├─ statsTaskQueue.js    单并发队列+取消        │
│  ├─ statsCollector.js    编排：账号×平台循环    │
│  ├─ sessionRunner.js     隐藏 BrowserWindow 生命周期 │
│  ├─ adapters/            每平台一个适配器        │
│  │   ├─ douyin.js  ├─ sph.js   ├─ bilibili.js  │
│  │   ├─ bjh.js     ├─ toutiao.js ├─ kuaishou.js│
│  │   ├─ xhs.js     ├─ juejin.js  └─ fanqie.js  │
│  ├─ statsNormalize.js    统一数据模型 + 增量对比 │
│  └─ statsStore.js        快照读写（userData）   │
└──────┬────────────────────────────────────────┘
       │ 页面上下文 fetch（同源、带 Cookie、UA 一致）
┌──────▼────────────────────────────────────────┐
│ 各平台创作者后台接口（用户提供清单）             │
└────────────────────────────────────────────────┘
```

## 5. 取数方式（核心决策）

对每个「分组×平台」环境，按优先级三级策略：

### 5.1 一级：页面上下文 fetch（默认）

1. 用 `session.fromPartition("persist:<分组><平台>")` 开一个**隐藏 BrowserWindow**（`show:false`），加载该平台的 `ptConfig[平台].listIndex`（或用户接口清单里指定的落地页）。
2. 等待页面就绪（出现已知选择器或 `document.readyState === "complete"` 后再 idle 1s）。
3. 在页面里 `page.evaluate(() => fetch("<接口>", { credentials:"include", headers:{...} }))`。
   - Cookie、Origin、Referer、UA 全部由浏览器自然携带，与人工在后台按 F5 发出的请求完全同构。
   - 如果平台前端在请求前会用页面 JS 计算签名/时间戳，我们改为**调用页面内已有的请求封装**（若清单中给出入口函数），仍属页面正常行为。
4. 拿 JSON → 交适配器 `pick()` 裁剪成统一模型。

### 5.2 二级：被动嗅探（接口签名过重时兜底）

若某平台接口离开页面 JS 就无法构造（强签名且清单未给页面内入口），退化为：

1. 隐藏窗口打开平台**数据概览页/内容管理页**；
2. `page.on("response")` 监听匹配 URL 模式的 XHR，读页面自己请求到的响应体；
3. 配合「翻页点击/滚动」驱动页面自己加载更多。

代价：依赖页面 DOM 结构，页面改版需跟着调选择器。

### 5.3 三级：主进程直取（仅对无签名的开放平台）

对掘金等接口无签名的平台，可直接 `session.cookies.get()` 拼 Cookie 后主进程 fetch，省掉开窗口的开销。**此级需逐平台确认后再启用**，默认不启用。

> 每平台最终采用哪一级，由适配器里的 `mode: "page-fetch" | "sniff" | "direct"` 声明，等接口清单到位后逐平台定。

## 6. 采集流程与队列

### 6.1 账号枚举

1. 渲染层把「当前分组」的账号树传给主进程（复用发布时解析账号树的逻辑），过滤出 `partition` 以 `persist:<分组>` 开头的账号。
2. 每个账号 → 一个采集子任务 `{ accountId, platform, partition }`。

### 6.2 单账号流程

```
检测登录态（getCookie / 打开 index 页看是否跳登录）
  └─ 未登录 → 标记 skipped(not-logged-in)，继续下一个
开隐藏窗口（partition 复用，UA 按 ptConfig）
  ├─ 一级：落地页 → 页面内 fetch 清单中的接口（分页循环，上限可配）
  ├─ 失败 N 次 → 二级：嗅探模式重试
  └─ 仍失败 → 标记 failed(reason)，截图留档（沿用失败截图目录规范）
normalize → 写入 statsStore → 关闭窗口
```

### 6.3 并发与互斥

- 全局**单并发**，请求间隔随机 2~4s，平台间停 5s（可配置）。
- **与发布任务共用一条队列**（推荐）：发布和采集都在操作用户真实账号环境，串行最安全，实现上直接把采集任务塞进现有 `createPuppeteerTaskRuntime`。
- 与「账号登录窗口」互斥：同 partition 已有登录窗口开着时，**直接复用该窗口**导航到落地页取数（避免双开同 session 的窗口）；取完恢复其原 URL 或不动（登录窗口本来就是停在那里的，直接用它更自然）。
- 提供 `stats:cancel`：取消标志位 + 关闭隐藏窗口，与现有 `test:puppeteer-cancel` 同款语义。

### 6.4 速率预期（向用户明示）

9 平台 × 每平台 2~3 个接口 × (2~4s 间隔 + 页面加载 3~8s) ≈ **单分组全量 3~8 分钟**。UI 上需有明确的进度提示与「慢属正常」的文案。

## 7. 数据模型与存储

### 7.1 统一模型（statsNormalize.js 输出）

```js
// 账号快照
{
  snapshotId: "20261006T101500-douyin-分组A",
  accountId, group: "分组A", platform: "抖音",
  collectedAt: 1759638900000,
  overview: {                 // 能拿到多少算多少，字段可缺省
    fans: 12345, following: 67, totalLikes: 98765,
    worksCount: 120, nickname: "xxx", avatar: "https://..."
  },
  works: [
    {
      workId: "7291...", title: "...", cover: "https://...",
      publishedAt: 1759000000000, url: "https://...",
      play: 1024, like: 88, comment: 12, share: 3, collect: 9,
      extra: {}               // 平台特有字段原样塞这里
    }
  ],
  raw: { /* 原始响应节选，排障用，可选保留 */ }
}
```

### 7.2 存储

- 路径：`<userData>/data-stats/<分组>/<平台>/<YYYYMMDD-HHmmss>.json`，另维护 `latest.json` 指针/拷贝。
- 增量对比：读取同「分组+平台」上一份快照，按 `workId` join，算出 `playDelta/likeDelta/...` 供 UI 展示「较上次 +N」。
- 保留策略：默认保留最近 90 天，超出自动清理（沿用失败截图的 prune 模式）。
- 兼容决策：是否接入现有 server `/changeData` 通道——**建议独立文件**，避免统计快照体积撑大账号库。

### 7.3 导出

「导出 CSV」按 `publishHistoryExport.js` 同款实现：UTF-8 BOM、字段转义、公式前缀防护；两个维度各一张表（账号概览.csv / 作品明细.csv），或单表加 `type` 列。

## 8. 接口适配器契约（等接口清单后填充）

每个平台一个文件，纯配置 + 两个纯函数，便于单测：

```js
// services/dataStats/adapters/douyin.js
export default {
  platform: "抖音",
  mode: "page-fetch",                    // 见 §5
  landingUrl: ptConfig["抖音"].listIndex, // 先打开的页面
  readySelector: ".semi-table-body",      // 页面就绪标志（可省）
  apis: [
    {
      key: "overview",
      method: "GET",
      url: "https://creator.douyin.com/.../overview",   // ← 待用户提供
      query: () => ({ /* 静态/动态参数模板 */ }),
      pick: (json) => ({ fans, totalLikes, ... }),      // 纯函数
    },
    {
      key: "works",
      method: "GET",
      url: "https://creator.douyin.com/.../list",
      pagination: { pageParam: "page", sizeParam: "size", size: 20, maxPages: 10 },
      listPath: "data.items",             // 响应中作品数组的路径
      pick: (item) => ({ workId, title, play, like, ... }),
    },
  ],
};
```

渲染层与主进程对适配器只依赖这个契约，**接口字段变化只改适配器，不动框架**。

## 9. UI 设计

新增路由 `/data-stats`（左侧菜单「数据统计」）：

- 顶部：分组下拉（默认当前分组）、平台多选（默认全选）、每平台分页上限输入、`开始采集` / `取消` / `导出 CSV`。
- 中部：任务进度——每账号一行状态胶囊（等待中/取数中/成功/未登录/失败），失败可 hover 看原因、点开看截图。
- 下部 Tab：
  - 「账号概览」：平台、昵称、粉丝（含较上次增量）、获赞总数、作品数、采集时间。
  - 「作品明细」：平台、标题、发布时间、播放/点赞/评论/分享/收藏（各带增量列）、作品链接（点击外部打开）。
- 空态：无历史快照时引导先跑一次采集。

## 10. 测试与验收

- 单测：`statsNormalize`（含缺字段、脏数据）、适配器 `pick`（用真实响应样本 JSON 做 fixture）、CSV 导出。
- 脚本测试：仿 `scripts/test-*.js` 新增 `test:stats-collect`，用本地 mock server 模拟接口分页/失败/取消。
- 手工验收清单：
  1. 单分组 9 平台全量采集跑通，耗时在预期区间；
  2. 未登录平台正确标记 skipped；
  3. 采集中取消，窗口正确关闭、状态落盘；
  4. 二次采集后增量列正确；
  5. 采集期间发起发布任务，两者正确排队不互踩。

## 11. 风险与开放问题

| 项 | 说明 | 待办 |
| --- | --- | --- |
| 接口清单 | 各平台接口 URL、参数、响应结构**待用户提供**，届时逐平台定 mode 并补 fixture | ⬜ 用户提供（抖音已实测，见下） |
| 视频号 | 历史经验其页面多为 canvas/签名重，大概率走二级嗅探 | ⬜ 清单确认 |
| 小红书 | 发布链路已有 conservative 策略，采集沿用其 UA/节奏限制 | ⬜ 复用 xhsPublishPolicy |
| 增量语义 | 平台返回的「总播放」本身会变化，增量=两次快照差，非日增口径 | 已在 §7 明确 |
| 登录窗口复用 | 复用用户正在看的登录窗口会改变其页面，需 UI 提示或默认开隐藏窗 | ⬜ 评审决定 |

### 11.1 抖音接口实测结论（2026-10-06 验证）

接口：`POST https://creator.douyin.com/janus/douyin/creator/data/overview/dashboard`
验证脚本：`yarn test:douyin-stats`（`scripts/test-douyin-stats.js`，凭证从 `.mm-douyin-cookie.txt` 读，不随仓库提交）

| 验证项 | 结果 |
| --- | --- |
| 认证方式 | ✅ 仅需 Cookie + `x-secsdk-csrf-token` 请求头，无签名/加密参数，无需逆向 |
| 单日查询 | ✅ `date_range` 单日，13 个指标齐全（播放/点赞/评论/分享/净增粉丝/总粉丝量等） |
| 多天一次拉取 | ✅ trends 按日返回明细，30 天一次拉取成功 |
| 日明细窗口 | ⚠️ 固定约**最近 37 天**（end_date 向前对齐），更长区间 trends 被截断（90 天区间只回 37 条） |
| 历史回溯 | ❌ 完全超出窗口的区间报 `status_code=5 参数不合法`，**无法补历史** |
| 当天数据 | ❌ end_date 为当天报参数不合法，数据 T+1 结算，只能查到昨天 |

**对设计的影响**：
1. 历史数据只能靠**每天定时采集、本地累积快照**（§7 的快照存储从「可选」变为「必须」），首次启用时历史从启用日开始累积；
2. 日视图（30 天）一次请求即可；周/月视图前期用本地累积数据，早期数据稀疏属预期；
3. `total_fans_cnt`（总粉丝量）是存量快照值，`net_fans_cnt` 是日增量——「发布数据增长」tab 的粉丝变化用 `net_fans_cnt` 日值按区间求和；
4. 指标映射：粉丝=fans 快照、点赞=digg_cnt、评论=comment_cnt、收藏=接口无收藏项（抖音看板无收藏指标，收藏列置 0/隐藏待确认）、分享=share_count；
5. 上线后走「页面上下文 fetch」（§5.1）：creator.douyin.com 页面已加载 secsdk，会自动给同源 fetch 注入 `x-secsdk-csrf-token`，脚本里的显式 header 只是离线验证用。

### 11.2 视频号接口实测结论（2026-10-06 验证）

验证脚本：`yarn test:sph-stats`（`scripts/test-sph-stats.js`，凭证从 `.mm-sph-cookie.txt` 读）

**接口 A：视频列表** `POST /micro/content/cgi-bin/mmfinderassistant-bin/post/post_list`

| 验证项 | 结果 |
| --- | --- |
| 认证 | ✅ Cookie(`sessionid`,`wxuin`) + 头 `X-WECHAT-UIN` / `finger-print-device-id` + query `_aid`，**零签名** |
| 单视频数据 | ✅ 播放 `readCount` / 点赞 `likeCount` / 评论 `commentCount` / 分享 `forwardCount` / 收藏 `favCount` / **单视频涨粉 `followCount`** / 昨日播放 `yesterdayReadCount` |
| 分页 | ✅ 游标分页：响应 `data.lastBuff` → 下页 `body.rawKeyBuff`，`continueFlag` 终结标记，实测第 2 页数据正确 |

**接口 B：粉丝趋势** `POST /cgi-bin/mmfinderassistant-bin/statistic/fans_trend`

| 验证项 | 结果 |
| --- | --- |
| 入参 | `startTs`/`endTs`（秒，UTC+8 零点对齐）+ `interval:3`，数据点按日返回数组 |
| 响应 | `total`（每日粉丝总量）/ `add` / `reduce` / `netAdd` + 按来源分布 `fansDataByTabtype`（推荐/分享/主页等） |
| 长区间 | ✅ **365 天一次拉取成功**（366 个数据点） |
| 历史回溯 | ✅ **支持**（一年前的区间正常返回）——与抖音相反，视频号可直接回填历史 |

**对设计的影响**：
1. 视频号无账号级「每日播放/点赞/评论」接口，这四项的**日趋势用本地快照差分**（每日采集时记录总量快照，增量=两次差值）；
2. 「发布数据增长」tab 视频号天然最完整：单视频自带 `followCount`（该视频带来的关注），不需要靠快照差分推算；
3. 收藏指标视频号有（`favCount`），抖音无——统一模型中收藏字段允许按平台缺省；
4. 采集顺序：先 `fans_trend`（一次 365 天初始化历史）+ `post_list` 全量翻页（21 个视频 2~3 页即可），总量轻。

### 11.3 哔哩哔哩接口实测结论（2026-10-06 验证）

验证脚本：`yarn test:bilibili-stats`（`scripts/test-bilibili-stats.js`，凭证 `.mm-bilibili-cookie.txt` 第一行 Cookie）

**接口 A：账号总览** `GET /x/web/data/index/stat`

| 验证项 | 结果 |
| --- | --- |
| 认证 | ✅ 仅 Cookie（`SESSDATA` 关键），query 带固定的 device/locale JSON，**无签名** |
| 数据 | ✅ 账号总量 8 项：`total_click` 播放 / `total_like` / `total_reply` / `total_dm` 弹幕 / `total_share` / `total_fav` / `total_coin` 投币 / `total_fans` 粉丝，与创作中心页面数字完全一致 |
| 增量 | ✅ 自带 `incr_*` 昨日增量字段；`log_date` 标记数据日期，T+1 结算 |
| 日趋势 | ❌ 无历史日粒度序列（只有当前总量 + 昨日增量）→ 日趋势靠**每日快照差分** |

**接口 B：稿件列表** `GET /x/web/archives?status=is_pubing,pubed,not_pubed&pn=N&ps=10`

| 验证项 | 结果 |
| --- | --- |
| 分页 | ✅ 常规页码分页（`page.count`=26 总数），3 页翻完验证通过 |
| 单视频数据 | ✅ `stat.view/like/reply/favorite/share/coin/danmaku` 七项 + `Archive.title/bvid/cover/ptime`（发布秒级时间戳） |
| 发布增长 | ⚠️ 无「单视频涨粉」字段 → 关注变化用账号 `total_fans` 快照差分 |

**备注**：B 站多出弹幕/投币两个平台特有指标，统一模型放 `extra` 字段，UI 暂不展示。

### 11.4 Electron 环境直连验证（2026-10-07，探针 `scripts/electron-probe/stats-probe.js`）

验证方式：复制 app userData 中的分组 partition 到临时 profile（排除缓存，不干扰运行中的 app），
独立 Electron 进程加载平台落地页，在**页面上下文**裸 `fetch`（不手动附加任何动态凭证头）：

```bash
npx electron scripts/electron-probe/stats-probe.js --platform <douyin|sph|bjh|bilibili> --group 123 [--profile /tmp/mm-probe-profile]
```

| 平台 | 结果 | 关键结论 |
| --- | --- | --- |
| 哔哩哔哩 | ✅ 真实数据返回（10623 播放 / 99 粉丝） | 纯 cookie 即通，无需任何额外头 |
| 视频号 | ✅ 30 天粉丝趋势完整返回（450） | **裸 fetch 即通**，X-WECHAT-UIN / finger-print-device-id / _aid 均非必须 |
| 百家号 | ✅ viewCount=6964 / fansCount=21 | **裸 fetch 即通**，JWT `token` 头非强制（devStoken/bjhStoken cookie 已鉴权）；注意 home/index 响应在 `data.coreData` 下 |
| 抖音 | ✅ 重新登录后完整返回 30 天逐日 metrics | **裸 fetch 即通**——secsdk 全局 hook 了页面 fetch 并自动注入 `x-secsdk-csrf-token`，无需手动处理 csrf |

**对正式实现的决定性影响**：
1. 「页面上下文 fetch」路线成立，且比预期简单——四个平台中三个**不需要任何动态头**，cookie 随浏览器自动携带；
2. 采集器无需处理 token 提取/刷新逻辑，只要把页面加载起来再发请求；
3. profile 复制技巧可同时用于 CLI 模式（app 未启动时直接读真实 userData 即可，无需复制）。

### 11.5 头条接口实测结论（2026-10-07 验证，已接入采集层）

**接口 A：首页聚合** `GET /mp/fe_api/home/merge_v2?app_id=1231`
- `data.statistic.data.total_subscribe_count` 粉丝总量、`total_read_play_count` 总播放阅读、`fans_count_data` 分端粉丝明细
- 纯 Cookie，页面上下文裸 fetch 即通

**接口 B：作品列表** `GET /api/feed/mp_provider/v1/?...&offset=N&count=10`
- 关键参数（缺失会返回空列表）：`visited_uid`（作者 uid，取自 `localStorage.__tea_cache_tokens_1231.user_unique_id`）、`genre_type_switch`（内容类型开关）、`client_extra_params`（含 `status:"8"` 已发布过滤、`page_index`）
- 分页：响应 `offset` 毫秒游标传入下一页；`has_more` 是 feed 惯性标记不可信，**空页即终止**
- 字段：`itemCounter.videoWatchCount`（视频播放）/ `readCount`（图文阅读）/ `diggCount` 赞 / `commentCount` 评 / `repinCount` 转发；**无收藏字段**（置 null）
- 无单视频涨粉，无日粒度历史 → 快照差分

**采集层落地状态（2026-10-07）**：抖音 / 视频号 / 哔哩哔哩 / 百家号 / 头条 五个平台适配器已上线（`src/main/services/dataStats/`），探针全链路逐一验证通过；余快手、小红书待补。

### 11.6 快手接口实测结论（2026-10-07 验证，已接入采集层）

**接口 A：用户信息** `POST /rest/cp/creator/pc/home/userInfo`
- `data.coreUserInfo.fansNum` 粉丝总量；body 必带 `kuaishou.web.cp.api_ph`（与同名 cookie 一致）
- **不验签**，裸 fetch 即通

**接口 B：作品列表** `POST /rest/cp/works/v2/video/pc/photo/list?__NS_sig3=...`
- 单视频：播放 `playCount` / 赞 `likeCount` / 评 `commentCount` / `uploadTime`；**无收藏、无分享、无涨粉字段**
- 分页：`cursor` 毫秒游标（初始为远未来值），`nextCursor` 翻页，终结标记 `no_more`
- ⚠️ **`__NS_sig3` 签名与请求体绑定**（实测：同 body 重复请求成功，换 cursor 即 500002），且签名逻辑封装在 webpack 闭包内、window 无暴露入口

**最终方案（不碰签名的合规路径）**：preload 嗅探 + 滚动驱动
1. `preloadSniffer.js` 在页面脚本之前 hook fetch/XHR，响应存入 `window.__mmSniffed`
2. 打开作品管理页，页面自己发出带签名的请求（签名由页面业务代码正常生成）
3. 采集脚本滚动列表容器驱动「加载更多」，从嗅探结果按 `workId` 去重汇总，直到 `no_more` 或达到 total
4. 全链路实测：34 作品全量拿到，累加点赞 1357 与页面显示完全一致

### 11.7 小红书接口实测结论（2026-10-07 验证，已接入采集层）

**接口 A：个人信息** `GET /api/galaxy/creator/home/personal_info`
- `data.fans_count` 粉丝、`faved_count` 获赞与收藏（赞+收藏合计口径）、`follow_count` 关注

**接口 B：笔记列表** `GET /api/galaxy/v2/creator/note/user/posted?tab=0&page=N`
- 单笔记：播放 `view_count` / 赞 `likes` / 评 `comments_count` / **收藏 `collected_count`** / 分享 `shared_count`，标题 `display_title`、`id`、`time`
- 分页：`page` 从 0 递增，响应 `data.page=-1` 为终结
- ⚠️ 接口需 `x-s` / `x-t`（/ `x-s-common`）签名头——**直接调用页面自带的 `window._webmsxyw` 生成**（页面自身能力，非逆向实现）；实测部分接口裸 fetch 也放行，但统一走签名通道最稳

**七个平台全部接入完成（2026-10-07）**：抖音 / 视频号 / 哔哩哔哩 / 百家号 / 头条 / 快手 / 小红书，全部探针全链路验证通过。合规总结：6 个平台页面上下文裸 fetch 即通；快手走 preload 嗅探（签名与请求体绑定且不可调用）；小红书调用页面自带签名函数。全程零逆向、零签名算法实现。

## 12. 实施拆分（建议按序提交）

1. `feat(stats): 数据统计骨架——队列、存储、统一模型、空 UI 页面`（适配器用 mock）
2. `feat(stats): 页面上下文 fetch 执行器 + 登录态检测 + 隐藏窗口管理`
3. `feat(stats): 抖音/头条/哔哩哔哩等首批平台适配器`（按接口清单质量分批）
4. `feat(stats): 增量对比 + CSV 导出`
5. `feat(stats): 嗅探兜底模式（视频号等）`
6. `docs/test: 使用文档 + 测试脚本`
