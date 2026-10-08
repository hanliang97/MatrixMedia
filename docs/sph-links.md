# 视频号链接挂载（小程序短剧 / 剧集）

> 说明视频号小程序短剧、原生剧集挂载的实现位置、调用方式、失败语义，以及平台页面改版时的排查方式。

## 现状

| 链接类型   | 平台页面 | 自动化 | 实现位置                                            |
| ---------- | -------- | ------ | --------------------------------------------------- |
| 无         | ✅       | ✅     | —                                                   |
| 商品       | ✅       | ✅     | `src/main/services/upLoad/sphProduct.js`            |
| 小程序短剧 | ✅       | ✅     | `src/main/services/upLoad/sphDrama.js`（短剧配置）  |
| 视频号剧集 | ✅       | ✅     | `src/main/services/upLoad/sphSeries.js`（剧集配置） |
| 公众号文章 | ✅       | ⛔     | 仅占位（能力表 `automationSupported: false`）       |
| 红包封面   | ✅       | ⛔     | 同上                                                |
| 小游戏     | ✅       | ⛔     | 同上                                                |

- 能力表：`src/shared/videoLink.js`（`MINI_DRAMA` / `SPH_SERIES`，`selectionMode: drama_id / series_id`）
- 共享校验：`src/shared/videoDrama.js`、`src/shared/videoSeries.js`
- **统一流程工厂**：`src/main/services/upLoad/sphEntityLink.js`——短剧与剧集共用同一条自动化流程（类型菜单 → 选择弹窗 → 按名称搜索 → 点行 → 回显校验），差异只集中在每个类型的候选文案
- 统一入口：`src/main/services/upLoad/sphLink.js#attachSphVideoLink`
- DOM 工具：`src/main/services/upLoad/sphLinkDom.js`（shadow DOM 穿透、弹窗、诊断）
- 失败兜底：`src/main/services/upLoad/sph.js#fallbackLinkFailureToDraft`

前提：该视频号账号本身要有对应挂载权限（后台能选到「小程序短剧」或「视频号剧集」），否则平台页面不出现该选项。短剧与剧集互斥，一次发布只挂一种。

## 列表接口（GUI 下拉数据源）

GUI 的短剧/剧集录入是**服务端关键词搜索下拉**：下拉初始为空且不发请求；用户输入时（element-ui `remote` 模式防抖 300ms）把输入原样作为 `queryString` 交给平台接口，下拉只渲染服务端返回的结果，整体替换不累加；点选某项才写入值。刻意不加 `allow-create`（它会让下拉出现输入框）与 `default-first-option`（它会让回车直接选中第一项）。

- 主进程服务：`src/main/services/sphEntityOptions.js`（会话校验 + cookie + axios 直调，同 `sphWindowProducts.js` 模式）
- 归一化与分页编排：`src/shared/sphEntityOptions.js`（无 electron 依赖，可单测）
- IPC：`sph:list-dramas` / `sph:list-series`（入参 `{ partition, queryString }`，返回 `{ ok, entities: [{ name, title, subTitle, cover, raw }] }`）
- GUI：`LocalVideoPublish.vue` 的 `searchPlatformEntityOptions`，按 `nodeId:linkType` 缓存结果，切换挂载类型时清缓存

| 实体 | 接口 | 关键参数 | 状态 |
| ---- | ---- | -------- | ---- |
| 小程序短剧 | `POST .../post/search_drama_component` | 不带 `sceneType` | ✅ 实测 totalCount=289 |
| 视频号剧集 | `POST .../post/search_drama_component`（**同一接口**） | `sceneType=3` | ✅ 实测 totalCount=281 |

> **剧集没有独立接口**：早先按同族路径推测的 `search_series_component` **不存在**（实测返回 `Cannot POST`）。
> 发布页 JS 的 `loadList` 逻辑为
> `searchKey ? searchDramaComponent({queryString: searchKey, currentPage, pageSize, sceneType}) : searchDramaComponent({currentPage, pageSize, sceneType})`，
> 其中 `sceneType` 取 `kSceneType_SelfOperatedNativeDrama = 3`（仅 `linkType === nativeDrama` 时带）。
> 同页 `linkType` 枚举与中文标签：`drama=12 → "短剧"`、`finderDrama=8 → "剧集"`、`nativeDrama=13 → "视频号剧集"`。

接口行为要点：

