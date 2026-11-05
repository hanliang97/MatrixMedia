"use strict";

import path from "path";
import fs from "fs";
import { app, session } from "electron";
import ptConfig from "../config/ptConfig";
import { evaluateLoginCookies } from "../../shared/loginState.js";
import { buildAccountPartitionOf } from "../../shared/accountIdentity.js";
import { probeSphSession } from "../services/sphAuthProbe.js";
import { applyAccountProxyForTask } from "../services/proxyConfig.js";
import { getSphSessionId } from "../services/cliLogin/sphSessionUtil.js";
import { recoverSphLoginBackup } from "../services/cliLogin/sphLoginBackup.js";
import { replaceSphCookies } from "../services/sphCookieSession.js";

function getAccountsDir() {
  const documents = app.getPath("documents");
  return path.join(documents, "MatrixMedia", "data", "account");
}

function sphLoginBackupDir() {
  return path.join(app.getPath("userData"), "sph-login-backup");
}

function readAccounts() {
  const dir = getAccountsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  const seen = new Map();
  for (const f of files) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !item.phone || !item.pt) continue;
      const key = `${item.phone}__${item.pt}`;
      const prev = seen.get(key);
      if (!prev || (item.createTime || 0) > (prev.createTime || 0)) {
        seen.set(key, item);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.phone !== b.phone) return String(a.phone).localeCompare(String(b.phone));
    return String(a.pt).localeCompare(String(b.pt));
  });
}

async function probeLogin(account) {
  // partition 优先取记录存量值；缺失时按新分组模型 accountKey（回退历史 phone 前缀）拼装
  const partition =
    account.partition || buildAccountPartitionOf(account, account.pt);
  const cfg = ptConfig[account.pt];
  const probeUrl = account.url || (cfg && (cfg.listIndex || cfg.upload || cfg.index));
  if (!probeUrl) {
    return { loggedIn: false, reason: "缺少探测 URL", expireMs: null };
  }
  try {
    // partition 用完整值：它本身不含 phone 的 `-` 后缀，再裁一次会打到
    // 空 session 上，导致 cookie 判定与探测分属两个会话
    const ses = session.fromPartition(partition);

    // 视频号：上次 --force 登录若中途被杀，分区已被清空、磁盘上留有会话备份。
    // 这里做一次保守恢复（仅当分区完全没有 sessionid 时才写入，绝不覆盖现存会话），
    // 让状态查询能反映真实可用的登录态，而不是「登录成功过却显示无 cookie」。
    if (account.pt === "视频号") {
      // 与 GUI 登录/发布路径保持同一网络出口：本进程的 session 默认跟随系统代理，
      // 而 GUI 内的分区被 applyAccountProxyToSession 设为 direct / 账号代理。
      // 不对齐的话，探测会从另一个出口 IP 访问 auth_data，微信风控检测到同一
      // sessionid 短时间内双 IP 使用，会把刚扫码成功的会话作废（300334），
      // 表现为「登录成功后又要求登录」。代理配置非法时只告警，不阻断状态读取。
      try {
        await applyAccountProxyForTask({
          partition,
          phone: account.phone,
          pt: account.pt,
        });
      } catch (proxyErr) {
        console.warn(
          `[accounts] ${partition} 应用账号代理失败，探测按当前网络出口继续:`,
          proxyErr && proxyErr.message
        );
      }
      try {
        const message = await recoverSphLoginBackup({
          dir: sphLoginBackupDir(),
          partition,
          getSessionId: () => getSphSessionId(partition),
          probe: () => probeSphSession(partition),
          restoreCookies: (cookies) => replaceSphCookies(ses, cookies),
          onlyIfNoSession: true,
        });
        if (message) console.log(`[accounts] ${partition}: ${message}`);
      } catch (e) {
        console.warn(
          `[accounts] ${partition} 恢复上次登录备份失败:`,
          e && e.message
        );
      }
    }

    const cookies = await ses.cookies.get({ url: probeUrl });
    // 与 GUI 侧 getCookie 共用同一套判定，避免两处规则漂移
    const verdict = evaluateLoginCookies(account.pt, cookies);
    if (!verdict.loggedIn) return verdict;

    // 视频号：cookie 存在不代表会话有效，额外做一次真实探测
    if (account.pt === "视频号") {
      const probed = await probeSphSession(partition);
      if (probed.ok && probed.loggedIn === false) {
        return {
          loggedIn: false,
          reason: probed.reason || "会话已失效",
          expireMs: verdict.expireMs,
        };
      }
    }
    return verdict;
  } catch (e) {
    return { loggedIn: false, reason: `查询失败: ${e.message || e}`, expireMs: null };
  }
}

function formatExpire(ms) {
  if (!ms) return "-";
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function runAccountsCli(options) {
  const accounts = readAccounts();
  const filtered = accounts.filter(a => {
    if (options.platform && a.pt !== options.platform) return false;
    if (options.phone && String(a.phone) !== String(options.phone)) return false;
    return true;
  });

  const rows = [];
  for (const a of filtered) {
    const probe = await probeLogin(a);
    if (options.onlyLoggedIn && !probe.loggedIn) continue;
    if (options.onlyLoggedOut && probe.loggedIn) continue;
    rows.push({
      phone: a.phone,
      pt: a.pt,
      partition: a.partition || buildAccountPartitionOf(a, a.pt),
      loggedIn: probe.loggedIn,
      reason: probe.reason,
      expireAt: probe.expireMs,
      createdAt: a.createTime || null,
    });
  }

  if (options.json) {
    const json = JSON.stringify(rows, null, 2);
    if (options.outFile) {
      // 供 GUI 子进程读取：console 输出会混入 [startup] 等日志行，无法直接 JSON.parse
      fs.writeFileSync(options.outFile, json, "utf-8");
    } else {
      console.log(json);
    }
    return 0;
  }

  if (rows.length === 0) {
    console.log("（无匹配账号）数据目录：" + getAccountsDir());
    return 0;
  }

  const header = ["账号", "平台", "登录态", "失效时间", "说明"];
  const lines = rows.map(r => [
    String(r.phone),
    r.pt,
    r.loggedIn ? "已登录" : "未登录",
    formatExpire(r.expireAt),
    r.loggedIn ? "-" : r.reason || "-",
  ]);
  const widths = header.map((h, i) =>
    Math.max(displayWidth(h), ...lines.map(row => displayWidth(row[i])))
  );
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - displayWidth(s)));
  const render = row => row.map((c, i) => pad(c, widths[i])).join("  ");
  console.log(render(header));
  console.log(widths.map(w => "-".repeat(w)).join("  "));
  lines.forEach(r => console.log(render(r)));
  const ok = rows.filter(r => r.loggedIn).length;
  console.log(`\n共 ${rows.length} 个账号，已登录 ${ok}，未登录 ${rows.length - ok}`);
  return 0;
}

function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}
