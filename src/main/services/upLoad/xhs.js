import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import {
  isCreativeStatementNone,
  resolveXhsCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { WAIT_SELECTOR_APPEAR_MS, WAIT_UPLOAD_PROCESSING_MS, pollPageUntil } from "./uploadTimeouts.js";

// 小红书下拉里直接展示的支持选项；未匹配则跳过。
const XHS_SUPPORTED_STATEMENT_LABELS = new Set([
  "笔记含AI合成内容",
  "虚构演绎，仅供娱乐",
  "内容包含营销广告",
]);

async function selectXhsCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[xhs] creativeStatement 值 =", value);
  if (isCreativeStatementNone(value)) {
    console.log("[xhs] 无标注，小红书保持不选");
    return;
  }
  const label = resolveXhsCreativeStatementLabel(value);
  if (!XHS_SUPPORTED_STATEMENT_LABELS.has(label)) {
    console.warn(`[xhs] 当前声明值 "${value}" 在小红书没有对应选项，跳过`);
    return;
  }
  console.log("[xhs] 准备选择内容类型声明:", label);

  // 1. 找到「添加内容类型声明」对应的 .d-select 触发器，给它打临时 id 让 page.click 命中
  //    （小红书的 d-select 实际监听 mousedown，纯 el.click() 不会打开下拉）
  const triggerId = await page.evaluate(
    "(function(){" +
      "var ps=document.querySelectorAll('.d-select-placeholder');" +
      "for(var i=0;i<ps.length;i++){" +
        "if((ps[i].textContent||'').replace(/\\s+/g,'').trim()==='添加内容类型声明'){" +
          "var sel=ps[i].closest('.d-select')||ps[i].parentElement;" +
          "if(!sel)return '';" +
          "var id='__xhs_stmt_'+Date.now();" +
          "sel.setAttribute('id',id);" +
          "return id;" +
        "}" +
      "}" +
      "return '';" +
    "})()"
  );
  if (!triggerId) {
    console.warn("未找到小红书「添加内容类型声明」入口，跳过");
    return;
  }
  try {
    await page.click("#" + triggerId, { delay: 80 });
    console.log("[xhs] 已 page.click 打开内容类型声明下拉");
  } catch (e) {
    console.warn("[xhs] page.click 失败，尝试 DOM 派发 mousedown:", e?.message || e);
    await page.evaluate(
      "(function(id){" +
        "var el=document.getElementById(id);" +
        "if(!el)return;" +
        "var r=el.getBoundingClientRect();" +
        "var o={bubbles:true,cancelable:true,view:window,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0};" +
        "el.dispatchEvent(new MouseEvent('mousedown',o));" +
        "el.dispatchEvent(new MouseEvent('mouseup',o));" +
        "el.dispatchEvent(new MouseEvent('click',o));" +
      "})(" + JSON.stringify(triggerId) + ")"
    );
  }

  // 2. 等下拉项渲染（字符串 evaluate，避开 babel 转译）
  try {
    await page.waitForFunction(
      "(function(){" +
        "var ns=document.querySelectorAll('.d-options-wrapper .d-option-name');" +
        "for(var i=0;i<ns.length;i++){" +
          "if((ns[i].textContent||'').replace(/\\s+/g,'').trim()===" + JSON.stringify(label.replace(/\s+/g, "").trim()) + ")return true;" +
        "}" +
        "return false;" +
      "})()",
      { timeout: WAIT_SELECTOR_APPEAR_MS }
    );
  } catch (e) {
    console.warn("小红书声明下拉项未出现:", e?.message || e);
    return;
  }

  // 3. 找目标行对应的 handler：.d-options 里 handler 和 content 是兄弟 grid-item，
  //    用 style="grid-area: N / x / ..." 里的行号 N 对齐。打临时 id 后用 page.click 真鼠标事件。
  const optId = await page.evaluate(
    "(function(){" +
      "var target=" + JSON.stringify(label.replace(/\s+/g, "").trim()) + ";" +
      "var items=document.querySelectorAll('.d-options-wrapper .d-option-name');" +
      "for(var i=0;i<items.length;i++){" +
        "var t=(items[i].textContent||'').replace(/\\s+/g,'').trim();" +
        "if(t!==target)continue;" +
        "var row=items[i].closest('.d-grid-item');" +
        "if(!row)return '';" +
        // 解析 grid-area 起始行号
        "var ga=row.getAttribute('style')||'';" +
        "var m=ga.match(/grid-area:\\s*(\\d+)/);" +
        "var rowNum=m?m[1]:'';" +
        "var handler=null;" +
        "if(rowNum&&row.parentElement){" +
          "var sibs=row.parentElement.querySelectorAll('.d-grid-item');" +
          "for(var s=0;s<sibs.length;s++){" +
            "var sga=sibs[s].getAttribute('style')||'';" +
            "var sm=sga.match(/grid-area:\\s*(\\d+)/);" +
            "if(sm&&sm[1]===rowNum){" +
              "var h=sibs[s].querySelector('.d-option-handler');" +
              "if(h){handler=h;break;}" +
            "}" +
          "}" +
        "}" +
        // 兜底：找不到对应行的 handler 就退到 content 行容器
        "if(!handler)handler=items[i].closest('.d-option')||row;" +
        "var id='__xhs_opt_'+Date.now();" +
        "handler.setAttribute('id',id);" +
        "return id;" +
      "}" +
      "return '';" +
    "})()"
  );
  if (!optId) {
    console.warn("未找到小红书声明选项: " + label);
    return;
  }
  try {
    await page.click("#" + optId, { delay: 80 });
  } catch (e) {
    console.warn("[xhs] 点击选项 page.click 失败，DOM 派发:", e?.message || e);
    await page.evaluate(
      "(function(id){" +
        "var el=document.getElementById(id);" +
        "if(!el)return;" +
        "var r=el.getBoundingClientRect();" +
        "var o={bubbles:true,cancelable:true,view:window,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0};" +
        "el.dispatchEvent(new MouseEvent('mousedown',o));" +
        "el.dispatchEvent(new MouseEvent('mouseup',o));" +
        "el.dispatchEvent(new MouseEvent('click',o));" +
      "})(" + JSON.stringify(optId) + ")"
    );
  }
  await page.waitForTimeout(400);

  // 4. 验证：只看声明 select 自己的 placeholder/description（按 triggerId 限定范围），
  //    避免把页面其它 .d-select-placeholder（如"添加地点"）当成结果。
  const selectedNow = await page.evaluate(
    "(function(id){" +
      "var sel=document.getElementById(id);" +
      "if(!sel)return '';" +
      "var d=sel.querySelector('.d-select-description');" +
      "var dt=d?(d.textContent||'').replace(/\\s+/g,'').trim():'';" +
      "if(dt)return dt;" +
      "var p=sel.querySelector('.d-select-placeholder');" +
      "var pt=p?(p.textContent||'').replace(/\\s+/g,'').trim():'';" +
      "if(pt&&pt!=='添加内容类型声明')return pt;" +
      "return '';" +
    "})(" + JSON.stringify(triggerId) + ")"
  );
  if (selectedNow) {
    console.log("[xhs] 已选择内容类型声明: " + label + "（页面显示=" + selectedNow + "）");
  } else {
    console.warn("[xhs] 点了选项但未观察到 placeholder 被替换，可能没真正选中: " + label);
  }
}

