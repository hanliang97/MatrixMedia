"use strict";

import {
  PLATFORM_ALIASES,
  VIDEO_PUBLISH_CANONICAL,
  resolvePublishPlatform,
} from "../../shared/publishPlatforms.js";
import {
  resolveCreativeStatementForPlatform,
  getCreativeStatementPlatformKey,
} from "../../shared/creativeStatement.js";

export { PLATFORM_ALIASES, VIDEO_PUBLISH_CANONICAL, resolvePublishPlatform };

/**
 * 解析 `cli publish` 后的 argv（不含子命令名 publish）
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parsePublishArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }

  const out = {
    platform: null,
    file: null,
    phone: null,
    partition: null,
    title: null,
    bookName: null,
    bt2: null,
    bq: "",
    publishAt: null,
    show: false,
    closeWindowAfterPublish: true,
    dir: null,
    config: null,
    creativeStatement: null,
    draft: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") {
      out.platform = args[++i];
    } else if (a === "--file" || a === "-f") {
      out.file = args[++i];
    } else if (a === "--phone") {
      out.phone = args[++i];
    } else if (a === "--partition") {
      out.partition = args[++i];
    } else if (a === "--title" || a === "-t") {
      out.title = args[++i];
    } else if (a === "--name" || a === "--book-name") {
      out.bookName = args[++i];
    } else if (a === "--bt2") {
      out.bt2 = args[++i];
    } else if (a === "--tags" || a === "--bq") {
      out.bq = args[++i] || "";
    } else if (a === "--publish-at") {
      out.publishAt = args[++i];
    } else if (a === "--show") {
      out.show = true;
    } else if (a === "--no-close-window") {
      out.closeWindowAfterPublish = false;
    } else if (a === "--dir") {
      out.dir = args[++i];
    } else if (a === "--config" || a === "--xlsx") {
      out.config = args[++i];
    } else if (a === "--creative-statement" || a === "--cs") {
      out.creativeStatement = args[++i];
    } else if (a === "--draft") {
      out.draft = true;
    }
  }

  if (!out.platform) {
    return { ok: false, error: "缺少 --platform（或 -p），例如 dy / 抖音" };
  }
  const pt = resolvePublishPlatform(out.platform);
  if (!VIDEO_PUBLISH_CANONICAL.includes(pt)) {
    return { ok: false, error: `未知平台: ${out.platform}` };
  }
  out.platform = pt;

  if (!out.file && !out.dir) {
    return {
      ok: false,
      error:
        "缺少 --file（或 -f）视频文件路径，或 --dir + --config 批量目录模式",
    };
  }
  if (out.file && out.dir) {
    return { ok: false, error: "--file 和 --dir 不能同时使用" };
  }
  if (out.dir && !out.config) {
    return {
      ok: false,
      error: "--dir 批量模式必须同时提供 --config <xlsx路径>",
    };
  }

  if (!out.partition) {
    if (!out.phone) {
      return {
        ok: false,
        error:
          "缺少 --phone 或完整 --partition（与 GUI 一致，如 persist:13800138000抖音）",
      };
    }
    const phoneSeg = String(out.phone).split("-")[0];
    out.partition = `persist:${phoneSeg}${out.platform}`;
  }

  if (!out.dir && (!out.title || !String(out.title).trim())) {
    return {
      ok: false,
      error:
        "缺少 --title（或 -t）视频标题（与 GUI「视频标题」一致，写入 data.bt1）",
    };
  }
  // in dir mode title comes from xlsx per row, no global --title needed

  if (out.show) {
    console.warn(
      "MatrixMedia: CLI publish 不显示浏览器窗口，已忽略 --show（--no-close-window 仅在与 GUI 显示窗口时有关，CLI 下无效）。"
    );
    out.show = false;
  }

  if (out.platform === "视频号") {
    const bt2Trim = out.bt2 && String(out.bt2).trim();
    if (!bt2Trim) {
      console.warn(
        "MatrixMedia: 视频号短标未提供 --bt2，将回退为视频标题；平台输入框建议 6-16 字符，且会将 ，。、/,;:!?'\"()[]{}<> 等标点替换为空格。"
      );
    } else {
      const cleaned = bt2Trim.replace(/[，。、\/,;:!?'"()\[\]{}<>]/g, "");
      if (cleaned.length > 16) {
        console.warn(
          `MatrixMedia: 视频号短标 --bt2 共 ${cleaned.length} 字（不含标点），建议控制在 6-16 字内，过长可能被平台截断或报错。`
        );
      }
      if (cleaned.length < 6) {
        console.warn(
          `MatrixMedia: 视频号短标 --bt2 仅 ${cleaned.length} 字（不含标点），平台提示 6-16 字，过短可能被拒。`
        );
      }
    }
  }

  if (out.bq && /[,，、;；|]/.test(out.bq)) {
    console.warn(
      "MatrixMedia: --tags 推荐用空格分隔多个标签（如 '减脂 健身 教程'）；检测到 ,，、;；| 等分隔符，哔哩哔哩 / 小红书会按空格切分，逗号将作为单个标签字符保留。"
    );
  }

  if (out.bq) {
    const tags = String(out.bq).trim().split(/\s+/).filter(Boolean);
    if (tags.length > 4) {
      console.warn(
        `MatrixMedia: --tags 共 ${tags.length} 个，建议最多 4 个话题；多余标签会降低每个话题的权重，生成层请按相关性裁到 4 个以内。`
      );
    }
    const hashtagPlatforms = new Set(["视频号", "抖音", "快手"]);
    if (hashtagPlatforms.has(out.platform)) {
      out.bq = tags
        .map((t) =>
          String(t).startsWith("#") ? String(t) : `#${String(t).trim()}`
        )
        .join(" ");
    }
  }

  return { ok: true, value: out };
}

function pickBodyValue(body, keys) {
  for (const key of keys) {
    const val = body[key];
    if (val != null && String(val).trim() !== "") {
      return String(val);
    }
  }
  return null;
}

function normalizeBodyTags(value) {
  return String(value || "")
    .split(/[\s,，、;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * 将 HTTP JSON 请求体转为 cli publish 等价 argv
 * @param {object} body
 * @returns {string[]}
 */
