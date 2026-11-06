const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const moment = require("moment"); // 引入日期处理库

/**
 * 业务数据目录名（英文路径，避免卸载器/工具链编码问题；与 appId 一致便于识别）
 */
const PERSISTENT_DATA_ROOT = "MatrixMedia";

function dirHasContent(dir) {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * 从旧版 userData/data 一次性迁移到「文档」下目录（卸载应用时 userData 常被清空）。
 */
function migrateLegacyDataIfNeeded(legacyDir, dataDir) {
  if (!dirHasContent(legacyDir) || dirHasContent(dataDir)) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const name of fs.readdirSync(legacyDir)) {
      const from = path.join(legacyDir, name);
      const to = path.join(dataDir, name);
      fs.cpSync(from, to, { recursive: true });
    }
  } catch (e) {
    console.error("MatrixMedia: 迁移历史数据到文档目录失败", e);
  }
}

/**
 * 数据目录：打包后 __dirname 在 app.asar 内，无法写入。
 * 使用用户「文档」下的目录，卸载应用后一般仍会保留；并兼容从 userData/data 迁移。
 */
function getDataDir() {
  try {
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      const documents = app.getPath("documents");
      const dataDir = path.join(documents, PERSISTENT_DATA_ROOT, "data");
      const legacyDir = path.join(app.getPath("userData"), "data");
      migrateLegacyDataIfNeeded(legacyDir, dataDir);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      return dataDir;
    }
  } catch (_) {
    /* 非 Electron 主进程环境 */
  }
  return path.resolve(__dirname, "data");
}


// 工具：读取 JSON
function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

// 工具：写入 JSON
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// 工具：生成唯一 ID
function generateId() {
  return Date.now() + "" + Math.floor(Math.random() * 1000);
}

function recordValue(value) {
  return String(value || "");
}

function articleTagsValue(item) {
  return recordValue(item.bq || item.tags);
}

function isSamePushDataRecord(existingItem, newItem) {
  if (
    existingItem.textOtherName !== newItem.textOtherName ||
    existingItem.pt !== newItem.pt ||
    existingItem.textType !== newItem.textType
  ) {
    return false;
  }

  if (newItem.textType === "article") {
    return (
      recordValue(existingItem.partition) === recordValue(newItem.partition) &&
      recordValue(existingItem.articleFilePath) === recordValue(newItem.articleFilePath) &&
      recordValue(existingItem.content) === recordValue(newItem.content) &&
      recordValue(existingItem.coverPath) === recordValue(newItem.coverPath) &&
      recordValue(existingItem.category) === recordValue(newItem.category) &&
      articleTagsValue(existingItem) === articleTagsValue(newItem) &&
      recordValue(existingItem.summary) === recordValue(newItem.summary)
    );
  }

  return existingItem.selectedFile === newItem.selectedFile;
}

// 核心 CRUD
/**
 * 业务数据是「文档/MatrixMedia/data/<folder>/<YYYY-MM-DD>.json」结构，
 * folder 与日期都会直接拼进文件路径。两者都必须先校验：
 * 历史实现把 `fileName` / `item.date` 原样 `path.join`，`fileName: "../../.."`
 * 就能把 JSON 写到数据目录之外（本地网页通过 /changeData 也能触发），
 * 属于典型的路径穿越写文件。
 */
const DATA_FOLDER_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Windows 保留设备名能过上面的正则，但在 Windows 上会命中设备而不是目录 */
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const DATA_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATA_DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
/** 只有这些类型才读写「<日期>.json」；config / get / getDyData 不该被日期入参牵连 */
const DATE_FILE_TYPES = new Set(["add", "update", "delete"]);

function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch (_) {
    return "";
  }
}

/** target 是否在 base 目录内（先解析符号链接，挡住数据目录里指向外部的软链） */
function isInsideDir(base, target) {
  const realBase = safeRealpath(base);
  const realTarget = safeRealpath(target);
  if (!realBase || !realTarget) return false;
  return (
    realTarget === realBase ||
    realTarget.startsWith(realBase.endsWith(path.sep) ? realBase : realBase + path.sep)
  );
}

/** 解析并校验数据文件夹名（不含路径分隔符，禁止 . / .. / Windows 设备名） */
function resolveDataFolder(fileName) {
  if (typeof fileName !== "string") {
    return {
      ok: false,
      message: `非法的数据文件名：${JSON.stringify(fileName)}（必须是字符串）`,
    };
  }
  const name = fileName.trim();
  if (!DATA_FOLDER_NAME_RE.test(name) || WINDOWS_RESERVED_NAME_RE.test(name)) {
    return { ok: false, message: `非法的数据文件名：${JSON.stringify(fileName)}` };
  }
  return { ok: true, name, folderPath: path.join(getDataDir(), name) };
}

