const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const moment = require("moment"); // 引入日期处理库


const dataDir = path.resolve(__dirname, "data");
const agent = new https.Agent({
  rejectUnauthorized: false,
});

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
  const folderPath = path.join(dataDir, fileName); // fileName 是文件夹
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
        const isDuplicate = list.some(existingItem => existingItem.textOtherName === newItem.textOtherName && existingItem.pt === newItem.pt && existingItem.selectedFile === newItem.selectedFile && existingItem.textType === newItem.textType);
        console.log("isDuplicate是否存在相同的数据", isDuplicate);
        // 只有不是重复数据时才添加
        if (!isDuplicate) {
          list.push(newItem);
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
