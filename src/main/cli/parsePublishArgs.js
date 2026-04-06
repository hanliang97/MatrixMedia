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
      --bt2 <text>      概括短标题 → data.bt2；仅视频号等重点使用；默认与视频标题一致
      --tags <text>     视频标签 → data.bq（同 --bq）
      --address <text>  地址 → data.address；仅百家号
      --show            （已忽略）CLI 不显示自动化窗口
      --no-close-window 发布后不自动关窗（仅 GUI 显示窗口时有效；CLI 始终后台运行）
  -h, --help            显示帮助

退出码: 0 成功, 1 异常, 2 参数错误, 3 任务失败（上传未成功）

示例:
  矩媒.exe cli publish -p dy --phone 13800138000 -f C:\\\\v.mp4 -t "我的视频标题"
  electron . cli publish -p dy --phone 13800138000 -f ./a.mp4 --name "任务A" -t "标题" --tags "标签1"
`.trim();
}