export function publishBodyToArgv(body) {
  if (!body || typeof body !== "object") return [];
  const argv = [];
  const pushPair = (keys, flag) => {
    const val = pickBodyValue(body, keys);
    if (val != null) {
      argv.push(flag, val);
    }
  };

  pushPair(["platform", "p"], "-p");
  pushPair(["file", "f"], "-f");
  pushPair(["phone"], "--phone");
  pushPair(["partition"], "--partition");
  pushPair(["title", "t"], "-t");
  pushPair(["bookName", "name", "book-name"], "--name");
  pushPair(["bt2"], "--bt2");
  const tags = pickBodyValue(body, ["tags", "bq"]);
  if (tags != null) argv.push("--tags", normalizeBodyTags(tags));
  pushPair(["publishAt", "publish-at"], "--publish-at");
  pushPair(
    ["creativeStatement", "creative-statement", "cs"],
    "--creative-statement"
  );

  if (body.show === true) argv.push("--show");
  if (body.closeWindowAfterPublish === false) argv.push("--no-close-window");
  if (body.draft === true) argv.push("--draft");

  return argv;
}

/**
 * 解析 HTTP / CLI 共用的发布参数
 * @param {object} body
 */
export function parsePublishRequest(body) {
  return parsePublishArgs(publishBodyToArgv(body));
}

const SHARED_PUBLISH_BODY_KEYS = [
  "file",
  "f",
  "title",
  "t",
  "phone",
  "partition",
  "bookName",
  "name",
  "book-name",
  "bt2",
  "tags",
  "bq",
  "publishAt",
  "publish-at",
  "creativeStatement",
  "creative-statement",
  "cs",
  "show",
  "closeWindowAfterPublish",
  "draft",
];

function extractSharedPublishBody(body) {
  const shared = {};
  for (const key of SHARED_PUBLISH_BODY_KEYS) {
    if (body[key] != null && body[key] !== "") {
      shared[key] = body[key];
    }
  }
  return shared;
}