/**
 * 校验会进入文件名的日期：格式 + 日历有效性（'2026-99-99' 不能进历史文件，
 * 否则 get 分支按 moment 排序会得到 Invalid Date）。
 * 只有 add / update / delete 使用日期文件；config / get / getDyData 不受影响。
 */
function resolveTargetDate(item, type) {
  const usesDateFile = DATE_FILE_TYPES.has(type);
  if (!usesDateFile) return { ok: true, usesDateFile, targetDate: "" };
  if ((type === "update" || type === "delete") && !item.date) {
    return { ok: false, message: "请指定日期" };
  }
  const targetDate = item.date ? item.date : moment().format("YYYY-MM-DD");
  if (
    typeof targetDate !== "string" ||
    !DATA_DATE_RE.test(targetDate) ||
    !moment(targetDate, "YYYY-MM-DD", true).isValid()
  ) {
    return {
      ok: false,
      message: `非法的日期：${JSON.stringify(targetDate)}（格式应为 YYYY-MM-DD）`,
    };
  }
  return { ok: true, usesDateFile, targetDate };
}

/**
 * @param {Object} item 数据对象，可包含部分字段
 * @param {String} fileName 数据文件夹名（account / pushData / config 等）
 * @param {String} type 操作类型：add / update / delete / get
 * @returns {Object|Array|null} 结果
 */
function changeData(payload) {
  try {
    return changeDataUnsafe(payload);
  } catch (err) {
    // fs 层异常（权限、保留名、磁盘满）不再冒到 Express 变成 500
    console.error(
      "[changeData] 本地数据读写失败:",
      err && err.message ? err.message : err
    );
    return {
      success: false,
      message: `本地数据读写失败：${err && err.message ? err.message : err}`,
    };
  }
}

