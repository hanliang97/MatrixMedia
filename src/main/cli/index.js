"use strict";

import path from "path";
import fs from 'fs';
import xlsx from 'xlsx';
import { normalizeCreativeStatement } from '../../shared/creativeStatement.js';
import { getCliSubArgv, isCliMode } from "./detectArgv";
import { parsePublishArgs, publishHelpText } from "./parsePublishArgs";
import { parsePublishArticleArgs, publishArticleHelpText } from "./parsePublishArticleArgs";
import { parseLoginArgs, loginHelpText } from "./parseLoginArgs";
import { parseAccountsArgs, accountsHelpText } from "./parseAccountsArgs";
import { parseHistoryArgs, historyHelpText } from "./parseHistoryArgs";
import { runAccountsCli } from "./runAccountsCli";
import { runHistoryCli } from "./runHistoryCli";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "../services/puppeteerFile";
import { runDouyinCliLogin } from "../services/cliLogin/douyinCliLogin";
import { runSphCliLogin } from "../services/cliLogin/sphCliLogin";
import { changeData } from "../server/utils";
import { createScheduledRecord } from "../services/scheduledPublish";
import { CLI_PUBLISH_TIMEOUT_MS } from "../services/upLoad/uploadTimeouts.js";

export {
  isCliMode,
  getCliSubArgv,
  parsePublishArgs,
  publishHelpText,
  parsePublishArticleArgs,
  publishArticleHelpText,
  parseLoginArgs,
  loginHelpText,
  parseAccountsArgs,
  accountsHelpText,
  parseHistoryArgs,
  historyHelpText,
};

