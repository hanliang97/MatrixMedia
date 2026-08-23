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

export function formatTagsForPlatform(platform, tags) {
  const prefix = platform === "哔哩哔哩" ? "" : "#";
  return normalizeVideoTags(tags)
    .map((tag) => `${prefix}${tag}`)
    .join(" ");
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
