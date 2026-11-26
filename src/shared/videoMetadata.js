function firstText(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function semanticText(data, key, legacyKeys = []) {
  if (hasOwn(data, key)) return String(data[key] ?? "").trim();
  return firstText(...legacyKeys.map((legacyKey) => data[legacyKey]));
}

export function normalizeVideoTags(value) {
  const rawItems = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      rawItems
        .flatMap((item) => String(item || "").split(/[\s,，、;；|]+/))
        .flatMap((item) => String(item || "").split(/(?=#)/))
        .map((item) => String(item || "").trim().replace(/^#+/, ""))
        .filter(Boolean)
    ),
  ];
}

export function joinDescriptionAndTags(description, tags) {
  const tagsText = Array.isArray(tags) ? tags.join(" ") : String(tags || "");
  return [String(description || "").trim(), tagsText.trim()]
    .filter(Boolean)
    .join(" ");
}

/**
 * 各平台话题/标签的硬上限：超出时平台不是「权重降低」，而是直接拒绝本次提交。
 *
 * 快手：编辑器里每个 #话题 都是一个话题 chip，第 5 个会弹出「最多只能添加4个话题」，
 * 并且「发布」按钮的点击被这个校验吞掉——页面停在发布页、不改地址、不给成功提示，
 * 最终被 waitForPublishSignal 判成 signal=none 的「发布异常」。
 * 真实复现：5 个话题连续两次发布均 publish_abnormal，裁到 4 个后同一账号立即发布成功。
 * 所以在拼接描述文本时就裁到上限，并明确 warn 丢掉哪几个（不静默）。
 */
export const PLATFORM_TAG_LIMITS = {
  快手: 4,
  // 抖音：编辑器内每个 #话题 均为独立 chip，实测第 5 个起平台弹出「最多添加4个话题」
  // 并阻断发布（发布按钮点击被吞，页面停在发布页）。同一账号裁到 4 个后立即发布成功。
  // 此为平台硬限制，实测确认。
  抖音: 4,
};

/**
 * 各平台标题字数上限（按 Unicode 码点 1:1 计字，实机截图证实抖音中英文/标点均计 1 字）。
 * 抖音：标题输入框 .semi-input 硬截断于 30 字并标红，超长会破坏标题完整性或阻断提交；
 * 小红书：标题上限 20 字（xhs.js 内按码点截断）。
 */
export const PLATFORM_TITLE_LIMITS = {
  抖音: 30,
  小红书: 20,
};

/** 在 CLI / MCP / GUI 入口层前置硬拦截的平台标题上限（避免截断破坏标题） */
export const PLATFORM_STRICT_TITLE_LIMITS = {
  抖音: 30,
};

export function countCodePoints(str) {
  return Array.from(String(str ?? "")).length;
}

export function countTitleChars(title) {
  return countCodePoints(String(title ?? "").trim());
}

export function sliceCodePoints(str, max) {
  const limit = Math.max(0, Number(max) || 0);
  return Array.from(String(str ?? "")).slice(0, limit).join("");
}

/**
 * 校验指定平台标题字数是否超出硬上限。
 * 默认仅对 PLATFORM_STRICT_TITLE_LIMITS（当前为抖音 30 字）做硬拦截；
 * 传 strictOnly: false 时覆盖 PLATFORM_TITLE_LIMITS 全部平台。
 */
export function validatePlatformTitle(
  platform,
  title,
  { strictOnly = true } = {}
) {
  const pt = String(platform || "").trim();
  const limits = strictOnly
    ? PLATFORM_STRICT_TITLE_LIMITS
    : PLATFORM_TITLE_LIMITS;
  const limit = limits[pt] || 0;
  const length = countTitleChars(title);
  if (limit > 0 && length > limit) {
    return {
      ok: false,
      length,
      limit,
      error: `${pt}标题不能超过 ${limit} 字（当前 ${length} 字，中英文与标点均按 1 字计），请缩短后重试`,
    };
  }
  return { ok: true, length, limit, error: "" };
}

export function formatTagsForPlatform(platform, tags) {
  const prefix = platform === "哔哩哔哩" ? "" : "#";
  let normalized = normalizeVideoTags(tags);
  const limit = PLATFORM_TAG_LIMITS[platform] || 0;
  if (limit > 0 && normalized.length > limit) {
    const dropped = normalized.slice(limit);
    console.warn(
      `[text] ${platform} 话题上限 ${limit} 个（平台硬限制，超出会导致本次发布被拒绝），` +
        `已丢弃 ${dropped.length} 个：${dropped.join(" ")}`
    );
    normalized = normalized.slice(0, limit);
  }
  return normalized.map((tag) => `${prefix}${tag}`).join(" ");
}

export function buildPlatformVideoText(platform, metadata = {}) {
  const title = firstText(metadata.title, metadata.bt1);
  const description = firstText(metadata.description, metadata.bdText);
  const tagsText = formatTagsForPlatform(
    platform,
    metadata.tags ?? metadata.bq
  );
  const usesCombinedDescription = [
    "抖音",
    "视频号",
    "快手",
    "小红书",
  ].includes(platform);

  return {
    title,
    description: usesCombinedDescription
      ? joinDescriptionAndTags(description, tagsText)
      : description,
    shortTitle:
      platform === "视频号"
        ? firstText(metadata.shortTitle, metadata.bt2Filled)
        : "",
  };
}

export function normalizeVideoMetadata(raw = {}, platform = "") {
  const data = raw.data || raw;
  const title = semanticText(data, "title", ["bt1"]);
  const description = semanticText(data, "description", [
    "bdText",
    ...(platform === "视频号" ? [] : ["bt2"]),
  ]);
  const shortTitle = semanticText(data, "shortTitle", [
    "bt2Filled",
    ...(platform === "视频号" ? ["bt2"] : []),
  ]);
  const tags = normalizeVideoTags(data.tags ?? data.bq);

  return {
    title,
    description,
    shortTitle,
    tags,
    legacy: {
      bt1: title,
      bt2: description,
      bt2Filled: shortTitle,
      bdText: description,
      bq: tags.join(" "),
    },
  };
}

export function normalizeVideoRecordMetadata(record = {}) {
  const platform = record.pt || record.platform || "";
  const title = hasOwn(record, "title")
    ? String(record.title ?? "").trim()
    : firstText(record.bt, record.bt1);
  const data = { ...record, title };

  if (
    platform === "视频号" &&
    !hasOwn(record, "shortTitle") &&
    !hasOwn(record, "bt2Filled") &&
    firstText(record.bt2) === title
  ) {
    data.bt2 = "";
  }

  return normalizeVideoMetadata(data, platform);
}
