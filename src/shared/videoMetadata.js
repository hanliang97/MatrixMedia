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
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,，、;；|]+/);
  return [
    ...new Set(
      items
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
};

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