- **`queryString` 是服务端搜索关键词**（从发布页 JS 挖出并实测）：无关键词返回默认列表（totalCount=289），带关键词则精确收窄（`queryString=全家中毒` → totalCount=1）。传空串等价于不带关键词。
- `rawKeyBuff` 是**游标**（响应 `data.lastBuff` 回填），**不是关键词**，保持空串。
- `currentPage` / `pageSize` 分页；搜索态命中通常个位数，默认 20/页、上限 3 页。
- 发布页自身用 `pageSize=5`；实测 `pageSize` 不影响搜索结果集，与 `sceneType` 无关。
- **部分关键词平台不返回**：实测短剧搜「我」「的」返回 0 条，但目录里含这些字的条目有 147 / 69 条；同一关键词在剧集（`sceneType=3`）下正常返回（145 条）。属平台侧对高频字的处理，非本地缺陷，代码按「服务端返回什么就显示什么」处理即可。
- 请求体 `_log_finder_id` 置空即可（同族 `post_list` 已验证 bare cookie 可行，无需 `X-WECHAT-UIN` / `_aid`）；
- 信封 `errCode != 0` 视为失败并透传 `errMsg`；返回了行但字段认不出时，主进程日志会打印 `[sph][entity-list] ... 首行键: ...` 便于对齐候选表。

下拉交互契约（`LocalVideoPublish.vue`，改动时勿破坏）：

| 场景 | 期望行为 |
| ---- | -------- |
| 打开下拉 | 不发请求、不显示加载态，下拉为空 |
| 输入关键词 | 防抖后带 `queryString` 请求，结果**整体替换**（不累加） |
| 点候选项 | 写入值，**保留下拉**（便于确认选中项） |
| 点 clearable 的 × / 删空输入 | 值置空**且清掉下拉结果**（否则残留上一次候选） |
| 切换挂载类型 | 清掉该类型的下拉结果、searched 标记与在途请求令牌 |
| 连续输入（乱序返回） | 以最后一次输入为准，过期结果丢弃 |

## 平台页面行为

以下行为直接决定实现方式，修改相关代码前请先了解：

| 行为 | 说明 |
| ---- | ---- |
| **按名称搜索** | 弹窗里只有名称输入框，没有编号检索。传入的值应当是**剧名**（如 `泳陷错恋`）。 |
| **点行即完成挂载** | 点击候选行后，发布页回显立刻变成所选名称，**不需要**再点「确定」。 |
| **「确定」按钮恒为 disabled** | 该弹窗的「确定」在此模式下始终带 `weui-desktop-btn_disabled`（属平台另一种选择模式），**不能作为成功判据**；把它当必需步骤会误报失败。 |
| **弹窗会自行关闭** | 选行后数秒内弹窗自动关闭。 |
| 短剧弹窗标题 / 搜索框 | 标题「选择需要关联的短剧」，搜索框 placeholder 为「请输入短剧名称」。 |
| 剧集弹窗标题 / 搜索框 | 标题「选择需要关联的视频号剧集」，搜索框 placeholder 是通用的「搜索内容」（剧集弹窗没有「请输入剧集名称」）。 |
| 候选行选择器 | `.drama-row`（antd 表格行）。 |
| **存在隐藏克隆行** | antd 固定列为同一部剧渲染一份隐藏副本（5 部剧 → 10 个 `.drama-row`），必须优先点**可见**那一行。 |
| **弹窗可见性不能用 computed display 判断** | 发布页常驻 30+ 个 `.weui-desktop-dialog` 残留实例，隐藏实例**自身** computed display 仍非 `none`，只有祖先 `.weui-desktop-dialog__wrp` 是 `display:none`。判断可见性必须**沿祖先链**检查，否则会误操作隐藏实例。 |
| 回显选择器 | `.post-component-choose-wrap .choose-content .name`。 |

> 上述 DOM 细节集中在 `sphEntityLink.js`（流程与可见性判断）与 `sphDrama.js` / `sphSeries.js`（文案候选常量）。平台改版时只需改这些常量。

## 用法

CLI（推荐先加 `--draft` 核对）：

```bash
# 小程序短剧（值是短剧名称，如 泳陷错恋）
matrixmedia cli publish -p sph --phone 13800138000 -f ./v.mp4 \
  -t "短剧第一集" --draft --sph-drama-id 泳陷错恋
# 视频号剧集（值是剧集名称）
matrixmedia cli publish -p sph --phone 13800138000 -f ./v.mp4 \
  -t "短剧第一集" --draft --sph-series-id 儿媳给我办寿宴
```

等价写法：`--sph-link-type mini_drama|sph_series --sph-link-value <名称>`
（`mini_drama` 也接受 `drama` / `短剧` / `小程序短剧` / `微短剧`；`sph_series` 也接受 `series` / `剧集` / `视频号剧集`。）

