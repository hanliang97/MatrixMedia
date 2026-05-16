import path from 'path'
import maybeClosePublishWindow from './closeWindow.js'
import { resolveBjhCreativeStatementLabel } from '../../../shared/creativeStatement.js'
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS
} from './uploadTimeouts.js'

async function selectBjhCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement
  console.log('[bjh] creativeStatement 值 =', value)
  // 注意：「无标注」对应百家号「无需声明」，也必须主动点选，不能跳过
  const label = resolveBjhCreativeStatementLabel(value)
  console.log('[bjh] 准备选择创作声明:', label)

  // 1. 触发创作声明 modal：input 通常是只读的，单点 input 不一定能打开，
  //    所以依次尝试在 DOM 层面派发 click 到 input / 其外层 .form-inner-wrap，并 focus 一下。
  try {
    await page.waitForSelector('input[placeholder="请选择创作声明"]', {
      visible: true,
      timeout: 15000
    })
  } catch (_) {
    console.warn('未找到百家号创作声明输入框，跳过')
    return
  }
  const triggerInfo = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="请选择创作声明"]')
    if (!input) return { ok: false, reason: 'no-input' }
    const wrap = input.closest('.form-inner-wrap') || input.parentElement
    // 先 focus，再分别点 input 和外层包裹（点哪个生效取决于站点的事件绑定位置）
    try {
      input.focus()
    } catch (_) {}
    try {
      input.click()
    } catch (_) {}
    if (wrap && wrap !== input) {
      try {
        wrap.click()
      } catch (_) {}
    }
    return {
      ok: true,
      wrapTag: wrap ? wrap.tagName : null,
      wrapCls: wrap ? wrap.className : null
    }
  })
  console.log('[bjh] 已触发声明 input:', triggerInfo)

  // 2. 等弹窗出现（最长等 15s，弹窗未出现也可能是已经出现过被关掉/被遮罩盖住）
  try {
    await page.waitForSelector(
      '.cheetah-modal-content .cheetah-radio-wrapper',
      {
        visible: true,
        timeout: 15000
      }
    )
  } catch (e) {
    console.warn('百家号创作声明弹窗未出现:', e?.message || e)
    return
  }

  // 3. 在「必选声明」区点选对应文案的 radio：
  //    新版弹窗可能只渲染 .cheetah-modal-body，扩大根容器查找范围；
  //    同时把所有 radio 行文本列出来便于排查未命中时的真实文案。
  const pickResult = await page.evaluate(text => {
    const modal =
      document.querySelector('.cheetah-modal-content') ||
      document.querySelector('.cheetah-modal-body') ||
      document.querySelector('.cheetah-modal') ||
      document
    const norm = t =>
      String(t || '')
        .replace(/\s+/g, '')
        .trim()
    const target = norm(text)

    var wrappers = modal.querySelectorAll('.cheetah-radio-wrapper')
    var rowTexts = []
    var getRow = function (w) {
      return w.closest('.flex.items-center') || w.parentElement || w
    }
    for (var i = 0; i < wrappers.length; i++) {
      rowTexts.push(norm(getRow(wrappers[i]).textContent || ''))
    }

    // 1) 精确等于
    for (var i1 = 0; i1 < wrappers.length; i1++) {
      var w1 = wrappers[i1]
      var row1 = getRow(w1)
      if (norm(row1.textContent) === target) {
        var inp1 = w1.querySelector('input.cheetah-radio-input')
        if (inp1) try { inp1.click() } catch (_) {}
        try { w1.click() } catch (_) {}
        return { ok: true, mode: 'row-equal', rows: rowTexts }
      }
    }
    // 2) 行文本包含
    for (var i2 = 0; i2 < wrappers.length; i2++) {
      var w2 = wrappers[i2]
      var row2 = getRow(w2)
      if (norm(row2.textContent).indexOf(target) !== -1) {
        var inp2 = w2.querySelector('input.cheetah-radio-input')
        if (inp2) try { inp2.click() } catch (_) {}
        try { w2.click() } catch (_) {}
        return { ok: true, mode: 'row-includes', rows: rowTexts }
      }
    }
    // 3) span 文本反查
    var spans = modal.querySelectorAll('span')
    for (var i3 = 0; i3 < spans.length; i3++) {
      var sp = spans[i3]
      if (norm(sp.textContent) !== target) continue
      var row3 = sp.parentElement
      for (var k = 0; row3 && k < 6; k++) {
        var ri = row3.querySelector('input.cheetah-radio-input')
        var rl = row3.querySelector('.cheetah-radio-wrapper')
        if (ri || rl) {
          if (ri) try { ri.click() } catch (_) {}
          if (rl) try { rl.click() } catch (_) {}
          return { ok: true, mode: 'span-walkup', rows: rowTexts }
        }
        row3 = row3.parentElement
      }
    }
    return { ok: false, rows: rowTexts }
  }, label)

  console.log(
    `[bjh] radio 命中模式=${pickResult && pickResult.mode ? pickResult.mode : 'miss'}; 弹窗里 ${(pickResult && pickResult.rows ? pickResult.rows.length : 0)} 个 radio 行文本: ${JSON.stringify(pickResult && pickResult.rows || [])}`
  )
  const picked = pickResult && pickResult.ok

  if (!picked) {
    console.warn(`未找到百家号创作声明选项: ${label}`)
    return
  }
  await page.waitForTimeout(300)

  // 4. 点击弹窗底部「确定」按钮
  try {
    const confirmed = await page.evaluate(() => {
      const modal = document.querySelector('.cheetah-modal-content')
      if (!modal) return false
      // 优先在 .cheetah-modal-footer 范围内取 primary 按钮
      const footer = modal.querySelector('.cheetah-modal-footer')
      const scope = footer || modal
      const btn = scope.querySelector('button.cheetah-btn-primary')
      if (btn) {
        btn.click()
        return true
      }
      return false
    })
    if (!confirmed) {
      console.warn('未找到百家号创作声明确认按钮 button.cheetah-btn-primary')
    } else {
      console.log('[bjh] 已点击声明确认按钮')
    }
    await page.waitForTimeout(400)
  } catch (e) {
    console.warn('点击百家号声明确认按钮失败:', e?.message || e)
  }
}

