"use strict";

/**
 * 草稿模式 e2e（issue #42）：对真实平台跑 `cli publish --draft`，
 * 验证「CLI 回报成功」与「后台草稿箱真的有草稿」是否一致，
 * 并采集主进程诊断行（[publish] ...）用于校准 pollDraftVerdict 的信号文案。
 *
 * 用法：
 *   node e2e/run.js                                  # 默认 dy,blbl,sph,xhs
 *   node e2e/run.js --platforms dy,xhs --show        # 指定平台 + 显示发布窗口
 *   node e2e/run.js --dry-run                        # 只打印将执行的命令
 *   node e2e/run.js --yes                            # 非交互（跳过后台人工核对）
 *
 * 结果分类见 e2e/README.md；报告写入 e2e/artifacts/<runId>/。
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const {
  detectAppBin,
  detectFfmpeg,
  pushDataDir,
  failScreenshotDir,
  artifactsRoot,
  loadPlatformManagePages,
  projectRoot,
  distMainPath,
  localElectronBin,
  isDevRunnerRunning,
  isDistStale,
} = require("./lib/config");
const { DEFAULT_PLATFORMS, CASES, resolvePlatformCodes } = require("./lib/platforms");
const {
  runCli,
  parseReceipt,
  parseAppVersion,
  collectEvidence,
  fetchAccounts,
} = require("./lib/cli");
const { ensureVideo } = require("./lib/video");
const { consoleTable, writeArtifacts, ATTENTION_RESULTS } = require("./lib/report");

function parseFlags(argv) {
  const out = {
    platforms: DEFAULT_PLATFORMS.join(","),
    video: "",
    phone: "",
    show: false,
    timeout: 300,
    yes: false,
    dryRun: false,
    force: false,
    refreshFixture: false,
    app: "",
    appMode: "dev",
    rebuild: false,
    skipBuild: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--platforms" || a === "-p") out.platforms = argv[++i];
    else if (a === "--video") out.video = argv[++i];
    else if (a === "--phone") out.phone = argv[++i];
    else if (a === "--show") out.show = true;
    else if (a === "--timeout") out.timeout = Number(argv[++i]) || 300;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--force") out.force = true;
    else if (a === "--refresh-fixture") out.refreshFixture = true;
    else if (a === "--app") out.app = argv[++i];
    else if (a === "--app-mode") out.appMode = argv[++i] || "dev";
    else if (a === "--rebuild") out.rebuild = true;
    else if (a === "--skip-build") out.skipBuild = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`未知参数: ${a}（--help 查看用法）`);
  }
  return out;
}

function usage() {
  console.log(`草稿模式 e2e（issue #42）

用法: node e2e/run.js [选项]

选项:
  --platforms, -p <列表>   平台别名，逗号分隔（默认 dy,blbl,sph,xhs；可用 dy/blbl/sph/xhs/ks/bjh/tt）
  --app-mode <dev|installed> 运行模式：dev=本地构建产物（默认，免打包），installed=已安装的 App
  --app <路径>             指定应用可执行文件（等价于 --app-mode installed）
  --rebuild                dev 模式下强制重新构建 dist（默认仅在产物缺失/过期时构建）
  --skip-build             dev 模式下跳过自动构建，直接用现有 dist
  --video <路径>           使用已有 mp4（默认用 ffmpeg 生成 6 秒测试卡）
  --phone <分组>           透传给 cli publish 的账号分组（不传则用默认账号）
  --show                   显示发布窗口（默认隐藏，靠截图与日志取证）
  --timeout <秒>           单平台超时，默认 300
  --yes, -y                非交互：跳过「后台草稿人工核对」
  --dry-run                只打印将执行的命令，不发布
  --force                  平台未登录也强行执行
  --refresh-fixture        重新生成测试视频
`);
}

/** 扫描 pushData 目录，返回包含 marker 的记录（跨文件名兼容：逐个 JSON 解析） */
function findPushRecords(marker) {
  const dir = pushDataDir();
  if (!fs.existsSync(dir)) return [];
  const hits = [];
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) continue;
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      const records = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
      for (const rec of records) {
        if (rec && typeof rec === "object" && JSON.stringify(rec).includes(marker)) {
          hits.push({ file: f, record: rec });
        }
      }
    } catch (_) {
      /* 非 JSON 内容跳过 */
    }
  }
  return hits;
}

/** 列出 runStart 之后新产生的失败截图 */
function findFreshScreenshots(runStartMs) {
  const dir = failScreenshotDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => path.join(dir, f))
    .filter((p) => {
      try {
        return fs.statSync(p).mtimeMs >= runStartMs;
      } catch (_) {
        return false;
      }
    });
}