function fileStem(filePath) {
  const base = path.basename(filePath || "");
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

function articleFileName(filePath) {
  return filePath ? path.basename(filePath) : "";
}

function todayYmd() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function derivePhoneForRecord(v) {
  if (v.phone) return String(v.phone);
  if (!v.partition) return "";
  const stripped = String(v.partition).replace(/^persist:/, "");
  const idx = stripped.indexOf(v.platform);
  return idx > 0 ? stripped.slice(0, idx) : stripped;
}

/**
 * Parse xlsx rows for batch publish. Mirrors ipcMain.js dialog:openBatchXlsx logic.
 * Returns [{fileName, title, tags, creativeStatement}] filtered to rows with non-empty fileName.
 */
function parseXlsxRows(xlsxPath) {
  const workbook = xlsx.readFile(xlsxPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  const cleanCell = (val) =>
    String(val || '')
      .replace(/[﻿​‌‍ ]/g, '')
      .replace(/[\n\t]/g, '')
      .trim();
  return rows.map(row => {
    const map = {};
    Object.keys(row).forEach(k => { map[cleanCell(k).toLowerCase()] = row[k]; });
    return {
      fileName: cleanCell(map['文件名'] != null ? map['文件名'] : map['filename'] != null ? map['filename'] : map['file'] || ''),
      title: cleanCell(map['标题'] != null ? map['标题'] : map['title'] || ''),
      tags: cleanCell(map['标签'] != null ? map['标签'] : map['tags'] || ''),
      creativeStatement: cleanCell(
        map['创作声明'] != null ? map['创作声明']
        : map['creativestatement'] != null ? map['creativestatement']
        : map['cs'] || ''
      ),
    };
  }).filter(r => r.fileName);
}

/**
 * Case-insensitive filename resolver: try exact match, then stem-only match.
 * Returns absolute resolved path or null if not found.
 */
function resolveFileInDir(dirPath, fileName) {
  const norm = (s) =>
    String(s || '')
      .replace(/[﻿​‌‍ ]/g, '')
      .replace(/[\n\t]/g, '')
      .trim()
      .toLowerCase();
  let entries;
  try { entries = fs.readdirSync(dirPath); } catch { return null; }
  const indexByName = new Map();
  const indexByStem = new Map();
  entries.forEach(entry => {
    indexByName.set(norm(entry), entry);
    const stem = entry.replace(/\.[^/.]+$/, '');
    if (!indexByStem.has(norm(stem))) indexByStem.set(norm(stem), entry);
  });
  const normName = norm(fileName);
  if (indexByName.has(normName)) return path.join(dirPath, indexByName.get(normName));
  if (indexByStem.has(normName)) return path.join(dirPath, indexByStem.get(normName));
  const stem = norm(String(fileName).replace(/\.[^/.]+$/, ''));
  if (indexByStem.has(stem)) return path.join(dirPath, indexByStem.get(stem));
  return null;
}

function deriveArticlePhoneForRecord(v) {
  if (v.phone) return String(v.phone).trim();
  if (!v.partition) return "";
  const stripped = String(v.partition).replace(/^persist:/, "");
  const idx = stripped.indexOf(v.platform);
  return idx > 0 ? stripped.slice(0, idx).trim() : stripped.trim();
}

function articleRecordValue(value) {
  return String(value || "");
}

function articleTagsValue(item) {
  return articleRecordValue(item.bq || item.tags);
}

function isSameArticleRecord(record, target) {
  return (
    record.textOtherName === target.textOtherName &&
    record.pt === target.pt &&
    record.textType === target.textType &&
    articleRecordValue(record.partition) === articleRecordValue(target.partition) &&
    articleRecordValue(record.articleFilePath) === articleRecordValue(target.articleFilePath) &&
    articleRecordValue(record.content) === articleRecordValue(target.content) &&
    articleRecordValue(record.coverPath) === articleRecordValue(target.coverPath) &&
    articleRecordValue(record.category) === articleRecordValue(target.category) &&
    articleTagsValue(record) === articleTagsValue(target) &&
    articleRecordValue(record.summary) === articleRecordValue(target.summary)
  );
}

/**
 * Batch directory publish handler.
 * @param {object} v - parsed publish args (must have .dir, .config, .platform, .partition, .phone)
 * @param {object} cfg - platform config from ptConfig
 * @returns {Promise<number>} exit code: 0=all success, 1=partial failure, 2=all failed
 */
async function runBatchDirPublish(v, cfg) {
  const resolvedDir = path.resolve(v.dir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error('目录不存在或不是有效目录: ' + resolvedDir);
    return 2;
  }
  const resolvedXlsx = path.resolve(v.config);
  if (!fs.existsSync(resolvedXlsx)) {
    console.error('xlsx 文件不存在: ' + resolvedXlsx);
    return 2;
  }

  let rows;
  try {
    rows = parseXlsxRows(resolvedXlsx);
  } catch (e) {
    console.error('解析 xlsx 失败: ' + (e && e.message ? e.message : String(e)));
    return 2;
  }
  if (rows.length === 0) {
    console.error('xlsx 中没有有效行（文件名列全部为空）');
    return 2;
  }

  const recordDate = todayYmd();
  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const resolvedFile = resolveFileInDir(resolvedDir, row.fileName);

    if (!resolvedFile) {
      const r = {
        index: i + 1,
        total: rows.length,
        fileName: row.fileName,
        title: row.title,
        platform: v.platform,
        phone: v.phone || '',
        status: 'skipped',
        message: '文件不存在: ' + row.fileName,
      };
      results.push(r);
      console.log(JSON.stringify({ progress: true, ...r }));
      continue;
    }

    const stem = fileStem(resolvedFile);
    const bt1 = (row.title && row.title.trim()) ? row.title.trim() : stem;
    const bt2 = bt1;
    const bookName = stem;

    // Format tags: split by comma (xlsx format), then # prefix for hashtag platforms
    const rawTags = String(row.tags || '').trim();
    let bq = '';
    if (rawTags) {
      const tagList = rawTags.split(',').map(t => t.trim()).filter(Boolean);
      const hashtagPlatforms = new Set(['视频号', '抖音', '快手']);
      if (hashtagPlatforms.has(v.platform)) {
        bq = tagList.map(t => t.startsWith('#') ? t : '#' + t).join(' ');
      } else {
        bq = tagList.map(t => t.replace(/^#/, '')).join(' ');
      }
    }

    const cs = normalizeCreativeStatement(row.creativeStatement || '');

    const taskId = Date.now() + Math.random();
    const taskPayload = {
      taskId,
      bookName,
      textType: 'local',
      data: {
        textOtherName: stem,
        bt1,
        bt2,
        bq,
        bdText: '',
        creativeStatement: cs,
      },
      url: cfg.upload,
      show: false,
      mmCliSuppressWindow: true,
      closeWindowAfterPublish: true,
      useragent: cfg.useragent,
      partition: v.partition,
      filePath: resolvedFile,
      pt: v.platform,
    };

    const selectedFile = path.basename(resolvedFile);
    const recordItem = {
      bookName,
      textOtherName: stem,
      textType: 'local',
      pt: v.platform,
      selectedFile,
      bt: bt1,
      bt2,
      bq,
      filePath: resolvedFile,
      useragent: cfg.useragent,
      phone: derivePhoneForRecord(v),
      partition: v.partition,
      url: cfg.listIndex,
      uploadUrl: cfg.upload,
      date: recordDate,
      publishAttemptCount: 1,
      republishCount: 0,
      publishSuccessCount: 0,
      publishFailCount: 0,
      publishStatus: 'publishing',
      lastPublishMessage: '等待发布结果',
      lastPublishAt: Date.now(),
    };

    let recordId = null;
    try {
      const addRes = changeData({ fileName: 'pushData', type: 'add', item: recordItem });
      if (addRes && addRes.success && Array.isArray(addRes.data)) {
        const found = [...addRes.data].reverse().find(
          it =>
            it.textOtherName === recordItem.textOtherName &&
            it.pt === recordItem.pt &&
            it.selectedFile === recordItem.selectedFile &&
            it.textType === recordItem.textType
        );
        if (found) recordId = found.id;
      }
    } catch (e) {
      console.error('MatrixMedia: 写入 pushData 初始记录失败 [' + row.fileName + ']:', e && e.message);
    }

    const updateRecord = (status, message) => {
      if (!recordId) return;
      try {
        changeData({
          fileName: 'pushData',
          type: 'update',
          item: {
            id: recordId,
            date: recordDate,
            publishStatus: status,
            publishSuccessCount: status === 'success' ? 1 : 0,
            publishFailCount: status === 'failed' ? 1 : 0,
            lastPublishMessage: message || '',
            lastPublishAt: Date.now(),
          },
        });
      } catch (e) {
        console.error('MatrixMedia: 更新 pushData 记录失败 [' + row.fileName + ']:', e && e.message);
      }
    };

    console.log(JSON.stringify({
      progress: true,
      index: i + 1,
      total: rows.length,
      fileName: row.fileName,
      title: bt1,
      platform: v.platform,
      phone: v.phone || '',
      status: 'publishing',
    }));

    const taskResult = await new Promise(resolve => {
      let settled = false;
      const finish = (ok, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, message });
      };

      const timer = setTimeout(() => {
        const min = Math.round(CLI_PUBLISH_TIMEOUT_MS / 60000);
        const msg = 'CLI publish 超时（' + min + ' 分钟）';
        console.error('[' + row.fileName + '] ' + msg);
        updateRecord('failed', msg);
        finish(false, msg);
      }, CLI_PUBLISH_TIMEOUT_MS);

      const transport = {
        reply(channel, payload) {
          if (channel === 'puppeteerFile-done') {
            if (payload && payload.taskId != null && payload.taskId !== taskId) return;
            if (payload && payload.skipped) {
              const msg = payload.message || '用户关闭窗口，已跳过发布';
              updateRecord('skipped', msg);
              finish(true, msg);
              return;
            }
            const ok = payload && payload.status === true;
            const msg = (payload && payload.message) || (ok ? '上传成功' : '上传失败');
            updateRecord(ok ? 'success' : 'failed', msg);
            finish(ok, msg);
          } else if (channel === 'puppeteer-noLogin') {
            if (payload && payload.taskId != null && payload.taskId !== taskId) return;
            const msg = '登录态异常或未登录';
            console.error('[' + row.fileName + '] ' + msg + ':', JSON.stringify(payload));
            updateRecord('failed', msg);
            finish(false, msg);
          }
        },
      };

      runPuppeteerTask(taskPayload, transport, () => {});
    });

    const r = {
      index: i + 1,
      total: rows.length,
      fileName: row.fileName,
      title: bt1,
      platform: v.platform,
      phone: v.phone || '',
      status: taskResult.ok ? 'success' : 'failed',
      message: taskResult.message,
    };
    results.push(r);
    console.log(JSON.stringify({ progress: true, done: true, ...r }));
  }

  // Summary
  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed' || r.status === 'skipped').length;
  console.log(JSON.stringify({
    summary: true,
    total: rows.length,
    succeeded,
    failed,
    message: '成功 ' + succeeded + ' / 失败 ' + failed,
    results,
  }));

  if (failed === 0) return 0;
  if (succeeded === 0) return 2;
  return 1;
}

/**
 * @returns {Promise<number>} 进程退出码
 */
export async function runCliMain(argv = process.argv) {
  const sub = getCliSubArgv(argv);
  if (!sub || sub.length === 0) {
    console.error("用法: <应用> cli <publish|publish-article|login|accounts|history> ...");
    console.error("  cli publish --help");
    console.error("  cli publish-article --help");
    console.error("  cli login --help");
    console.error("  cli accounts --help");
    console.error("  cli history --help");
    return 2;
  }

  const cmd = sub[0];
  if (cmd === "login") {
    const parsed = parseLoginArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(loginHelpText());
      return 0;
    }
    const v = parsed.value;
    try {
      const loginOpts = {
        partition: v.partition,
        show: v.show,
        terminalQr: v.terminalQr,
        timeoutMs: v.timeoutSec * 1000,
        saveQrPngPath: v.saveQrPng || null,
        puppeteerHeadless: v.puppeteerHeadless,
        phone: v.phone || null,
        force: v.force || false,
      };
      if (v.platform === "视频号") {
        return await runSphCliLogin(loginOpts);
      }
      return await runDouyinCliLogin(loginOpts);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "publish") {
    const parsed = parsePublishArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(publishHelpText());
      return 0;
    }

    const v = parsed.value;
    const cfg = ptConfig[v.platform];
    if (!cfg) {
      console.error("内部错误: 未找到平台配置", v.platform);
      return 2;
    }

    // Batch directory publish mode
    if (v.dir) {
      return await runBatchDirPublish(v, cfg);
    }

    const resolvedFile = path.resolve(v.file);
    const stem = fileStem(resolvedFile);
    const bt1 = String(v.title).trim();
    const bt2 = (v.bt2 && String(v.bt2).trim()) || bt1;
    const bookName = (v.bookName && String(v.bookName).trim()) || stem;

    const taskPayload = {
      taskId: Date.now() + Math.random(),
      bookName,
      textType: "local",
      data: {
        textOtherName: stem,
        bt1,
        bt2,
        bq: String(v.bq || "").trim(),
        bdText: "",
        creativeStatement: normalizeCreativeStatement(v.creativeStatement || ''),
      },
      url: cfg.upload,
      show: v.show,
      mmCliSuppressWindow: true,
      closeWindowAfterPublish: v.show ? v.closeWindowAfterPublish : true,
      useragent: cfg.useragent,
      partition: v.partition,
      filePath: resolvedFile,
      pt: v.platform,
    };

    const taskId = taskPayload.taskId;

    // 与 GUI LocalVideoPublish.buildVideoPayload / handleBatchPublish 的 pushData 写入保持一致，
    // 使 cli publish 的记录同时出现在 GUI 视频管理与 `cli history`。
    const recordDate = todayYmd();
    const selectedFile = path.basename(resolvedFile);
    const recordItem = {
      bookName,
      textOtherName: stem,
      textType: "local",
      pt: v.platform,
      selectedFile,
      bt: bt1,
      bt2,
      bq: String(v.bq || "").trim(),
      filePath: resolvedFile,
      useragent: cfg.useragent,
      phone: derivePhoneForRecord(v),
      partition: v.partition,
      url: cfg.listIndex,
      uploadUrl: cfg.upload,
      date: recordDate,
      publishAttemptCount: 1,
      republishCount: 0,
      publishSuccessCount: 0,
      publishFailCount: 0,
      publishStatus: "publishing",
      lastPublishMessage: "等待发布结果",
      lastPublishAt: Date.now(),
    };

    if (v.publishAt) {
      let scheduledRecord;
      try {
        scheduledRecord = createScheduledRecord(recordItem, v.publishAt);
      } catch (e) {
        console.error(e && e.message ? e.message : e);
        return 2;
      }
      try {
        const addRes = changeData({ fileName: "pushData", type: "add", item: scheduledRecord });
        let recordId = null;
        if (addRes && addRes.success && Array.isArray(addRes.data)) {
          const found = [...addRes.data].reverse().find(
            it =>
              it.scheduledTask === true &&
              it.scheduledPublishAt === scheduledRecord.scheduledPublishAt &&
              it.textOtherName === scheduledRecord.textOtherName &&
              it.pt === scheduledRecord.pt &&
              it.selectedFile === scheduledRecord.selectedFile &&
              it.textType === scheduledRecord.textType
          );
          if (found) recordId = found.id;
        }
        console.log(
          JSON.stringify({
            status: true,
            scheduled: true,
            id: recordId,
            publishAt: scheduledRecord.scheduledPublishAtText,
            message: "定时发布任务已创建，已写入发布历史",
          })
        );
        return 0;
      } catch (e) {
        console.error("MatrixMedia: 写入定时发布记录失败:", e && e.message);
        return 1;
      }
    }

    let recordId = null;
    try {
      const addRes = changeData({ fileName: "pushData", type: "add", item: recordItem });
      if (addRes && addRes.success && Array.isArray(addRes.data)) {
        const found = [...addRes.data].reverse().find(
          it =>
            it.textOtherName === recordItem.textOtherName &&
            it.pt === recordItem.pt &&
            it.selectedFile === recordItem.selectedFile &&
            it.textType === recordItem.textType
        );
        if (found) recordId = found.id;
      }
    } catch (e) {
      console.error("MatrixMedia: 写入 pushData 初始记录失败:", e && e.message);
    }

    const updateRecord = (status, message) => {
      if (!recordId) return;
      try {
        changeData({
          fileName: "pushData",
          type: "update",
          item: {
            id: recordId,
            date: recordDate,
            publishStatus: status,
            publishSuccessCount: status === "success" ? 1 : 0,
            publishFailCount: status === "failed" ? 1 : 0,
            lastPublishMessage: message || "",
            lastPublishAt: Date.now(),
          },
        });
      } catch (e) {
        console.error("MatrixMedia: 更新 pushData 记录失败:", e && e.message);
      }
    };

    return await new Promise(resolve => {
      let settled = false;
      const finish = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code);
      };

      const timer = setTimeout(() => {
        const min = Math.round(CLI_PUBLISH_TIMEOUT_MS / 60000);
        console.error(`CLI publish 超时（${min} 分钟），请检查网络或登录态`);
        updateRecord("failed", `CLI publish 超时 ${min} 分钟`);
        finish(1);
      }, CLI_PUBLISH_TIMEOUT_MS);

      const transport = {
        reply(channel, payload) {
          if (channel === "puppeteerFile-done") {
            if (payload && payload.taskId != null && payload.taskId !== taskId) {
              return;
            }
            if (payload && payload.skipped) {
              console.log(
                JSON.stringify({
                  channel,
                  skipped: true,
                  message: payload.message,
                })
              );
              updateRecord(
                "skipped",
                payload.message || "用户关闭窗口，已跳过发布"
              );
              finish(0);
              return;
            }
            const ok = payload && payload.status === true;
            console.log(JSON.stringify({ channel, status: ok, message: payload && payload.message }));
            updateRecord(ok ? "success" : "failed", (payload && payload.message) || (ok ? "上传成功" : "上传失败"));
            finish(ok ? 0 : 3);
          } else if (channel === "puppeteer-noLogin") {
            if (payload && payload.taskId != null && payload.taskId !== taskId) {
              return;
            }
            console.error("登录态异常或未登录:", JSON.stringify(payload));
            if (payload && payload.pt === "抖音") {
              console.error("提示: 可先执行 cli login -p dy --phone <手机号> 在本机完成扫码登录。");
            }
            updateRecord("failed", "登录态异常或未登录");
            finish(3);
          } else {
            console.log(channel, payload);
          }
        },
      };

      runPuppeteerTask(taskPayload, transport, () => {});
    });
  }

  if (cmd === "publish-article") {
    const parsed = parsePublishArticleArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(publishArticleHelpText());
      return 0;
    }

    const v = parsed.value;
    const cfg = ptConfig[v.platform];
    if (!cfg) {
      console.error("内部错误: 未找到平台配置", v.platform);
      return 2;
    }

    const resolvedArticleFile = v.file ? path.resolve(v.file) : "";
    const resolvedCover = v.cover ? path.resolve(v.cover) : "";
    const title = String(v.title).trim();
    const category = String(v.category || "前端").trim() || "前端";
    const tags = String(v.tags || "前端 Electron").trim() || "前端 Electron";
    const summary = String(v.summary || "");
    const content = String(v.content || "");
    const selectedFile = articleFileName(resolvedArticleFile);
    const phone = deriveArticlePhoneForRecord(v);

    const taskPayload = {
      taskId: Date.now() + Math.random(),
      bookName: title,
      textType: "article",
      data: {
        title,
        content,
        articleFilePath: resolvedArticleFile,
        coverPath: resolvedCover,
        category,
        tags,
        summary,
      },
      textOtherName: title,
      selectedFile,
      url: cfg.upload,
      show: v.show,
      mmCliSuppressWindow: true,
      closeWindowAfterPublish: true,
      useragent: cfg.useragent,
      partition: v.partition,
      pt: v.platform,
      phone,
      coverPath: resolvedCover,
    };

    const taskId = taskPayload.taskId;
    const recordDate = todayYmd();
    const recordItem = {
      bookName: title,
      textOtherName: title,
      textType: "article",
      pt: v.platform,
      selectedFile,
      bt: title,
      bq: tags,
      articleFilePath: resolvedArticleFile,
      coverPath: resolvedCover,
      category,
      summary,
      content,
      useragent: cfg.useragent,
      phone,
      partition: v.partition,
      url: cfg.listIndex,
      uploadUrl: cfg.upload,
      date: recordDate,
      publishAttemptCount: 1,
      republishCount: 0,
      publishSuccessCount: 0,
      publishFailCount: 0,
      publishStatus: "publishing",
      lastPublishMessage: "等待发布结果",
      lastPublishAt: Date.now(),
    };

    if (v.publishAt) {
      let scheduledRecord;
      try {
        scheduledRecord = createScheduledRecord(recordItem, v.publishAt);
      } catch (e) {
        console.error(e && e.message ? e.message : e);
        return 2;
      }
      try {
        const addRes = changeData({ fileName: "pushData", type: "add", item: scheduledRecord });
        let recordId = null;
        if (addRes && addRes.success && Array.isArray(addRes.data)) {
          const found = [...addRes.data].reverse().find(
            it =>
              it.scheduledTask === true &&
              it.scheduledPublishAt === scheduledRecord.scheduledPublishAt &&
              isSameArticleRecord(it, scheduledRecord)
          );
          if (found) recordId = found.id;
        }
        console.log(
          JSON.stringify({
            status: true,
            scheduled: true,
            id: recordId,
            publishAt: scheduledRecord.scheduledPublishAtText,
            message: "定时文章发布任务已创建，已写入发布历史",
          })
        );
        return 0;
      } catch (e) {
        console.error("MatrixMedia: 写入定时文章发布记录失败:", e && e.message);
        return 1;
      }
    }

    let recordId = null;
    try {
      const addRes = changeData({ fileName: "pushData", type: "add", item: recordItem });
      if (addRes && addRes.success && Array.isArray(addRes.data)) {
        const found = [...addRes.data].reverse().find(
          it => isSameArticleRecord(it, recordItem)
        );
        if (found) recordId = found.id;
      }
    } catch (e) {
      console.error("MatrixMedia: 写入文章 pushData 初始记录失败:", e && e.message);
    }

    const updateRecord = (status, message) => {
      if (!recordId) return;
      try {
        changeData({
          fileName: "pushData",
          type: "update",
          item: {
            id: recordId,
            date: recordDate,
            publishStatus: status,
            publishSuccessCount: status === "success" ? 1 : 0,
            publishFailCount: status === "failed" ? 1 : 0,
            lastPublishMessage: message || "",
            lastPublishAt: Date.now(),
          },
        });
      } catch (e) {
        console.error("MatrixMedia: 更新文章 pushData 记录失败:", e && e.message);
      }
    };

    return await new Promise(resolve => {
      let settled = false;
      const finish = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code);
      };

      const timer = setTimeout(() => {
        const min = Math.round(CLI_PUBLISH_TIMEOUT_MS / 60000);
        console.error(`CLI publish-article 超时（${min} 分钟），请检查网络或登录态`);
        updateRecord("failed", `CLI publish-article 超时 ${min} 分钟`);
        finish(1);
      }, CLI_PUBLISH_TIMEOUT_MS);

      const transport = {
        reply(channel, payload) {
          if (channel === "puppeteerFile-done") {
            if (payload && payload.taskId != null && payload.taskId !== taskId) {
              return;
            }
            if (payload && payload.skipped) {
              console.log(
                JSON.stringify({
                  channel,
                  skipped: true,
                  message: payload.message,
                })
              );
              updateRecord(
                "skipped",
                payload.message || "用户关闭窗口，已跳过发布"
              );
              finish(0);
              return;
            }
            const ok = payload && payload.status === true;
            console.log(JSON.stringify({ channel, status: ok, message: payload && payload.message }));
            updateRecord(ok ? "success" : "failed", (payload && payload.message) || (ok ? "文章发布成功" : "文章发布失败"));
            finish(ok ? 0 : 3);
          } else if (channel === "puppeteer-noLogin") {
            if (payload && payload.taskId != null && payload.taskId !== taskId) {
              return;
            }
            console.error("登录态异常或未登录:", JSON.stringify(payload));
            updateRecord("failed", "登录态异常或未登录");
            finish(3);
          } else {
            console.log(channel, payload);
          }
        },
      };

      runPuppeteerTask(taskPayload, transport, () => {});
    });
  }

  if (cmd === "accounts") {
    const parsed = parseAccountsArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(accountsHelpText());
      return 0;
    }
    try {
      return await runAccountsCli(parsed.value);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "history") {
    const parsed = parseHistoryArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(historyHelpText());
      return 0;
    }
    try {
      return runHistoryCli(parsed.value);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "--help" || cmd === "-h") {
    console.log("可用子命令: publish | publish-article | login | accounts | history");
    console.log("各自 --help 查看详细参数。");
    return 0;
  }

  console.error("未知子命令:", cmd);
  console.error("支持: publish | publish-article | login | accounts | history");
  return 2;
}
