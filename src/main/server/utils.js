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

// 核心 CRUD
/**
 * @param {Object} item 数据对象，可包含部分字段
 * @param {String} fileName 不含 .json 的文件名
 * @param {String} type 操作类型：add / update / delete / get
 * @returns {Object|Array|null} 结果
 */
function changeData({ item, fileName, type }) {
  const folderPath = path.join(getDataDir(), fileName); // fileName 是文件夹
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  item = item || {};

  const dateFormat = "YYYY-MM-DD";
  const today = moment().format(dateFormat);
  const targetDate = item.date || today;
  const filePath = path.join(folderPath, `${targetDate}.json`);

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
      if (fileName == "pushData") {
        const duplicateIndex = list.findIndex(
          existingItem =>
            !existingItem.scheduledTask &&
            !newItem.scheduledTask &&
            existingItem.textOtherName === newItem.textOtherName &&
            existingItem.pt === newItem.pt &&
            existingItem.selectedFile === newItem.selectedFile &&
            existingItem.textType === newItem.textType
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
            ...oldItem,
            publishAttemptCount: attemptCount,
            republishCount: Math.max(0, attemptCount - 1),
            publishStatus: "publishing",
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

      // 获取文件夹下的所有日期文件
      const files = fs
        .readdirSync(folderPath)
        .filter(f => f.endsWith(".json"))
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

      // 遍历所有日期文件
      const files = fs.readdirSync(folderPath).filter(f => f.endsWith(".json"));

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