/** 交互式人工核对：后台草稿箱里是否真的有这条草稿 */
async function askBackendCheck(platformName, manageUrl, marker) {
  if (!process.stdin.isTTY) return "";
  console.log(`\n[人工核对] ${platformName}: 请在已登录的浏览器打开内容管理页确认`);
  if (manageUrl) console.log(`  ${manageUrl}`);
  console.log(`  草稿标题应包含: ${marker}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => {
      rl.question("  后台草稿箱里能看到吗? [y=有 / n=没有 / s=跳过] ", resolve);
    });
    const a = String(answer).trim().toLowerCase();
    if (a === "y") return "有草稿";
    if (a === "n") return "无草稿";
    return "";
  } finally {
    rl.close();
  }
}

/** 根据回执与退出码分类（详见 README 的结果分类表） */
function classify({ r, receipt, hasVerifyLogic }) {
  if (r.timedOut) return "TIMEOUT";
  // CLI 对 skip 回执只透传 resultStatus: "skipped"，没有 skipped 字段
  if (receipt && (receipt.skipped || receipt.resultStatus === "skipped")) {
    return "SKIPPED_USER_CLOSE";
  }
  if (r.code === 0 && receipt) {
    if (receipt.draftVerified === true) return "PASS_VERIFIED";
    if (!hasVerifyLogic) return "LEGACY_SUCCESS";
    if (receipt.draftVerified === false) return "NEEDS_ATTENTION";
    return "PASS_VERIFIED";
  }
  if (r.code === 4) return "NEEDS_ATTENTION";
  if (r.code === 3) return "FAIL";
  return "ERROR";
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    usage();
    return 0;
  }

  const codes = resolvePlatformCodes(flags.platforms);
  const appMode = flags.app ? "installed" : flags.appMode === "installed" ? "installed" : "dev";
  const ffmpegPath = detectFfmpeg();
  const managePages = await loadPlatformManagePages();

  // 命令形态：
  //   dev       → <node_modules>/electron . cli <子命令>（基于 dist 构建产物，免打包）
  //   installed → /Applications/matrixmedia.app/.../matrixmedia cli <子命令>
  let cmd;
  let cmdPrefix;
  let cmdCwd;
  if (appMode === "dev") {
    const electronBin = localElectronBin();
    if (!electronBin) {
      throw new Error("未找到本地 electron（node_modules/electron），先 yarn install");
    }
    if (!flags.skipBuild && (flags.rebuild || isDistStale())) {
      if (isDevRunnerRunning() && !flags.rebuild) {
        console.log(
          "提示: 检测到 yarn dev 会话正在运行，跳过自动构建，直接使用当前 dist 产物；需要强制构建请加 --rebuild（并建议先停掉 yarn dev，避免争用 dist）"
        );
      } else {
        const { spawnSync } = require("child_process");
        const hasYarn = spawnSync("yarn", ["--version"], { stdio: "ignore" }).status === 0;
        const pmCmd = hasYarn ? "yarn" : "npm";
        const pmArgs = hasYarn ? ["build:dir"] : ["run", "build:dir"];
        console.log(`本地构建 dist（${pmCmd} ${pmArgs.join(" ")}，源码有更新或产物缺失）…`);
        const r = spawnSync(pmCmd, pmArgs, {
          cwd: projectRoot(),
          stdio: "inherit",
        });
        if (r.status !== 0) {
          throw new Error(`${pmCmd} ${pmArgs.join(" ")} 构建失败，无法以本地开发模式运行 e2e`);
        }
      }
    }
    if (!fs.existsSync(distMainPath())) {
      throw new Error(
        "dist/electron/main.js 不存在：先跑 yarn build:dir，或去掉 --skip-build 让 e2e 自动构建"
      );
    }
    cmd = electronBin;
    cmdPrefix = ["."];
    cmdCwd = projectRoot();
    console.log(`模式: 本地开发（electron . cli …，产物 ${distMainPath()}）`);
  } else {
    cmd = detectAppBin(flags.app);
    cmdPrefix = [];
    cmdCwd = undefined;
    console.log(`模式: 已安装 App（${cmd}）`);
  }
  const appBin = cmd;
  const buildCommand = (cliArgs) => ({
    cmd,
    args: [...cmdPrefix, "cli", ...cliArgs],
    cwd: cmdCwd,
  });

  // 预检：App 版本 + 各平台登录态（accounts --json 只读）
  let appVersion = "";
  const loginByName = {};
  const preflightAccounts = [];
  if (!flags.dryRun) {
    console.log("预检：cli accounts --json 查询登录态…");
    const accountsCmd = buildCommand(["accounts", "--json"]);
    const { accounts, version } = await fetchAccounts(accountsCmd.cmd, accountsCmd.args, {
      cwd: accountsCmd.cwd,
    });
    appVersion = version;
    preflightAccounts.push(...accounts);
    for (const acc of accounts) {
      if (!loginByName[acc.pt] || acc.loggedIn) {
        loginByName[acc.pt] = Boolean(acc.loggedIn);
      }
    }
    console.log(`App 版本: ${appVersion || "未知"}`);
  }

  // 测试视频
  let video = flags.video;
  if (video) {
    if (!fs.existsSync(video)) throw new Error(`--video 文件不存在: ${video}`);
  } else {
    video = ensureVideo({
      ffmpegPath,
      outPath: path.join(artifactsRoot(), "fixtures", "mm-e2e-720x1280.mp4"),
      force: flags.refreshFixture,
    });
  }
  console.log(`测试视频: ${video}\n`);

  const runId = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const runDir = path.join(artifactsRoot(), runId);
  const results = [];

  for (const code of codes) {
    const spec = CASES[code];
    if (!spec) throw new Error(`缺少平台用例定义: ${code}`);
    const result = {
      code,
      name: spec.name,
      result: "ERROR",
      exitCode: null,
      receipt: null,
      message: "",
      evidence: [],
      screenshots: [],
      pushRecords: [],
      backendCheck: "",
      error: "",
      stdoutLines: [],
      stderrLines: [],
    };
    results.push(result);

    // 登录预检
    if (!flags.dryRun && loginByName[spec.name] === false && !flags.force) {
      result.result = "SKIPPED_NO_LOGIN";
      result.message = `cli accounts 显示 ${spec.name} 未登录（--force 可强行执行）`;
      console.log(`[${code}] ${result.message}`);
      continue;
    }

    const marker = `MM-E2E-${runId}-${code}`;
    // --phone 未指定时从预检账号里自动取该平台首个已登录分组（CLI 必填账号选择器）
    let phoneForRun = flags.phone;
    if (!phoneForRun) {
      const acc = preflightAccounts.find((a) => a.pt === spec.name && a.loggedIn);
      if (acc) phoneForRun = acc.phone;
    }
    const cliArgs = [
      "publish",
      "-p", code,
      "-f", video,
      "-t", `${marker} 标题`,
      "--description", `${marker} MatrixMedia 草稿模式 e2e 校验（issue #42），确认后可删除`,
      ...(spec.tags ? ["--tags", spec.tags] : []),
      ...(spec.creativeStatement ? ["--cs", spec.creativeStatement] : []),
      ...(phoneForRun ? ["--phone", String(phoneForRun)] : []),
      ...(flags.show ? ["--show"] : []),
      "--draft",
    ];

    if (flags.dryRun) {
      result.result = "SKIPPED_DRYRUN";
      const c = buildCommand(cliArgs);
      result.message = [c.cmd, ...c.args].join(" ");
      console.log(`[dry-run] ${result.message}`);
      continue;
    }

    console.log(`\n[${code}] 开始发布草稿（marker=${marker}）…`);
    const runStart = Date.now();
    const pub = buildCommand(cliArgs);
    const r = await runCli(pub.cmd, pub.args, {
      cwd: pub.cwd,
      timeoutMs: flags.timeout * 1000,
      onLine: (line) => {
        if (/\[(publish|dy|sph|blbl|bjh|tt|ks|xhs)\]/.test(line)) {
          console.log(`  ${line}`);
        }
      },
    });

    result.exitCode = r.code;
    result.stdoutLines = r.stdout;
    result.stderrLines = r.stderr;
    result.receipt = parseReceipt(r.stdout);
    result.evidence = collectEvidence(r.stdout);
    result.screenshots = findFreshScreenshots(runStart);
    result.pushRecords = findPushRecords(marker);
    appVersion = appVersion || parseAppVersion(r.stdout);

    const hasVerifyLogic = Boolean(
      result.receipt &&
        (result.receipt.draftVerified !== undefined ||
          result.receipt.draftUrlUnchanged !== undefined)
    );
    result.result = classify({ r, receipt: result.receipt, hasVerifyLogic });
    if (result.receipt) result.message = result.receipt.message || "";
    else if (r.spawnError) result.message = r.spawnError;
    else if (r.stderr.length) result.message = r.stderr[r.stderr.length - 1];

    if (!hasVerifyLogic && ["PASS_VERIFIED", "LEGACY_SUCCESS"].includes(result.result)) {
      console.log(
        `[${code}] 提示: 回执无 draftVerified 字段，当前 App (${appVersion || "版本未知"}) 不含 #42 草稿校验逻辑，需重新打包安装后再验证`
      );
    }

    // 后台人工核对（交互模式；--yes 跳过）
    if (!flags.yes) {
      result.backendCheck = await askBackendCheck(
        spec.name,
        managePages[spec.name],
        marker
      );
      if (result.backendCheck === "无草稿" && result.result === "PASS_VERIFIED") {
        // App 校验说成功、后台却没有 → 信号误判，标记为失败供校准
        result.result = "NEEDS_ATTENTION";
        result.message = `App 校验成功但后台无草稿（信号误判），evidence: ${result.evidence
          .slice(-3)
          .join(" | ")}`;
      }
    }
  }

  consoleTable(results);
  const { reportJson, reportMd } = writeArtifacts({
    runDir,
    runId,
    meta: {
      appMode,
      appBin,
      appVersion,
      video,
      dryRun: flags.dryRun,
      generatedAt: new Date().toISOString(),
    },
    results,
  });
  console.log(`\n报告: ${reportMd}\nJSON: ${reportJson}`);

  const failed = results.filter(
    (r) => ATTENTION_RESULTS.has(r.result) || r.backendCheck === "无草稿"
  );
  if (flags.dryRun) return 0;
  return failed.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(String((e && e.message) || e));
    process.exit(2);
  });
