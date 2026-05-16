import path from 'path'
import maybeClosePublishWindow from './closeWindow.js'
import {
  isCreativeStatementNone,
  resolveTtCreativeStatementLabel
} from '../../../shared/creativeStatement.js'
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil
} from './uploadTimeouts.js'
import ttPublishMode from './ttPublishMode.js'

// 头条「视频来源」勾选项支持的声明文案，未匹配则跳过不勾。
const TT_SUPPORTED_STATEMENT_LABELS = new Set([
  'AI生成',
  '虚构演绎，故事经历',
  '取自站外'
])

async function selectTtCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement
  console.log('[tt] creativeStatement 值 =', value)
  // 「无标注」：头条对应不勾选任何视频来源。
  if (isCreativeStatementNone(value)) {
    console.log('[tt] 无标注，头条保持不勾选')
    return
  }
  const label = resolveTtCreativeStatementLabel(value)
  if (!TT_SUPPORTED_STATEMENT_LABELS.has(label)) {
    console.warn(`[tt] 当前声明值 "${value}" 在头条没有对应勾选项，跳过`)
    return
  }
  console.log('[tt] 准备勾选视频来源:', label)

  const pickResult = await page.evaluate(text => {
    const norm = t =>
      String(t || '')
        .replace(/\s+/g, '')
        .trim()
    const target = norm(text)
    var wraps = document.querySelectorAll('.byte-checkbox.checkbot-item')
    var debug = []
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i]
      var span = wrap.querySelector('.byte-checkbox-inner-text')
      var t = span ? norm(span.textContent) : ''
      debug.push(t)
      if (t === target || t.indexOf(target) === 0) {
        var input = wrap.querySelector('input[type="checkbox"]')
        if (input && input.checked) return { ok: 'already', debug: debug }
        if (input) {
          try { input.click() } catch (_) {}
        }
        try { wrap.click() } catch (_) {}
        var inner = wrap.querySelector('.byte-checkbox-wrapper')
        if (inner) {
          try { inner.click() } catch (_) {}
        }
        return {
          ok: true,
          debug: debug,
          checkedAfter: input ? input.checked : null
        }
      }
    }
    return { ok: false, debug: debug }
  }, label)

  console.log(
    `[tt] 视频来源所有勾选项文案: ${JSON.stringify(pickResult.debug || [])}`
  )
  if (!pickResult || !pickResult.ok) {
    console.warn(`未找到头条视频来源勾选项: ${label}`)
    return
  }
  if (pickResult.ok === 'already') {
    console.log('[tt] 视频来源已是勾选状态，跳过')
    return
  }
  await page.waitForTimeout(300)
  console.log(
    `[tt] 已勾选视频来源: ${label}（checkedAfter=${pickResult.checkedAfter}）`
  )
}

const {
  getToutiaoCoverItemSelector,
  getToutiaoCoverMode,
  getToutiaoCoverTriggerSelector,
  getToutiaoPosterDialogSelector,
  isToutiaoProgressComplete,
  shouldClickToutiaoCoverClip,
  shouldRetryToutiaoProgressMissing,
  shouldSaveToutiaoDraft
} = ttPublishMode
// 已弃用：旧版页面靠这个 selector 勾「横屏」标签；新版同一位置变成了「作品声明」的
// combine-tip-wrap（含虚构演绎），点了会污染创作声明，现在改用「存草稿」按钮检测横屏。
// const TAG_SELECTOR = '.byte-checkbox-group span:nth-child(5) > label'

// 横屏判断信号：新版头条只有横屏视频会出现「存草稿」按钮，竖屏没有。
const HORIZONTAL_DRAFT_SELECTOR = '.video-batch-footer .draft'

function getErrorMessage(error) {
  if (!error) return '未知错误'
  return error.message || (typeof error === 'string' ? error : String(error))
}