function normalizePublishTargets(body) {
  const raw = body.platforms;
  if (raw == null) return null;
  const list = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/[,，|]/)
        .map((item) => item.trim())
        .filter(Boolean);
  if (list.length === 0) return null;

  return list
    .map((item) => {
      if (typeof item === "string") {
        return { platform: item };
      }
      if (item && typeof item === "object" && item.platform != null) {
        return { ...item };
      }
      return null;
    })
    .filter(Boolean);
}

function pickCreativeStatementFromMap(map, platformPt) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const keys = new Set([
    platformPt,
    getCreativeStatementPlatformKey(platformPt),
  ]);
  for (const [alias, canonical] of Object.entries(PLATFORM_ALIASES)) {
    if (canonical === platformPt) keys.add(alias);
  }
  for (const key of keys) {
    if (key && map[key] != null && String(map[key]).trim() !== "") {
      return map[key];
    }
  }
  return null;
}

function pickTargetCreativeStatement(target) {
  if (!target || typeof target !== "object") return null;
  return pickBodyValue(target, [
    "creativeStatement",
    "creative-statement",
    "cs",
  ]);
}

/**
 * HTTP 创作声明解析（对齐 LocalVideoPublish 批量设置 + 单账号覆盖）
 */
export function resolveHttpPublishCreativeStatement(body, platformPt, target) {
  let raw = pickTargetCreativeStatement(target);
  if (raw == null) {
    raw = pickCreativeStatementFromMap(body.creativeStatements, platformPt);
  }
  if (raw == null) {
    raw = pickBodyValue(body, [
      "creativeStatement",
      "creative-statement",
      "cs",
    ]);
  }
  return resolveCreativeStatementForPlatform(raw, platformPt);
}

function applyHttpCreativeStatements(body, parsedValue, target = {}) {
  return {
    ...parsedValue,
    creativeStatement: resolveHttpPublishCreativeStatement(
      body,
      parsedValue.platform,
      target
    ),
  };
}

/**
 * 解析 HTTP 发布请求；支持单平台 platform 或多平台 platforms
 * @returns {{ ok: true, multi: boolean, value: object|object[] } | { ok: false, error: string }}
 */
export function parseMultiPublishRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "请求体必须是 JSON 对象" };
  }

  const targets = normalizePublishTargets(body);
  if (!targets || targets.length === 0) {
    const single = parsePublishRequest(body);
    if (!single.ok) return single;
    return {
      ok: true,
      multi: false,
      value: applyHttpCreativeStatements(body, single.value, body),
    };
  }

  if (body.platform != null && String(body.platform).trim() !== "") {
    return {
      ok: false,
      error: "请只使用 platform 或 platforms 其一，不要同时传",
    };
  }

  const shared = extractSharedPublishBody(body);
  const parsed = [];

  for (let i = 0; i < targets.length; i++) {
    const merged = { ...shared, ...targets[i] };
    const item = parsePublishRequest(merged);
    if (!item.ok) {
      const label =
        targets[i].platform != null ? String(targets[i].platform) : `#${i + 1}`;
      return { ok: false, error: `平台 ${label}: ${item.error}` };
    }
    if (item.value.dir) {
      return {
        ok: false,
        error: "HTTP API 暂不支持批量目录发布，请使用 cli publish --dir",
      };
    }
    parsed.push(applyHttpCreativeStatements(body, item.value, targets[i]));
  }

  const publishAtSet = new Set(
    parsed.map((item) => String(item.publishAt || "").trim()).filter(Boolean)
  );
  if (publishAtSet.size > 1) {
    return {
      ok: false,
      error: "多平台定时发布时，各平台 publishAt 必须相同",
    };
  }

  const fileSet = new Set(parsed.map((item) => String(item.file || "").trim()));
  if (fileSet.size > 1) {
    return { ok: false, error: "多平台发布需使用相同 file" };
  }

  return { ok: true, multi: parsed.length > 1, value: parsed };
}