function changeDataUnsafe({ item, fileName, type, expectedTaskId } = {}) {
  const folder = resolveDataFolder(fileName);
  if (!folder.ok) {
    return { success: false, message: folder.message };
  }
  if (expectedTaskId !== undefined && (folder.name !== "pushData" || type !== "update" ||
      !["string", "number"].includes(typeof expectedTaskId) ||
      (typeof expectedTaskId === "string" && !expectedTaskId.trim()) ||
      (typeof expectedTaskId === "number" && !Number.isFinite(expectedTaskId)))) {
    return { success: false, code: "invalid_expected_task", message: "非法的发布任务匹配条件" };
  }
  const folderPath = folder.folderPath; // fileName 是文件夹
  const dataDir = getDataDir();
  item = item && typeof item === "object" ? item : {};

  // 先把所有会进入路径的入参校验完，再创建目录：非法请求不留任何副作用
  const date = resolveTargetDate(item, type);
  if (!date.ok) {
    return { success: false, message: date.message };
  }

  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  if (!isInsideDir(dataDir, folderPath)) {
    return { success: false, message: `非法的数据路径：${folder.name}` };
  }
  const filePath = date.usesDateFile
    ? path.join(folderPath, `${date.targetDate}.json`)
    : "";

  // 工具：读写每天的 JSON
  const readDayData = file => readJsonFile(file);
  const writeDayData = (file, data) => writeJsonFile(file, data);

  // obj数据
  // 如果是 config 类型（非列表，而是对象），文件名固定为 config.json
  if (type === "config") {
    const configPath = path.join(folderPath, "config.json");

    // 操作类型：item.action = get / update
    const action = item.action || "get";

    if (action === "get") {
      const configData = readJsonFile(configPath);
      return { success: true, data: configData };
    }

    if (action === "update") {
      const newConfig = {
        ...(item.data || {}), // 即使 item.data 为空也能写入空对象
      };
      writeJsonFile(configPath, newConfig);
      return { success: true, data: newConfig };
    }

    return { success: false, message: `不支持的 config 操作：${action}` };
  }

  // list 数据
  switch (type) {
    case "add": {
      let list = readDayData(filePath);
      const newItem = {
        ...item,
        id: item.id || generateId(),
        createTime: Date.now(),
      };

      // 如果是pushData文件名，则检查重复数据
      if (folder.name === "pushData") {
        const duplicateIndex = list.findIndex(
          existingItem =>
            !existingItem.scheduledTask &&
            !newItem.scheduledTask &&
            isSamePushDataRecord(existingItem, newItem)
        );
        const isDuplicate = duplicateIndex !== -1;
        console.log("isDuplicate是否存在相同的数据", isDuplicate);
        // 只有不是重复数据时才添加
        if (!isDuplicate) {
          const attemptCount = Number(newItem.publishAttemptCount) || 1;
          newItem.publishAttemptCount = attemptCount;
          newItem.republishCount = Math.max(0, attemptCount - 1);
          newItem.publishSuccessCount = Number(newItem.publishSuccessCount) || 0;
          newItem.publishFailCount = Number(newItem.publishFailCount) || 0;
          newItem.publishStatus = newItem.publishStatus || "publishing";
          newItem.lastPublishMessage = newItem.lastPublishMessage || "等待发布结果";
          newItem.lastPublishAt = newItem.lastPublishAt || Date.now();
          list.push(newItem);
        } else {
          const oldItem = list[duplicateIndex] || {};
          const attemptCount = (Number(oldItem.publishAttemptCount) || 1) + 1;
          list[duplicateIndex] = {
            // 以 oldItem 为基底保留历史字段（videoLink / publishAbnormalCount /
            // needsAttention 等由后续 update 写入、登记时的 newItem 上没有），
            // 再叠 newItem 让内容字段以最后一次为准：后补的 coverPath/tags/title
            // 能覆盖旧值（含显式空值），与文档「重跑干跑即可刷新登记」一致。
            ...oldItem,
            ...newItem,
            id: oldItem.id || newItem.id,
            createTime: oldItem.createTime || newItem.createTime,
            publishAttemptCount: attemptCount,
            republishCount: Math.max(0, attemptCount - 1),
            // 成败计数保留历史累计（newItem 登记时只是初始 0，结果回写走 update 按 id 覆盖）
            publishSuccessCount: Number(oldItem.publishSuccessCount) || 0,
            publishFailCount: Number(oldItem.publishFailCount) || 0,
            publishStatus: "publishing",
            // 重新发布已开始，清掉上一轮的失败截图，避免回看到旧画面
            failScreenshot: "",
            lastPublishMessage: "重新发布中",
            lastPublishAt: Date.now(),
          };
        }
      } else {
        // 非pushData文件名，直接添加
        list.push(newItem);
      }

      writeDayData(filePath, list);
      return { success: true, data: list };
    }

    case "update": {
      if (!item.date) {
        return { success: false, message: "请指定日期" };
      }
      let list = readDayData(filePath);
      const index = list.findIndex(obj => obj.id == item.id);
      if (index === -1) {
        return { success: false, message: `未找到 id=${item.id} 的记录` };
      }
      // 同一主进程同步读/比较/写：旧代次与终结后的事件不能覆盖当前任务。
      if (expectedTaskId !== undefined &&
          (list[index].taskId !== expectedTaskId || list[index].publishSettled === true)) {
        return { success: false, code: "stale_publish_task", message: "发布任务已变化或终结，已忽略过期回执" };
      }
      list[index] = { ...list[index], ...item };
      writeDayData(filePath, list);
      return { success: true, data: list };
    }

    case "delete": {
      if (!item.date) {
        return { success: false, message: "请指定日期" };
      }
      let list = readDayData(filePath);
      const newList = list.filter(obj => obj.id != item.id);
      if (newList.length === list.length) {
        return { success: false, message: `未找到 id=${item.id} 的记录` };
      }
      writeDayData(filePath, newList);
      return { success: true, data: newList };
    }

    case "get": {
      const page = parseInt(item.page) || 1;
      const pageSize = parseInt(item.pageSize) || 10;

      // 获取文件夹下的所有日期文件（只认 <YYYY-MM-DD>.json，且不跟随软链到目录外）
      const files = fs
        .readdirSync(folderPath)
        .filter(f => DATA_DAY_FILE_RE.test(f))
        .filter(f => isInsideDir(folderPath, path.join(folderPath, f)))
        .sort((a, b) => moment(b.replace(".json", "")) - moment(a.replace(".json", "")));

      // 分页获取 N 天
      const startIdx = (page - 1) * pageSize;
      const pagedFiles = files.slice(startIdx, startIdx + pageSize);

      const result = {};

      pagedFiles.forEach(fileName => {
        const dateKey = fileName.replace(".json", "");
        let dayData = readDayData(path.join(folderPath, fileName));

        // 可选：按名称过滤
        if (item.name) {
          dayData = dayData.filter(obj => obj.name?.includes(item.name));
        }

        result[dateKey] = dayData;
      });

      return {
        success: true,
        data: result,
        totalDays: files.length,
        page,
        pageSize,
      };
    }
    case "getDyData": {
      const targetName = item?.textOtherName?.trim();
      if (!targetName) {
        return { success: false, message: "请提供 textOtherName" };
      }

      // 遍历所有日期文件（同样只认日期文件名、不跟随目录外软链）
      const files = fs
        .readdirSync(folderPath)
        .filter(f => DATA_DAY_FILE_RE.test(f))
        .filter(f => isInsideDir(folderPath, path.join(folderPath, f)));

      for (const fileName of files) {
        const fullPath = path.join(folderPath, fileName);
        const list = readJsonFile(fullPath);
        const found = list.find(obj => obj?.data?.textOtherName === targetName);
        if (found) {
          return {
            success: true,
            data: found,
          };
        }
      }

      return {
        success: false,
        message: `未找到 textOtherName="${targetName}" 的记录`,
      };
    }

    default: {
      return { success: false, message: `不支持的操作类型：${type}` };
    }
  }
}


module.exports = {
  changeData,
};