// 检测当前发布页是横屏视频：以「存草稿」按钮是否存在为准（竖屏无该按钮）。
// 注意：该按钮通常在视频处理完成后才出现，调用时机要放在 progress 100% 之后。
async function detectToutiaoHorizontal(page) {
  try {
    await page.waitForSelector(HORIZONTAL_DRAFT_SELECTOR, {
      visible: true,
      timeout: 3000
    })
    console.log('[tt] 检测到「存草稿」按钮，按横屏流程处理')
    return true
  } catch (_) {
    console.log('[tt] 未检测到「存草稿」按钮，按竖屏流程处理')
    return false
  }
}

async function tryClickOptional(page, selector, timeout = 1200) {
  try {
    const element = await page.waitForSelector(selector, {
      visible: true,
      timeout
    })
    await element.click({ delay: 200 })
    return true
  } catch (e) {
    console.log(`头条可选按钮未出现，跳过 ${selector}`, getErrorMessage(e))
    return false
  }
}

async function clickReadyElement(
  page,
  selector,
  label,
  timeout = WAIT_SELECTOR_APPEAR_MS
) {
  await page.waitForFunction(
    sel => {
      const element = document.querySelector(sel)
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !element.classList.contains('cannot-click') &&
        element.getAttribute('aria-disabled') !== 'true' &&
        element.getAttribute('disabled') === null
      )
    },
    { timeout },
    selector
  )
  const clicked = await page.evaluate(sel => {
    const element = document.querySelector(sel)
    if (!element) return false
    element.scrollIntoView({ block: 'center', inline: 'center' })
    element.click()
    return true
  }, selector)
  if (!clicked) throw new Error(`未找到${label}`)
}

async function setToutiaoCover(page, hasTagSelector, setPublishStage) {
  const coverMode = getToutiaoCoverMode({ hasTagSelector })
  const coverItemSelector = getToutiaoCoverItemSelector()
  // 新版头条不再让用户从系统封面里挑一张，弹窗一打开就能直接「下一步」。
  // 给候选图一个短超时，找到就挑第一张兼容老版；找不到直接跳过进入下一步。
  let coverItems = []
  try {
    await page.waitForSelector(coverItemSelector, {
      visible: true,
      timeout: 5000
    })
    coverItems = await page.$$(coverItemSelector)
  } catch (_) {
    /* 新版无候选图，跳过 */
  }
  if (coverItems.length) {
    await coverItems[0].evaluate(element => {
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.click()
    })
    await page.waitForTimeout(3000)
    console.log(`选择${coverMode === 'horizontal' ? '横屏' : '竖屏'}系统封面`)
  } else {
    console.log('头条封面弹窗无系统候选图，直接进入下一步')
  }
  // 「下一步」按钮：新版结构是 .footer.undefined > .m-button.red，老版是 .m-poster-upgrade .footer .m-button。
  // 用 OR 选择器一起等，谁先就绪点谁。
  await clickReadyElement(
    page,
    'body .Dialog-container .m-poster-upgrade .footer .m-button.red, body .Dialog-container .m-poster-upgrade .footer .m-button, body .Dialog-container .footer .m-button.red',
    '头条封面下一步按钮',
    WAIT_SELECTOR_APPEAR_MS
  )
  setPublishStage('确认系统封面')
  console.log('确认系统封面')
  await page.waitForTimeout(3000)
  setPublishStage('点击裁剪')
  console.log('点击裁剪')
  // 裁剪按钮：有就点，没有（新版可能直接跳过裁剪步骤）就跳过，不阻断后续流程
  const clipBtn = await page.$('.base-content-wrap .clip-btn')
  if (clipBtn) {
    try {
      await clickReadyElement(
        page,
        '.base-content-wrap .clip-btn',
        '头条封面裁剪按钮',
        5000
      )
      await page.waitForTimeout(500)
      setPublishStage('裁剪完成')
      console.log('裁剪完成')
    } catch (e) {
      console.log('[tt] 裁剪按钮点击失败，跳过:', e?.message || e)
    }
  } else {
    console.log('[tt] 没有裁剪按钮，跳过裁剪步骤')
  }
  setPublishStage('点击确认')
  await clickReadyElement(
    page,
    '.base-content-wrap .btn-sure',
    '头条封面确认按钮'
  )
  await page.waitForTimeout(1000)
  setPublishStage('确认封面弹窗')
  await clickReadyElement(
    page,
    '.Dialog-container .footer .m-button.red',
    '头条封面弹窗确认按钮'
  )
  setPublishStage('封面设置完成')
}