export function publishHelpText() {
  return `
用法: <应用> cli publish [选项]

字段与 GUI「本地视频发布」弹窗一致（见 LocalVideoPublish buildVideoPayload）：

选项:
  -p, --platform <id>   平台：dy|抖音、tt|头条、ks|快手、blbl|哔哩哔哩、bjh|百家号、sph|视频号、xhs|小红书、fqsp|番茄视频
  -f, --file <path>     本地视频文件路径，或 http(s) 远程视频 URL（远程会先下载到临时目录，发布结束后自动删除）
      --dir <path>          [batch] video directory path; must be paired with --config
      --config <path>       [batch] xlsx declaration file path (columns: 文件名/标题/标签/创作声明)
      --cs, --creative-statement <val>  creative statement value for single-file mode.
                            Valid values: none | ai_generated | fiction | marketing | personal_opinion | repost | self_made_no_repost
                            (self_made_no_repost is blbl-only). Default: none.
      --phone <id>      账号手机号（与 GUI 账号树一致，可与 partition 二选一）
      --partition <p>   完整 session partition，如 persist:13800138000抖音
  -t, --title <text>    视频标题（必填）→ data.bt1
      --name <n>        名称 / 任务记录名 → bookName；默认与视频文件名（无扩展名）一致
      --book-name <n>   同 --name
      --bt2 <text>      概括短标 → data.bt2；【视频号必填】目标输入框提示 6-16 字符，代码会把
                            ，。、/,;:!?'"()[]{}<> 等标点替换为空格；不传则回退为 --title（会触发 warn）。
                            抖音/小红书也会消费 bt2（抖音拼进描述、小红书回退标题或正文），
                            哔哩哔哩/百家号/头条/快手当前不使用。
      --tags <text>     视频标签 → data.bq（同 --bq）。多个标签用【空格】分隔，例如 "减脂 健身 教程"。
                            【上限 4 个话题】：超过 4 个会触发 warn，agent 生成时请按相关性裁到 ≤ 4。
                            • 视频号/抖音/快手：整串拼进描述末尾；未写 # 的标签会自动补上（与 GUI 标签多选一致）。
                            • 哔哩哔哩/小红书：按空格切分为独立标签，前导 # 会被自动剥离，可省。
                            • 百家号/头条：当前代码不消费 bq，无需填。
      --publish-at <t>  一次性定时发布，格式 "YYYY-MM-DD HH:mm:ss"。创建后立即写入发布历史，
                            到点后由应用主进程调度执行；不支持每日/每周/每月循环。
      --show            （已忽略）CLI 不显示自动化窗口
      --no-close-window 发布后不自动关窗（仅 GUI 显示窗口时有效；CLI 始终后台运行）
      --draft           显式发布到草稿箱（小红书点「暂存离开」）。若账号在 GUI「媒体平台管理」
                            里开启了「默认发布到草稿」，即使不加该参数也会自动走草稿。
  -h, --help            显示帮助

退出码 (单文件): 0 成功, 1 异常, 2 参数错误, 3 任务失败（上传未成功）
退出码 (批量 --dir): 0 全部成功, 1 部分失败, 2 全部失败

示例:
  矩媒.exe cli publish -p dy --phone 13800138000 -f C:\\\\v.mp4 -t "我的视频标题" --tags "#减脂 #健身"
  electron . cli publish -p dy --phone 13800138000 -f ./a.mp4 --name "任务A" -t "标题" --tags "#标签1 #标签2"
  # 视频号务必带 --bt2 短标 + 空格分隔的 tags：
  matrixmedia cli publish -p sph --phone 13800138000 -f ./v.mp4 \\\\
    -t "新手第一天跑步就坚持 5 公里是什么体验" \\\\
    --bt2 "5公里新手挑战" \\\\
    --tags "跑步 新手 减脂"
  # 哔哩哔哩独立标签控件，空格分隔、是否带 # 都可：
  matrixmedia cli publish -p blbl --phone 13800138000 -f ./v.mp4 -t "标题" --tags "游戏 解说 开黑"
  # 一次性定时发布：必须提供实际视频、标题、账号等完整发布参数
  matrixmedia cli publish -p dy --phone 13800138000 -f ./v.mp4 -t "标题" --publish-at "2026-05-05 20:30:00"
  # batch publish with xlsx config:
  matrixmedia cli publish -p dy --phone 13800138000 --dir ./videos --config ./videos/batch.xlsx
`.trim();
}