function normalizeTagList(rawTagText = "") {
  const tagText = String(rawTagText).trim();
  if (!tagText) return [];

  return tagText
    .split(/[\s,，;；、]+/)
    .flatMap(tag => tag.split(/(?=#)/))
    .map(tag => tag.replace(/^#/, "").trim())
    .filter(Boolean);
}

export default async function (page, data, window, event) {
  const isDraftMode = data.publishMode === "draft" || data.publishToDraft === true;
  console.log("小红书上传开始:", data);

  try {
    const uploadSelector = "input.upload-input[type='file']";
    await page.waitForSelector(uploadSelector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const uploadInput = await page.$(uploadSelector);
    if (!uploadInput) throw new Error("未找到上传 input");
    await uploadInput.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("❌ 小红书文件上传失败:", err);
    // 文件上传是流程起点，失败必须重试，把异常抛给 puppeteerFile 的 actionCheckTimer
    throw new Error(`小红书文件上传失败：${err?.message || err}`);
  }

  try {
    const titleSelector = ".publish-page-content-base .edit-container .d-input input.d-text";
    await page.waitForSelector(titleSelector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const titleInput = await page.$(titleSelector);
    if (!titleInput) throw new Error("未找到标题输入框");
    const titleText = (data.data?.bt1 || data.data?.bt2 || "").trim();
    await titleInput.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    if (titleText) {
      await page.type(titleSelector, titleText, { delay: 50 });
    }
  } catch (err) {
    console.error("❌ 小红书标题填写失败:", err);
    // 标题也是必填，挂了直接抛触发重试
    throw new Error(`小红书标题填写失败：${err?.message || err}`);
  }

  await page.waitForTimeout(300);

  // 正文/标签：用 keyboard.type + 字符串形式的 page.evaluate（避免 webpack 转译炸 "n is not defined"）
  try {
    const editorSelector = ".tiptap.ProseMirror";
    await page.waitForSelector(editorSelector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const editor = await page.$(editorSelector);
    if (!editor) throw new Error("未找到正文编辑器");

    const descText = String(data.data?.bt2 || "").trim();
    const tags = normalizeTagList(data.data?.bq || "");

    // 聚焦编辑器（先 puppeteer click 定位 caret，再字符串 evaluate 调 .focus() 双保险）
    await editor.click({ clickCount: 2 });
    await page.waitForTimeout(200);
    // 注意：page.evaluate 传字符串而不是函数，webpack/babel 不会去转译它，避免 "n is not defined"
    await page.evaluate(
      "(function(){var el=document.querySelector(" +
        JSON.stringify(editorSelector) +
        ");if(el)el.focus();})()"
    );
    await page.waitForTimeout(100);

    // 输入正文描述
    if (descText) {
      await page.keyboard.type(descText, { delay: 30 });
      await page.waitForTimeout(300);
      // 校验是否真的写进去了；没有则 fallback 用 execCommand insertText
      const ok = await page.evaluate(
        "(function(){var el=document.querySelector(" +
          JSON.stringify(editorSelector) +
          ");return !!(el && (el.textContent||'').trim());})()"
      );
      if (!ok) {
        console.warn("[xhs] keyboard.type 未写入正文，尝试 execCommand 兜底");
        await page.evaluate(
          "(function(){var el=document.querySelector(" +
            JSON.stringify(editorSelector) +
            ");if(!el)return;el.focus();document.execCommand('insertText',false," +
            JSON.stringify(descText) +
            ");})()"
        );
        await page.waitForTimeout(200);
      }
    }

    // 输入标签：每个 #xxx 后 Enter 选中候选弹窗第一项
    if (tags.length) {
      if (descText) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(400);
      }
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        await page.keyboard.type("#" + tag, { delay: 30 });
        await page.waitForTimeout(600); // 等小红书话题候选弹窗
        await page.keyboard.press("Enter"); // 选候选第一条 → 变成话题胶囊
        await page.waitForTimeout(300);
        if (i < tags.length - 1) {
          await page.keyboard.type(" ", { delay: 30 });
        }
      }
    }
  } catch (err) {
    console.error("❌ 小红书正文/标签填写失败:", err);
    throw new Error(`小红书正文/标签填写失败：${err?.message || err}`);
  }

  await page.waitForTimeout(300);

  // === 声明原创开关：默认不自动开启 ===
  // 之前会自动点 .original-wrapper .custom-switch-switch 把原创打开，
  // 进而在发布时弹出"原创承诺"二次确认弹窗，阻塞发布按钮的点击。
  // 现在保留不点；如果以后要按账号开关原创，再做成一个 data.originalDeclaration 开关。
  // try {
  //   const originalSwitchSelector = ".original-wrapper .custom-switch-switch";
  //   await page.waitForSelector(originalSwitchSelector, { timeout: 5000 });
  //   const originalSwitch = await page.$(originalSwitchSelector);
  //   if (originalSwitch) await originalSwitch.click();
  //   ...
  // } catch (err) { console.error("❌ 小红书声明原创失败:", err); }
  console.log("[xhs] 跳过自动声明原创");

  // 选择内容类型声明（无标注 / 不支持值会跳过）
  try {
    await selectXhsCreativeStatement(page, data);
  } catch (e) {
    console.warn("小红书内容类型声明选择未完成:", e?.message || e);
  }

  try {
    // 等视频上传完成：新版小红书在 .video-plugin-title-action 出现 "重新上传" 文案表示上传完成。
    // 老版兼容：找任何带 src 的 <video>。超时 2 分钟，到点不抛错继续。
    try {
      await pollPageUntil(
        page,
        "(function(){" +
          // 1) 新版：.video-plugin-title-action 含"重新上传"
          "var actions=document.querySelectorAll('.video-plugin-title-action');" +
          "for(var i=0;i<actions.length;i++){" +
            "var t=(actions[i].textContent||'').replace(/\\s+/g,'').trim();" +
            "if(t.indexOf('重新上传')!==-1)return true;" +
          "}" +
          // 2) 老版兜底：任何 video 元素有 src
          "var vs=document.querySelectorAll('video');" +
          "for(var j=0;j<vs.length;j++){" +
            "var s=vs[j].getAttribute('src')||vs[j].currentSrc||'';" +
            "if(String(s).trim().length>0)return true;" +
          "}" +
          "return false;" +
        "})()",
        WAIT_UPLOAD_PROCESSING_MS
      );
      console.log("[xhs] 视频上传完成（重新上传按钮已出现）");
    } catch (_) {
      console.log("[xhs] 视频上传等待超时，继续走发布流程");
    }

    // 新版发布按钮在 <xhs-publish-btn> 的 closed shadow root 里，
    // 标准 DOM API 拿不到内部 button。改用鼠标坐标点击：浏览器会自然把点击事件路由进 shadow 内部。
    // 宿主元素属性: is-publish="true" is-save-draft="true" submit-text="发布" save-text="暂存离开"
    // 内部布局是 .publish-page-publish-btn 横向 flex：左=暂存离开，右=发布
    console.log("[xhs] 等 xhs-publish-btn 宿主出现...");
    let hostHandle = null;
    try {
      hostHandle = await page.waitForSelector("xhs-publish-btn", {
        visible: true,
        timeout: 30 * 1000,
      });
    } catch (e) {
      console.warn("[xhs] 未找到 xhs-publish-btn 宿主元素:", e?.message || e);
    }
    if (!hostHandle) {
      // 老版兜底：直接找 .publish-page-publish-btn 里的 button
      hostHandle = await page.$(".publish-page-publish-btn");
    }
    if (!hostHandle) throw new Error("未找到任何可点击的发布按钮容器");

    // 等按钮变成"可点击"状态：宿主的 submit-disabled / save-disabled 属性为 false
    if (!isDraftMode) {
      console.log("[xhs] 等发布按钮 enable...");
      try {
        await pollPageUntil(
          page,
          "(function(){" +
            "var h=document.querySelector('xhs-publish-btn');" +
            "if(!h)return false;" +
            "return h.getAttribute('submit-disabled')==='false';" +
          "})()",
          30 * 1000
        );
        console.log("[xhs] 发布按钮已可用");
      } catch (_) {
        console.log("[xhs] 等发布按钮 enable 超时（30s），强行点击");
      }
    }

    // 用 page.mouse.click 在宿主对应位置点 —— 坐标会被浏览器路由进 closed shadow 内部 button
    const box = await hostHandle.boundingBox();
    if (!box) throw new Error("发布按钮宿主无 boundingBox（未渲染或被遮挡）");
    console.log(
      "[xhs] 宿主 box=", JSON.stringify({ x: box.x, y: box.y, w: box.width, h: box.height })
    );
    // 实测 .publish-page-publish-btn 布局（680x90）：
    //   暂存离开 中心 ≈ 30% 宽
    //   发布     中心 ≈ 55% 宽（右侧还有大量 padding 空白，别用 75% 会落空）
    const xRatio = isDraftMode ? 0.30 : 0.55;
    const cx = box.x + box.width * xRatio;
    const cy = box.y + box.height * 0.5;

    const targetText = isDraftMode ? "暂存离开" : "发布";
    let clickedOk = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await page.mouse.click(cx, cy, { delay: 80 });
      console.log(
        `[xhs] 第 ${attempt} 次点击「${targetText}」at (${Math.round(cx)},${Math.round(cy)})`
      );
      await page.waitForTimeout(1500);
      // 验证成功：宿主消失/换页/属性变化
      const stillThere = await page.evaluate(
        "(function(){return !!document.querySelector('xhs-publish-btn');})()"
      );
      if (!stillThere) {
        console.log(`[xhs] xhs-publish-btn 宿主已消失，发布动作生效`);
        clickedOk = true;
        break;
      }
      // 顺手关掉可能弹出的确认模态
      await page.evaluate(
        "(function(){" +
          "var dialog=document.querySelector('.originalContainer .footer .d-button, .d-modal .d-button-primary, .d-popconfirm .d-button-primary');" +
          "if(dialog)dialog.click();" +
        "})()"
      );
      await page.waitForTimeout(500);
    }

    if (!clickedOk) {
      // 最后 dump 一下宿主属性，便于排查
      const attrDump = await page.evaluate(
        "(function(){" +
          "var h=document.querySelector('xhs-publish-btn');" +
          "if(!h)return 'host-gone';" +
          "var o={};for(var i=0;i<h.attributes.length;i++){o[h.attributes[i].name]=h.attributes[i].value;}return o;" +
        "})()"
      );
      console.warn("[xhs] 5 次点击后宿主仍在，属性:", JSON.stringify(attrDump));
      throw new Error(`未能成功点击「${targetText}」按钮`);
    }

    console.log(isDraftMode ? "✅ 小红书视频已保存草稿" : "✅ 小红书视频上传成功");
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
    maybeClosePublishWindow(data, window);
    console.error("❌ 小红书发布失败:", err);
  }
}