async function waitForToutiaoUploadProgressComplete(page) {
  const deadline = Date.now() + WAIT_UPLOAD_PROCESSING_MS
  let lastLogValue = ''
  let lastLogAt = 0
  let missingProgressCount = 0
  while (Date.now() < deadline) {
    const progresses = await page
      .evaluate(() =>
        [...document.querySelectorAll('.progress-bar-inner')].map(bar => ({
          style: bar.getAttribute('style') || '',
          width: (bar.style && bar.style.width) || '',
          ariaValueNow: bar.getAttribute('aria-valuenow') || '',
          textContent: bar.textContent || ''
        }))
      )
      .catch(() => [])

    const logValue =
      progresses
        .map(
          (progress, index) =>
            `#${index + 1} width=${progress.width || '-'} style=${
              progress.style || '-'
            } aria=${progress.ariaValueNow || '-'} text=${
              String(progress.textContent || '').trim() || '-'
            }`
        )
        .join(' | ') || '未找到 .progress-bar-inner'

    if (progresses.length === 0) {
      missingProgressCount++
    } else {
      missingProgressCount = 0
    }

    if (logValue !== lastLogValue || Date.now() - lastLogAt >= 5000) {
      console.log(
        `头条上传进度：${logValue}${
          progresses.length === 0
            ? `（连续 ${missingProgressCount}/10 次）`
            : ''
        }`
      )
      lastLogValue = logValue
      lastLogAt = Date.now()
    }

    if (
      shouldRetryToutiaoProgressMissing({ missingCount: missingProgressCount })
    ) {
      const err = new Error('连续 10 次未找到头条上传进度条，准备重试')
      err.name = 'ProgressBarMissingError'
      throw err
    }

    if (progresses.some(progress => isToutiaoProgressComplete(progress))) {
      return
    }

    await page.waitForTimeout(1000)
  }

  const err = new Error('等待头条上传进度到 100% 超时')
  err.name = 'TimeoutError'
  throw err
}

async function openToutiaoCoverDialog(page) {
  const triggerSelector = getToutiaoCoverTriggerSelector()
  const dialogSelector = getToutiaoPosterDialogSelector()
  const trigger = await page.waitForSelector(triggerSelector, {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS
  })
  await trigger.evaluate(element => {
    element.scrollIntoView({ block: 'center', inline: 'center' })
  })
  await page.waitForTimeout(300)
  const clicked = await page.evaluate(selector => {
    const element = document.querySelector(selector)
    if (!element) return false
    element.click()
    return true
  }, triggerSelector)
  if (!clicked) throw new Error('未找到头条封面入口')
  await page.waitForSelector(dialogSelector, {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS
  })
}

