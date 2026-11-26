import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { runCli } from "../runner.js";

export const VIDEO_PLATFORMS = ["dy", "ks", "blbl", "bjh", "tt", "sph", "xhs", "fqsp"] as const;

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
        enum: [...VIDEO_PLATFORMS],
        description:
          "Target platform. dy=抖音 ks=快手 blbl=哔哩哔哩 bjh=百家号 tt=头条 sph=视频号 xhs=小红书 fqsp=番茄视频",
      },
      file: {
        type: "string",
        description: "Absolute path to the video file to upload.",
      },
      title: {
        type: "string",
        description:
          "Video title (required). Douyin (dy) enforces a hard limit of 30 Unicode characters (CJK, ASCII, and punctuation each count as 1); titles over 30 chars are rejected.",
      },
      description: {
        type: "string",
        description:
          "Optional video description or body. Douyin/Kuaishou/Shipinhao append tags after this text; Xiaohongshu uses it as body; Bilibili uses it as the introduction field.",
      },
      shortTitle: {
        type: "string",
        description:
          "Optional Shipinhao-only short title, recommended 6-16 characters. Ignored by other platforms.",
      },
      phone: {
        type: "string",
        description:
          "Phone number of the account to publish with. Used to derive the session partition automatically.",
      },
      bt2: {
        type: "string",
        description:
          "Legacy compatibility: Shipinhao short title, or description on other platforms. Prefer description / shortTitle.",
      },
      tags: {
        type: "string",
        description:
          "Optional space-separated tags string. Douyin (dy) and Kuaishou (ks) enforce a hard limit of 4 hashtags.",
      },
      address: {
        type: "string",
        description: "Optional location / 地址.",
      },
      publishAt: {
        type: "string",
        description:
          'Optional one-time scheduled publish time, format "YYYY-MM-DD HH:mm:ss". Must be in the future; MatrixMedia must be running at that time.',
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
      noDownload: {
        type: "boolean",
        description:
          "Kuaishou (ks) only: uncheck 允许下载此作品 (disallow downloads for this work) and verify the final checkbox state before submitting; the publish aborts if it cannot be confirmed. Ignored on other platforms.",
      },
      creativeStatement: {
        type: "string",
        description:
          "Optional creative statement / mark tag. For Shipinhao supports values like none, ai_generated, fiction, or Chinese labels such as 含AI生成内容.",
      },
      cover: {
        type: "string",
        description:
          "Optional absolute path to a custom cover image. Effective for Douyin (dy), Kuaishou (ks) and Shipinhao (sph) single-file publish; 3:4 portrait ratio recommended (1080x1440 fits all three; Douyin auto-generates the horizontal cover from the portrait one; Shipinhao accepts jpg/png only).",
      },
      sphProductId: {
        type: "string",
        description:
          "Shipinhao product ID for attaching a shop product. Ignored for other platforms. Prefer this over sphLink for product-only use.",
      },
      sphDramaId: {
        type: "string",
        description:
          "Shipinhao mini-drama NAME (not an ID) for attaching a mini-drama (小程序短剧), e.g. 泳陷错恋. The publish page searches by name. Ignored for other platforms. Prefer this over sphLink for drama-only use.",
      },
      sphSeriesId: {
        type: "string",
        description:
          "Shipinhao drama-series NAME (not an ID) for attaching a native 视频号剧集 (distinct from mini-drama 小程序短剧). The publish page searches by name. Ignored for other platforms. Prefer this over sphLink for series-only use.",
      },
      sphLink: {
        type: "object",
        description:
          "Optional Shipinhao-only link configuration. Ignored for other platforms. If sphProductId, sphDramaId or sphSeriesId is also set, the shortcut field wins.",
        properties: {
          type: {
            type: "string",
            enum: ["none", "product", "mini_drama", "sph_series"],
            description:
              "Shipinhao link type. product selects a shop product by ID; mini_drama attaches a mini-drama by name; sph_series attaches a native drama series by name.",
          },
          value: {
            type: "string",
            description:
              "Shipinhao product ID, or mini-drama / drama-series NAME. Required when type=product, type=mini_drama or type=sph_series.",
          },
        },
        required: ["type"],
      },
      dyProductUrl: {
        type: "string",
        description:
          "Douyin (dy) product URL for attaching a shop product (商品挂车). Paste the full product link. Ignored for other platforms. Equivalent to dyLink with type=product.",
      },
      dyLink: {
        type: "object",
        description:
          "Optional Douyin-only link configuration. Ignored for other platforms. If dyProductUrl is also set, the shortcut field wins.",
        properties: {
          type: {
            type: "string",
            enum: ["none", "product"],
            description:
              "Douyin link type. product attaches a shop product by URL.",
          },
          value: {
            type: "string",
            description:
              "Douyin product URL. Required when type=product; must be a full http(s) link.",
          },
        },
        required: ["type"],
      },
      ksProductName: {
        type: "string",
        description:
          "Kuaishou (ks) product NAME (not an ID) for attaching a shop product (商品挂车). Must exactly match a product already on the shelf (货架), e.g. 泳陷错恋同款水杯. Ignored for other platforms. Equivalent to ksLink with type=product.",
      },
      ksLink: {
        type: "object",
        description:
          "Optional Kuaishou-only link configuration. Ignored for other platforms. If ksProductName is also set, the shortcut field wins.",
        properties: {
          type: {
            type: "string",
            enum: ["none", "product"],
            description:
              "Kuaishou link type. product attaches a shelf product by its full name.",
          },
          value: {
            type: "string",
            description:
              "Kuaishou shelf product full name. Required when type=product.",
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
  const description = args.description;
  const shortTitle = args.shortTitle;
  const phone = args.phone;
  const bt2 = args.bt2;
  const tags = args.tags;
  const address = args.address;
  const publishAt = args.publishAt;
  const show = args.show;
  const draft = args.draft;
  const noDownload = args.noDownload === true;
  const creativeStatement =
    args.creativeStatement == null ? "" : String(args.creativeStatement).trim();
  const cover = args.cover == null ? "" : String(args.cover).trim();
  const sphProductId =
    args.sphProductId == null ? "" : String(args.sphProductId).trim();
  const sphDramaId =
    args.sphDramaId == null ? "" : String(args.sphDramaId).trim();
  const sphSeriesId =
    args.sphSeriesId == null ? "" : String(args.sphSeriesId).trim();
  const sphLink = args.sphLink;
  const dyProductUrl =
    args.dyProductUrl == null ? "" : String(args.dyProductUrl).trim();
  const dyLink = args.dyLink;
  const ksProductName =
    args.ksProductName == null ? "" : String(args.ksProductName).trim();
  const ksLink = args.ksLink;

  if (typeof phone !== "string" || phone.length === 0) {
    throw new Error("phone must be non-empty string");
  }

  if (typeof file !== "string" || file.trim().length === 0) {
    throw new Error("file must be non-empty string");
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("title must be non-empty string");
  }

  if (!VIDEO_PLATFORMS.includes(String(platform) as (typeof VIDEO_PLATFORMS)[number])) {
    throw new Error("platform must be one of: " + VIDEO_PLATFORMS.join(", "));
  }

  const trimmedTitle = title.trim();
  const titleCharCount = Array.from(trimmedTitle).length;
  if (String(platform) === "dy" && titleCharCount > 30) {
    throw new Error(
      `参数错误: 抖音标题不能超过 30 字（当前 ${titleCharCount} 字，中英文与标点均按 1 字计），请缩短后重试`
    );
  }

  let sphLinkArgs: string[] = [];
  if (String(platform) === "sph") {
    if (sphProductId) {
      sphLinkArgs = ["--sph-product-id", sphProductId];
    } else if (sphDramaId) {
      sphLinkArgs = ["--sph-drama-id", sphDramaId];
    } else if (sphSeriesId) {
      sphLinkArgs = ["--sph-series-id", sphSeriesId];
    } else if (sphLink && typeof sphLink === "object") {
      const link = sphLink as Record<string, unknown>;
      const type = String(link.type || "");
      const value = link.value == null ? "" : String(link.value).trim();
      if (type === "product") {
        if (!value) {
          throw new Error(
            "sphLink.value is required when sphLink.type=product"
          );
        }
        sphLinkArgs = ["--sph-product-id", value];
      } else if (type === "mini_drama" || type === "drama") {
        if (!value) {
          throw new Error(
            "sphLink.value is required when sphLink.type=mini_drama"
          );
        }
        sphLinkArgs = ["--sph-drama-id", value];
      } else if (type === "sph_series" || type === "series") {
        if (!value) {
          throw new Error(
            "sphLink.value is required when sphLink.type=sph_series"
          );
        }
        sphLinkArgs = ["--sph-series-id", value];
      } else if (value) {
        // 兼容旧行为：未指定类型但给了编号时按商品处理
        sphLinkArgs = ["--sph-product-id", value];
      } else if (type) {
        sphLinkArgs = ["--sph-link-type", type];
      }
    }
  }

  // 抖音 / 快手商品挂车：与视频号同一套 publishOptions.link 契约，
// 走 --dy-product-url / --ks-product-name 快捷参数（等价于各自的 --link-value）。
  let dyLinkArgs: string[] = [];
  if (String(platform) === "dy") {
    if (dyProductUrl) {
      dyLinkArgs = ["--dy-product-url", dyProductUrl];
    } else if (dyLink && typeof dyLink === "object") {
      const link = dyLink as Record<string, unknown>;
      const type = String(link.type || "");
      const value = link.value == null ? "" : String(link.value).trim();
      if (type === "product" || (!type && value)) {
        if (!value) {
          throw new Error("dyLink.value is required when dyLink.type=product");
        }
        dyLinkArgs = ["--dy-product-url", value];
      } else if (type === "none") {
        dyLinkArgs = ["--dy-link-type", "none"];
      } else if (type) {
        throw new Error("dyLink.type must be one of: none, product");
      }
    }
  }

  let ksLinkArgs: string[] = [];
  if (String(platform) === "ks") {
    if (ksProductName) {
      ksLinkArgs = ["--ks-product-name", ksProductName];
    } else if (ksLink && typeof ksLink === "object") {
      const link = ksLink as Record<string, unknown>;
      const type = String(link.type || "");
      const value = link.value == null ? "" : String(link.value).trim();
      if (type === "product" || (!type && value)) {
        if (!value) {
          throw new Error("ksLink.value is required when ksLink.type=product");
        }
        ksLinkArgs = ["--ks-product-name", value];
      } else if (type === "none") {
        ksLinkArgs = ["--ks-link-type", "none"];
      } else if (type) {
        throw new Error("ksLink.type must be one of: none, product");
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
    trimmedTitle,
    // The CLI derives persist:<phone><平台中文名> itself, keeping every platform alias in sync.
    "--phone",
    phone,
    ...(description ? ["--description", String(description)] : []),
    ...(shortTitle ? ["--short-title", String(shortTitle)] : []),
    ...(bt2 ? ["--bt2", String(bt2)] : []),
    ...(tags ? ["--tags", String(tags)] : []),
    ...(address ? ["--address", String(address)] : []),
    ...(publishAt ? ["--publish-at", String(publishAt)] : []),
    ...(show ? ["--show"] : []),
    ...(draft ? ["--draft"] : []),
    ...(noDownload ? ["--no-download"] : []),
    ...(creativeStatement ? ["--creative-statement", creativeStatement] : []),
    ...(cover ? ["--cover", cover] : []),
    ...sphLinkArgs,
    ...dyLinkArgs,
    ...ksLinkArgs,
  ];

  const getCliMessage = (
    res: { lastJson: unknown; stderr: string },
    fallback: string,
    maxStderr = 300
  ): string => {
    const json = res.lastJson;
    if (json !== null && typeof json === "object") {
      const msg = (json as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim().length > 0) {
        return msg.trim();
      }
    }
    const errText = String(res.stderr || "").trim();
    if (errText.length > 0) {
      return errText.length > maxStderr
        ? errText.slice(errText.length - maxStderr)
        : errText;
    }
    return fallback;
  };

  const result = await runCli(cliArgs, { onProgress });

  if (result.exitCode === 0) {
    const lastJson = result.lastJson;
    if (lastJson === null || typeof lastJson !== "object") {
      throw new Error(
        "CLI 未返回发布结果（进程异常提前退出）" +
          (result.stderr ? `: ${result.stderr.slice(0, 200)}` : "")
      );
    }
    if ((lastJson as { scheduled?: unknown }).scheduled === true) {
      return JSON.stringify({
        status: "scheduled",
        id: (lastJson as any).id,
        publishAt: (lastJson as any).publishAt,
        message: (lastJson as any).message,
      });
    }
    if ((lastJson as { status?: unknown }).status === false) {
      throw new Error((lastJson as any)?.message ?? "发布失败");
    }
    const out: Record<string, unknown> = {
      status: (lastJson as any)?.resultStatus ?? "success",
      publishMode: (lastJson as any)?.publishMode,
      id: (lastJson as any)?.id ?? null,
      message: (lastJson as any)?.message ?? "上传成功",
    };
    if ((lastJson as any)?.effectiveTitle) {
      out.effectiveTitle = (lastJson as any).effectiveTitle;
    }
    if ((lastJson as any)?.titleTruncated) {
      out.titleTruncated = true;
    }
    return JSON.stringify(out);
  }

  if (result.exitCode === 4) {
    const lastJson = (result.lastJson && typeof result.lastJson === "object"
      ? result.lastJson
      : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {
      status: "needs_attention",
      publishMode:
        typeof lastJson.publishMode === "string"
          ? lastJson.publishMode
          : lastJson.outcome === "draft_saved" ||
              lastJson.outcome === "draft_unverified"
            ? "draft"
            : "publish",
      outcome: lastJson.outcome ?? "needs_attention",
      resultStatus: lastJson.resultStatus ?? "abnormal",
      id: lastJson.id ?? null,
      needsAttention: true,
      message: getCliMessage(result, "发布状态待人工核对，请检查平台作品管理或草稿箱"),
    };
    if (typeof lastJson.failScreenshot === "string" && lastJson.failScreenshot) {
      out.failScreenshot = lastJson.failScreenshot;
    }
    return JSON.stringify(out);
  }

  if (result.exitCode === 5) {
    throw new Error(
      "登录态已失效: " +
        getCliMessage(result, "登录状态已失效，请重新登录后再试")
    );
  }

  if (result.exitCode === 6) {
    throw new Error(
      "发布已取消: " +
        getCliMessage(result, "用户关闭窗口，已跳过该平台的发布")
    );
  }

  if (result.exitCode === 3) {
    const msg = getCliMessage(result, "发布失败");
    const shot =
      result.lastJson &&
      typeof result.lastJson === "object" &&
      typeof (result.lastJson as any).failScreenshot === "string"
        ? (result.lastJson as any).failScreenshot
        : "";
    throw new Error(shot ? `${msg}（截图: ${shot}）` : msg);
  }

  if (result.exitCode === 1) {
    throw new Error("发布超时或失败: " + getCliMessage(result, "发布超时或失败"));
  }

  if (result.exitCode === 2) {
    throw new Error("参数错误: " + getCliMessage(result, "参数错误", 200));
  }

  throw new Error(
    "未知错误 exit " +
      String(result.exitCode) +
      (result.stderr ? `: ${result.stderr.slice(0, 200)}` : "")
  );
}
