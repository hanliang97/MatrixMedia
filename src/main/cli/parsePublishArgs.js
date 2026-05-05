"use strict";

const PLATFORM_ALIASES = {
  dy: "抖音",
  douyin: "抖音",
  抖音: "抖音",
  sph: "视频号",
  视频号: "视频号",
  blbl: "哔哩哔哩",
  bilibili: "哔哩哔哩",
  哔哩哔哩: "哔哩哔哩",
  bjh: "百家号",
  百家号: "百家号",
  tt: "头条",
  toutiao: "头条",
  头条: "头条",
  ks: "快手",
  kuaishou: "快手",
  快手: "快手",
};

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
    address: "",
    publishAt: null,
    show: false,
    closeWindowAfterPublish: true,
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
    } else if (a === "--address") {
      out.address = args[++i] || "";
    } else if (a === "--publish-at") {
      out.publishAt = args[++i];
    } else if (a === "--show") {
      out.show = true;
    } else if (a === "--no-close-window") {
      out.closeWindowAfterPublish = false;
    }
  }

  if (!out.platform) {
    return { ok: false, error: "缺少 --platform（或 -p），例如 dy / 抖音" };
  }
  const raw = String(out.platform).trim();
  const lower = raw.toLowerCase();
  const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[lower] || raw;
  const canonical = ["抖音", "视频号", "哔哩哔哩", "百家号", "头条", "快手"];
  if (!canonical.includes(pt)) {
    return { ok: false, error: `未知平台: ${out.platform}` };
  }
  out.platform = pt;

  if (!out.file) {
    return { ok: false, error: "缺少 --file（或 -f）视频文件路径" };
  }

  if (!out.partition) {
    if (!out.phone) {
      return { ok: false, error: "缺少 --phone 或完整 --partition（与 GUI 一致，如 persist:13800138000抖音）" };
    }
    const phoneSeg = String(out.phone).split("-")[0];
    out.partition = `persist:${phoneSeg}${out.platform}`;
  }

  if (!out.title || !String(out.title).trim()) {
    return { ok: false, error: "缺少 --title（或 -t）视频标题（与 GUI「视频标题」一致，写入 data.bt1）" };
  }

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
      const withoutHash = tags.filter(t => !t.startsWith("#"));
      if (withoutHash.length > 0) {
        console.warn(
          `MatrixMedia: 平台 ${out.platform} 会把 --tags 原样拼进描述；${withoutHash.length} 个标签缺少 # 前缀（${withoutHash.join(" ")}），不会被识别为话题，仅作为普通文字。`
        );
      }
    }
  }

  return { ok: true, value: out };
}

export function publishHelpText() {
  return `
用法: <应用> cli publish [选项]

字段与 GUI「本地视频发布」弹窗一致（见 LocalVideoPublish buildVideoPayload）：

选项:
  -p, --platform <id>   平台：dy|抖音、tt|头条、ks|快手、blbl|哔哩哔哩、bjh|百家号、sph|视频号
  -f, --file <path>     本地视频文件路径
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
                            • 视频号/抖音/快手：整串拼进描述末尾，**必须带 # 前缀**成为话题
                              （如 "#减脂 #健身 #新手 #跑步"），缺 # 会被识别为普通尾缀文字。
                            • 哔哩哔哩/小红书：按空格切分为独立标签，前导 # 会被自动剥离，可省。
                            • 百家号/头条：当前代码不消费 bq，无需填。
      --address <text>  地址 → data.address；仅百家号
      --publish-at <t>  一次性定时发布，格式 "YYYY-MM-DD HH:mm:ss"。创建后立即写入发布历史，
                            到点后由应用主进程调度执行；不支持每日/每周/每月循环。
      --show            （已忽略）CLI 不显示自动化窗口
      --no-close-window 发布后不自动关窗（仅 GUI 显示窗口时有效；CLI 始终后台运行）
  -h, --help            显示帮助

退出码: 0 成功, 1 异常, 2 参数错误, 3 任务失败（上传未成功）

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
`.trim();
}
