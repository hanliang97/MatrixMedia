import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { runCli } from "../runner.js";

// Maps short platform codes to Chinese names used in session partition strings
const PLATFORM_CN: Record<string, string> = {
  dy: "抖音",
  ks: "快手",
  blbl: "哔哩哔哩",
  bjh: "百家号",
  tt: "头条",
  sph: "视频号",
};

// Derives the Electron session partition string from phone + platform code.
// Convention: persist:<phone><平台中文名>  e.g. persist:13800138000抖音
function derivePartition(phone: string, platform: string): string {
  const cn = PLATFORM_CN[platform] ?? platform;
  return `persist:${phone}${cn}`;
}

export const publishVideoTool: Tool = {
  name: "publish_video",
  description:
    "Publish a video to a target platform via MatrixMedia. Requires a logged-in account " +
    "identified by phone number. Partition is derived automatically. Long-running -- emits " +
    "progress notifications when a progressToken is supplied by the client.",
  inputSchema: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["dy", "ks", "blbl", "bjh", "tt", "sph"],
        description:
          "Target platform. dy=Douyin ks=Kuaishou blbl=Bilibili bjh=Baijiahao tt=Toutiao sph=Shipinhao",
      },
      file: {
        type: "string",
        description: "Absolute path to the video file to upload.",
      },
      title: {
        type: "string",
        description: "Video title.",
      },
      phone: {
        type: "string",
        description:
          "Phone number of the account to publish with. Used to derive the session partition automatically.",
      },
      bt2: {
        type: "string",
        description: "Optional secondary title / 第二标题.",
      },
      tags: {
        type: "string",
        description: "Optional tags string.",
      },
      address: {
        type: "string",
        description: "Optional location / 地址.",
      },
      publishAt: {
        type: "string",
        description:
          'Optional scheduled publish time, format "YYYY-MM-DD HH:mm".',
      },
      show: {
        type: "boolean",
        description: "If true, show the underlying browser window.",
      },
      draft: {
        type: "boolean",
        description:
          "If true, save the video to the platform draft box instead of publishing it.",
      },
      creativeStatement: {
        type: "string",
        description:
          "Optional creative statement / mark tag. For Shipinhao supports values like none, ai_generated, fiction, or Chinese labels such as 含AI生成内容.",
      },
      sphProductId: {
        type: "string",
        description:
          "Shipinhao product ID for attaching a shop product. Ignored for other platforms. Prefer this over sphLink for product-only use.",
      },
      sphLink: {
        type: "object",
        description:
          "Optional Shipinhao-only link configuration. Ignored for other platforms. If sphProductId is also set, sphProductId wins.",
        properties: {
          type: {
            type: "string",
            enum: ["none", "product"],
            description:
              "Shipinhao link type. product selects a product by ID.",
          },
          value: {
            type: "string",
            description: "Shipinhao product ID. Required when type=product.",
          },
        },
        required: ["type"],
      },
    },
    required: ["platform", "file", "title", "phone"],
  },
};

export async function handlePublishVideo(
  args: Record<string, unknown>,
  onProgress?: (elapsed: number) => void
): Promise<string> {
  const platform = args.platform;
  const file = args.file;
  const title = args.title;
  const phone = args.phone;
  const bt2 = args.bt2;
  const tags = args.tags;
  const address = args.address;
  const publishAt = args.publishAt;
  const show = args.show;
  const draft = args.draft;
  const creativeStatement =
    args.creativeStatement == null ? "" : String(args.creativeStatement).trim();
  const sphProductId =
    args.sphProductId == null ? "" : String(args.sphProductId).trim();
  const sphLink = args.sphLink;

  if (typeof phone !== "string" || phone.length === 0) {
    throw new Error("phone must be non-empty string");
  }

  if (typeof file !== "string" || file.length === 0) {
    throw new Error("file must be non-empty string");
  }

  // Derive partition from phone + platform automatically
  const partition = derivePartition(phone, String(platform));

  let sphLinkArgs: string[] = [];
  if (String(platform) === "sph") {
    if (sphProductId) {
      sphLinkArgs = ["--sph-product-id", sphProductId];
    } else if (sphLink && typeof sphLink === "object") {
      const link = sphLink as Record<string, unknown>;
      const type = String(link.type || "");
      const value = link.value == null ? "" : String(link.value).trim();
      if (type === "product" && !value) {
        throw new Error("sphLink.value is required when sphLink.type=product");
      }
      if (type === "product" || value) {
        sphLinkArgs = value
          ? ["--sph-product-id", value]
          : ["--sph-link-type", type];
      } else if (type) {
        sphLinkArgs = ["--sph-link-type", type];
      }
    }
  }

  const cliArgs: string[] = [
    "publish",
    "-p",
    String(platform),
    "-f",
    file,
    "-t",
    String(title),
    "--partition",
    partition,
    ...(bt2 ? ["--bt2", String(bt2)] : []),
    ...(tags ? ["--tags", String(tags)] : []),
    ...(address ? ["--address", String(address)] : []),
    ...(publishAt ? ["--publish-at", String(publishAt)] : []),
    ...(show ? ["--show"] : []),
    ...(draft ? ["--draft"] : []),
    ...(creativeStatement ? ["--creative-statement", creativeStatement] : []),
    ...sphLinkArgs,
  ];

  const result = await runCli(cliArgs, { onProgress });

  if (result.exitCode === 0) {
    const lastJson = result.lastJson;
    if (
      lastJson !== null &&
      typeof lastJson === "object" &&
      (lastJson as { scheduled?: unknown }).scheduled === true
    ) {
      return JSON.stringify({
        status: "scheduled",
        id: (lastJson as any).id,
        publishAt: (lastJson as any).publishAt,
        message: (lastJson as any).message,
      });
    }
    return JSON.stringify({
      status: (result.lastJson as any)?.resultStatus ?? "success",
      publishMode: (result.lastJson as any)?.publishMode,
      message: (result.lastJson as any)?.message ?? "上传成功",
    });
  }

  if (result.exitCode === 4) {
    return JSON.stringify({
      status: "needs_attention",
      publishMode: "draft",
      outcome: (result.lastJson as any)?.outcome ?? "draft_saved",
      needsAttention: true,
      message:
        (result.lastJson as any)?.message ?? "已转存草稿，请检查视频号链接",
    });
  }

  if (result.exitCode === 3) {
    throw new Error(
      (result.lastJson as any)?.message ?? "发布失败(登录态异常)"
    );
  }

  if (result.exitCode === 1) {
    throw new Error("发布超时或失败: " + result.stderr.slice(0, 300));
  }

  if (result.exitCode === 2) {
    throw new Error("参数错误: " + result.stderr.slice(0, 200));
  }

  throw new Error("未知错误 exit " + String(result.exitCode));
}