export default async function (page, data, window, event) {
  const isDraftMode =
    data.publishMode === 'draft' || data.publishToDraft === true
  // 使用try-catch包装所有可能出错的操作
  try {
    await page.waitForTimeout(2000)
    // 百家号新版页面把上传 input 挂到了 .pages-videoV2-index 下；
    // 兼容老版 .video-main-container：用 OR 选择器一起等。
    const UPLOAD_SELECTORS = [
      '.pages-videoV2-index input[type="file"]',
      '.video-main-container input[type="file"]'
    ]
    const combinedSelector = UPLOAD_SELECTORS.join(', ')
    await page.waitForSelector(combinedSelector, {
      timeout: WAIT_SELECTOR_APPEAR_MS
    })
    const uploadInputs = await page.$$(combinedSelector)
    if (!uploadInputs.length) throw new Error('未找到百家号上传 input')
    const uploadFileHandle = uploadInputs[0]
    await uploadFileHandle.uploadFile(path.resolve(data.filePath))
    console.log(`[bjh] 已通过 ${combinedSelector} 上传文件`)
  } catch (err) {
    console.error('文件上传失败:', err)
    // 不抛出错误，继续执行后续步骤
  }

  try {
    console.log('[bjh] 等待发布表单就绪...')
    // 上传完成后页面会重渲染，先等"创作声明" input 出现，作为表单完整渲染的信号
    try {
      await page.waitForSelector('input[placeholder="请选择创作声明"]', {
        visible: true,
        timeout: 60 * 1000,
      })
      console.log('[bjh] 发布表单已就绪（声明 input 已出现）')
    } catch (_) {
      console.warn('[bjh] 等待声明 input 超时，按当前 DOM 继续尝试找标题')
    }
    // 再等一拍，避免 transition 过程中 DOM 还在变
    await page.waitForTimeout(800)

    // 打印页面上所有 input / textarea / contenteditable，定位标题输入框真实选择器
    const fieldDump = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].map(el => ({
        tag: 'input',
        id: el.id || '',
        placeholder: el.placeholder || '',
        type: el.type || '',
        maxlength: el.getAttribute('maxlength') || '',
        readonly: el.readOnly,
      }))
      const textareas = [...document.querySelectorAll('textarea')].map(el => ({
        tag: 'textarea',
        id: el.id || '',
        placeholder: el.placeholder || '',
        maxlength: el.getAttribute('maxlength') || '',
        readonly: el.readOnly,
        class: el.className || '',
      }))
      const editables = [
        ...document.querySelectorAll('[contenteditable="true"]'),
      ].map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        class: el.className || '',
        placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '',
        text: (el.textContent || '').slice(0, 30),
      }))
      return { inputs, textareas, editables }
    })
    console.log('[bjh] inputs:', JSON.stringify(fieldDump.inputs))
    console.log('[bjh] textareas:', JSON.stringify(fieldDump.textareas))
    console.log('[bjh] contenteditable:', JSON.stringify(fieldDump.editables))

    // 新版百家号标题是 contenteditable div（class 形如 FeEditorApp-xxx-contentEditable），
    // hash 中段每次构建可能变，用前缀+后缀模糊匹配。
    const TITLE_SELECTOR =
      'div[contenteditable="true"][class*="contentEditable"], div[contenteditable="true"][class*="FeEditorApp"]'
    await page.waitForSelector(TITLE_SELECTOR, { timeout: 20 * 1000 })
    const titleHandle = await page.$(TITLE_SELECTOR)
    if (!titleHandle) throw new Error('未找到标题 contenteditable')

    // 默认值是文件名前缀，需要先清空。focus + selectAll + delete，再 type 新内容。
    await titleHandle.focus()
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel2 = window.getSelection()
      sel2.removeAllRanges()
      sel2.addRange(range)
    }, TITLE_SELECTOR)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(150)
    await page.keyboard.type(data.data.bt1 || '', { delay: 50 })
    console.log('[bjh] 标题已输入')
  } catch (err) {
    console.error('[bjh] 标题处理失败:', err?.message || err)
  }


  // 标题/地址填完后立即选择创作声明（必须声明）
  try {
    console.log('选择创作声明')
    await selectBjhCreativeStatement(page, data)
  } catch (e) {
    console.warn('百家号创作声明选择未完成:', e?.message || e)
  }

  // 点击提交按钮
  try {
    // 等待 .upload-step-progress  .progress-container.uploading 消失
    await page.waitForSelector(".upload-step-progress  .progress-container.uploading", { hidden: true, timeout: WAIT_UPLOAD_PROCESSING_MS });
    await page.waitForTimeout(1000);

    // 草稿 / 发布 二选一点击，不能两个都点（先点存草稿会改变页面状态，发布按钮就摸不到了）
    if (isDraftMode) {
      // 「存草稿」是默认样式按钮，不是 primary。优先按文本精确匹配，避免误点定时发布。
      const clickedDraft = await page.evaluate(() => {
        const norm = t => String(t || "").replace(/\s+/g, "").trim();
        const root = document.querySelector("#new-operator-content .op-list-right") || document;
        const btns = root.querySelectorAll("button");
        for (let i = 0; i < btns.length; i++) {
          if (norm(btns[i].textContent) === "存草稿") {
            btns[i].click();
            return true;
          }
        }
        return false;
      });
      if (!clickedDraft) throw new Error("未找到百家号「存草稿」按钮");
      console.log("[bjh] 已点击存草稿");
    } else {
      // 「发布」是 primary solid 按钮，文本精确匹配 + 类名兜底
      const clickedPub = await page.evaluate(() => {
        const norm = t => String(t || "").replace(/\s+/g, "").trim();
        const root = document.querySelector("#new-operator-content .op-list-right") || document;
        const btns = root.querySelectorAll("button");
        for (let i = 0; i < btns.length; i++) {
          if (norm(btns[i].textContent) === "发布") {
            btns[i].click();
            return true;
          }
        }
        // 兜底：按 class 找 primary solid
        const fallback = root.querySelector("button.cheetah-btn-primary.cheetah-btn-solid");
        if (fallback) {
          fallback.click();
          return true;
        }
        return false;
      });
      if (!clickedPub) throw new Error("未找到百家号「发布」按钮");
      console.log("[bjh] 已点击发布");
    }
    console.log(isDraftMode ? "✅ 百家号视频已保存草稿" : "✅ 百家号视频上传成功");
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: isDraftMode ? "保存草稿成功" : "上传成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (err) {
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: "上传失败",
    });
    console.error("点击提交按钮失败:", err);
  }
}
