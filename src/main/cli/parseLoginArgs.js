'use strict'

const PLATFORM_ALIASES = {
  dy: '抖音',
  douyin: '抖音',
  抖音: '抖音'
}

/** 当前仅实现抖音扫码/网页登录 */
const SUPPORTED_LOGIN = ['抖音']

/**
 * 解析 `cli login` 后的 argv（不含子命令名 login）
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseLoginArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : []
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, value: { help: true } }
  }

  const out = {
    platform: null,
    phone: null,
    partition: null,
    show: false,
    terminalQr: true,
    timeoutSec: 900,
    saveQrPng: null,
    puppeteerHeadless: false
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--platform' || a === '-p') {
      out.platform = args[++i]
    } else if (a === '--phone') {
      out.phone = args[++i]
    } else if (a === '--partition') {
      out.partition = args[++i]
    } else if (a === '--hide') {
      out.show = false
    } else if (a === '--show') {
      out.show = true
    } else if (a === '--no-terminal-qr') {
      out.terminalQr = false
    } else if (a === '--timeout-sec') {
      const n = parseInt(args[++i], 10)
      if (!Number.isFinite(n) || n < 30) {
        return { ok: false, error: '--timeout-sec 需为不小于 30 的整数（秒）' }
      }
      out.timeoutSec = n
    } else if (a === '--save-qr-png') {
      out.saveQrPng = args[++i] || null
    } else if (a === '--puppeteer-headless') {
      out.puppeteerHeadless = true
    }
  }

  if (!out.platform) {
    return {
      ok: false,
      error: '缺少 --platform（或 -p），抖音登录请使用 dy / 抖音'
    }
  }
  const raw = String(out.platform).trim()
  const lower = raw.toLowerCase()
  const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[lower] || raw
  if (!SUPPORTED_LOGIN.includes(pt)) {
    return {
      ok: false,
      error: `cli login 当前仅支持抖音，收到: ${out.platform}。其它平台请先用 GUI 登录或后续再扩展。`
    }
  }
  out.platform = pt

  if (!out.partition) {
    if (!out.phone) {
      return {
        ok: false,
        error:
          '缺少 --phone 或完整 --partition（须与 GUI / publish 一致，如 persist:13800138000抖音）'
      }
    }
    const phoneSeg = String(out.phone).split('-')[0]
    out.partition = `persist:${phoneSeg}${out.platform}`
  }

  if (out.show) {
    console.warn('MatrixMedia: CLI 模式不打开登录窗口，已忽略 --show。')
  }
  out.show = false

  if (!out.puppeteerHeadless) {
    if (!out.terminalQr) {
      return {
        ok: false,
        error:
          'CLI 模式不打开浏览器登录窗口。请保留默认终端二维码（勿加 --no-terminal-qr），或使用 --puppeteer-headless。'
      }
    }
  } else if (!out.terminalQr && !out.saveQrPng) {
    return {
      ok: false,
      error:
        '--puppeteer-headless 须保留终端二维码（默认），或配合 --no-terminal-qr 时指定 --save-qr-png 以周期性写入扫码图。'
    }
  }

  return { ok: true, value: out }
}

export function loginHelpText() {
  return `
用法: <应用> cli login [选项]

与 GUI 共用同一 session partition（Cookie 持久化）。当前仅支持抖音。

终端扫码（默认）：同一 Electron 窗口 + puppeteer-in-electron 的 CDP 截图（page.screenshot），无需屏外坐标。Linux 无图形环境或 SSH 建议用 xvfb-run -a 包一层。

可选 --puppeteer-headless：用系统 Chrome/Chromium 真无头 + page.screenshot，userDataDir 与 partition 一致（需 PUPPETEER_EXECUTABLE_PATH 或已安装 Chrome/Chromium）。无 TTY 时请配合 --save-qr-png。

CLI 下不会打开 Electron 登录窗口；请使用终端二维码（默认）或 --puppeteer-headless。传入 --show 将被忽略并提示。

选项:
  -p, --platform <id>   仅支持 dy / 抖音
      --phone <id>      账号手机号（与 GUI 一致，与 --partition 二选一）
      --partition <p>   完整 partition，如 persist:13800138000抖音
      --show              （已忽略）历史兼容，CLI 不显示登录窗口
      --hide              不显示窗口（默认即为隐藏）
      --no-terminal-qr    关闭终端二维码时须使用 --puppeteer-headless
      --save-qr-png <p>   每次刷新写 PNG（优先 #animate_qrcode_container 内 data: 原图）
      --puppeteer-headless  使用 Puppeteer 无头 Chromium 截图/写 Cookie（非 Electron 窗口）
      --timeout-sec <n>   最长等待秒数，默认 900（15 分钟）
  -h, --help            显示本帮助

调试: MATRIX_CLI_QR_DEBUG=1 向 stderr 输出 [MatrixMedia][cli-qr] 日志（约每 6s 一次页面诊断）。
      MATRIX_CLI_QR_TERM_COLS=<24-260> 强制缩小终端二维码图（默认按图宽约每 1.85px 一列，上限终端宽）。
      MATRIX_CLI_QR_TERM_BLOCKS=full 栅格模式仅用 █（默认 ▀▄█；解码成功时优先 qrcode-terminal）。
      MATRIX_CLI_QR_NO_DECODE=1 强制栅格回退（不调 jsQR）。

退出码: 0 已登录或登录成功, 1 异常, 2 参数错误, 3 超时、用户关窗或仍未登录

示例:
  electron . cli login -p dy --phone 13800138000
  xvfb-run -a ./矩媒.AppImage cli login -p dy --phone 13800138000
  electron . cli login -p dy --phone 13800138000 --puppeteer-headless
  矩媒.exe cli login -p dy --phone 13800138000
`.trim()
}