> 参数名保留 `-id` 后缀是为了兼容既有脚本；实际取值是**名称**。

HTTP（GUI 启动后）：`sphDramaId` / `sphSeriesId` 两个快捷字段，或 `platformOptions.sph.link: { "type": "mini_drama" | "sph_series", "value": "..." }`。

MCP `publish_video`：`sphDramaId` / `sphSeriesId`，或 `sphLink` 对象同上。

GUI：`视频管理 → 选择视频发布 → 下一步 → 第三方属性`，把下拉从「无」切到「小程序短剧」或「视频号剧集」，从下拉列表选择（默认展开全量、可输入过滤），或直接键入**剧名**。

## 失败语义

短剧 / 剧集挂载的每一步（链接类型菜单 → 选择弹窗 → 搜索 → 点行 → 回显校验）失败都**不会**直接发布：

1. 挂载方（`sphEntityLink.js` 的 `attach()`）先关闭本流程打开的弹窗与遮罩，再抛出原始错误；
2. 抛错给 `sph.js`，`fallbackLinkFailureToDraft` 等视频处理完成后点「保存草稿」；
3. 回执 `status: true, outcome: draft_saved, needsAttention: true, failureStage: video_link`；
4. 统一结果 `status: needs_attention`、`exitCode: 4`（CLI 退出码 4，HTTP `success: false`）。

因此「挂了但没挂上」不会被误报为发布成功，也不会丢视频。

> 弹窗必须由挂载方清理：平台只在成功选中后才自动关闭选择弹窗，失败时残留的遮罩（`.weui-desktop-mask`）会盖住底部「保存草稿」按钮，导致转存草稿的点击被吞掉。
>
> 成功判据是**发布页回显**（`.choose-content .name` 非空），不是弹窗按钮状态。

## 排查清单

1. 先加 `--draft`（或 GUI「发布到草稿」）跑一次，避免误发；
2. 观察日志前缀 `[sph][drama]` / `[sph][series]`：会打印命中的链接类型文案与搜索框 placeholder；
3. 失败时看 `[sph][link][诊断]` 一行 JSON，里面有：
   - `linkSection.options`：链接类型菜单的**真实文案**；
   - `linkSection.selected`：当前已选类型；
   - `dialog.inputs`：弹窗里输入框的 placeholder；
   - `rows`：弹窗候选行的 `data-row-key` 与文本片段；
4. 按实际文案改对应配置文件顶部的常量即可，不需要动流程：
   - 短剧：`src/main/services/upLoad/sphDrama.js` 的 `DRAMA_LINK_LABELS` / `DRAMA_DIALOG_HINTS` / `DRAMA_SEARCH_INPUT_HINTS` / `DRAMA_PRIMARY_BUTTON_LABELS`；
   - 剧集：`src/main/services/upLoad/sphSeries.js` 的 `SERIES_LINK_LABELS` / `SERIES_DIALOG_HINTS` / `SERIES_SEARCH_INPUT_HINTS` / `SERIES_PRIMARY_BUTTON_LABELS`。
5. 若平台改版导致「弹窗找不到」，优先检查可见性判断（祖先链）与搜索框 placeholder 候选；「点行不生效」则检查是否点到了隐藏克隆行。

> 修改后必须重新构建：`npm run build:dir`。`dist/` 是构建产物，不要手改。

## 新增一种第三方属性（如后续开放公众号文章）怎么做

1. `src/shared/videoLink.js`：`VIDEO_LINK_TYPES` 加新值；能力表加一行 `automationSupported: true` + `selectionMode`。
2. `src/shared/` 加一个名称校验模块（照抄 `videoSeries.js`）。
3. `src/main/services/upLoad/` 加一个配置模块（照抄 `sphSeries.js`），只写文案候选与校验函数。
4. `sphLink.js` 加一个分支；`parsePublishArgs.js` / `publish.ts` 加参数与别名。
5. `scripts/test-sph-video-*.js` 加覆盖；文档同步。

## 相关测试

```bash
yarn test:sph-video-drama        # 短剧：能力表 / 校验 / CLI / HTTP / MCP 参数 / 路由
yarn test:sph-video-series       # 剧集：同上
yarn test:sph-video-product      # 商品路径不回归
yarn test:sph-entity-options     # 短剧/剧集列表接口：归一化 / 分页合并 / 防死循环
yarn test:publish-draft-args     # 链接参数、转存草稿语义
yarn test:sph-creative-statement # 视频标注 + 链接能力表快照
```

以上测试只保证「参数 → 选项 → 路由 → 回执」链路；选择器是否命中取决于平台页面，需用真实账号验证一次。