export default async function (page, data, window, event) {
  const isDraftMode =
    data.publishMode === 'draft' || data.publishToDraft === true
  let hasTagSelector = false
  let publishStage = '初始化'

  console.log(data)
  console.log('[tt] 开始：等待上传 input')
  try {
    // 新老兼容：.byte-upload 是老版；新版可能挂在别的容器，加 OR 兜底
    const UPLOAD_SELECTORS = [
      '.byte-upload input[type="file"]',
      '.video-form input[type="file"]',
      '.upload-container input[type="file"]'
    ]
    const uploadSelector = UPLOAD_SELECTORS.join(', ')
    await page.waitForSelector(uploadSelector, {
      timeout: 60 * 1000
    })
    const uploadInputs = await page.$$(uploadSelector)
    if (!uploadInputs.length) throw new Error('未找到头条上传 input')
    const uploadFileHandle = uploadInputs[0]
    await uploadFileHandle.uploadFile(path.resolve(data.filePath))
    console.log('[tt] 文件已 uploadFile')
  } catch (err) {
    console.error('[tt] 文件上传失败:', err?.message || err)
  }

  console.log('[tt] 开始：等待标题输入框')
  try {
    // 新版标题输入框 placeholder 可能变化，多个候选 OR
    const TITLE_SELECTORS = [
      'input[placeholder="请输入 0～30 个字符"]',
      'input[placeholder*="0～30"]',
      'input[placeholder*="0-30"]',
      'input[placeholder*="字符"]'
    ]
    const titleSelector = TITLE_SELECTORS.join(', ')
    await page.waitForSelector(titleSelector, { timeout: 60 * 1000 })
    const input = await page.$(titleSelector)
    if (!input) throw new Error('未找到头条标题输入框')
    await input.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await page.keyboard.type(data.data.bt1 || '', { delay: 50 })
    console.log('[tt] 标题已输入')
  } catch (e) {
    console.error('[tt] ❌ 输入标题失败:', e?.message || e)
    // 也 dump 一下当前页面所有 input，便于追新的 placeholder
    try {
      const dump = await page.evaluate(() =>
        [...document.querySelectorAll('input')].map(el => ({
          placeholder: el.placeholder || '',
          type: el.type || '',
          id: el.id || ''
        }))
      )
      console.log('[tt] 当前页 inputs:', JSON.stringify(dump))
    } catch (_) {}
  }
  // 勾选「视频来源」声明（无标注则不勾选）—— 与横/竖屏无关，提前到上传等待之前执行
  try {
    await selectTtCreativeStatement(page, data)
  } catch (e) {
    console.warn('头条创作声明勾选未完成:', e?.message || e)
  }

  // 设置封面
  try {
    publishStage = '等待上传进度完成'
    console.log('等待上传进度到 100%')
    await waitForToutiaoUploadProgressComplete(page)

    // 上传完成后再检测横屏（新版只有横屏才会出现「存草稿」按钮）；
    // 不再依赖旧版那个误中作品声明的 nth-child(5) selector。
    hasTagSelector = await detectToutiaoHorizontal(page)
    publishStage = '打开封面设置'
    // 开始设置封面
    console.log('开始设置封面')
    await page.waitForTimeout(2000)
    await openToutiaoCoverDialog(page)
    console.log('封面弹窗已打开')
    publishStage = '调整封面'
    await setToutiaoCover(page, hasTagSelector, stage => {
      publishStage = stage
    })
    await page.waitForTimeout(1000)

    publishStage = '等待发布按钮'
    await page.waitForSelector('.video-batch-footer .action-footer-btn', {
      timeout: WAIT_SELECTOR_APPEAR_MS
    })
    await page.waitForTimeout(3000)

    publishStage = '等待视频处理完成'
    await pollPageUntil(
      page,
      () => {
        const els = document.querySelector('.basic-info  .m-right-btn .btn')
        return !!(els && els.textContent.trim() === '重新上传')
      },
      WAIT_UPLOAD_PROCESSING_MS
    )
    const shouldSaveDraft = shouldSaveToutiaoDraft({
      requestedDraft: isDraftMode,
      hasTagSelector
    })
    // 草稿：竖屏无标签时不支持保存草稿，直接走发布。
    await page.waitForTimeout(6000)
    if (shouldSaveDraft) {
      publishStage = '点击保存草稿'
      await clickReadyElement(
        page,
        '.video-batch-footer .draft',
        '头条保存草稿按钮'
      )
    } else {
      // 发布
      publishStage = '点击发布'
      await clickReadyElement(
        page,
        '.video-batch-footer .submit',
        '头条发布按钮'
      )
    }
    console.log(
      shouldSaveDraft ? '✅ 头条号视频已保存草稿' : '✅ 头条号视频上传成功'
    )
    setTimeout(() => {
      event.reply('puppeteerFile-done', {
        ...data,
        status: true,
        publishMode: shouldSaveDraft ? 'draft' : 'publish',
        publishToDraft: shouldSaveDraft,
        message: shouldSaveDraft ? '保存草稿成功' : '上传成功'
      })
      maybeClosePublishWindow(data, window)
    }, 5000)
  } catch (e) {
    const detail = getErrorMessage(e)
    console.error(`❌ 头条发布失败，阶段：${publishStage}`, e)
    event.reply('puppeteerFile-done', {
      ...data,
      status: false,
      message: `上传失败：${publishStage} - ${detail}`
    })
  }
}
