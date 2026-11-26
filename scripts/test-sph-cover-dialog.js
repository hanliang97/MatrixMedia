"use strict";

/**
 * 验证视频号封面编辑弹窗匹配与 DOM 操作逻辑（复现横屏 / 4:3 视频「编辑个人主页卡片」卡死问题）：
 * 1. 竖屏单槽位「编辑封面」与横屏双槽位「编辑个人主页卡片」「编辑分享卡片」「裁剪封面」均可识别
 * 2. 文案改版兜底：包含「从视频中选择封面」或「上传封面 + 效果预览/个人主页/平铺展示」也可命中
 * 3. 绝不误命中无关弹窗（声明原创、将此次编辑保留、从橱窗添加商品、添加短剧等）
 * 4. 沿祖先链校验可见性：祖先 .weui-desktop-dialog__wrp display:none 的残留模板不会误判为可见
 * 5. 嵌套裁剪弹窗叠加在「编辑个人主页卡片」之上时，优先命中并确认顶层弹窗，并在顶层关闭后可继续确认外层弹窗
 * 6. 定位 file input 时优先命中当前顶层可见封面弹窗内的 input，不误拿隐藏模板里的旧 input
 * 7. 封面槽位 src 读取支持 .cover-img-vertical 及 .vertical-cover-wrap img 兜底
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "sphCoverDialog.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/upLoad/sphCoverDialog.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const {
  SPH_COVER_DIALOG_MATCH_CONFIG,
  isSphCoverDialogText,
  pickTopmostSphCoverDialog,
  readSphVerticalCoverSrcInPage,
  openSphCoverSlotInPage,
  hasVisibleSphCoverDialogInPage,
  listVisibleSphDialogsInPage,
  clickSphCoverUploadTriggerInPage,
  findSphCoverFileInputInPage,
  confirmSphCoverDialogInPage,
  readSphCoverAfterStateInPage,
} = require(bundle);

/* 1) 纯文本匹配断言 */
assert.strictEqual(
  isSphCoverDialogText("编辑封面 从视频中选择封面 上传封面 取消 确认"),
  true,
  "竖屏视频「编辑封面」弹窗应命中"
);
assert.strictEqual(
  isSphCoverDialogText(
    "编辑个人主页卡片 将会用在视频号个人主页 平铺展示 从视频中选择封面 上传封面 效果预览 取消 确认"
  ),
  true,
  "横屏 / 4:3 视频「编辑个人主页卡片」弹窗应命中（复现今日卡死场景）"
);
assert.strictEqual(
  isSphCoverDialogText("编辑分享卡片 将会用在分享卡片 从视频中选择封面 上传封面 取消 确认"),
  true,
  "横屏视频「编辑分享卡片」弹窗应命中"
);
assert.strictEqual(
  isSphCoverDialogText("裁剪封面 取消 确定"),
  true,
  "裁剪子弹窗应命中"
);
assert.strictEqual(
  isSphCoverDialogText("封面设置 上传封面 效果预览 取消 确认"),
  true,
  "标题改版但含「上传封面 + 效果预览」应兜底命中"
);
assert.strictEqual(
  isSphCoverDialogText("将此次编辑保留？ 取消 不保留 保留"),
  false,
  "留存草稿确认框绝不能误命中"
);
assert.strictEqual(
  isSphCoverDialogText("声明原创 我已阅读并同意原创声明协议 取消 声明原创"),
  false,
  "声明原创弹窗绝不能误命中"
);
assert.strictEqual(
  isSphCoverDialogText("从橱窗添加商品 搜索商品 取消 确认"),
  false,
  "商品挂载弹窗绝不能误命中"
);
assert.strictEqual(isSphCoverDialogText(""), false);

/* 2) 顶层弹窗选择断言 */
{
  const picked = pickTopmostSphCoverDialog([
    { id: "stale", visible: false, text: "编辑封面 上传封面" },
    { id: "base", visible: true, text: "编辑个人主页卡片 将会用在视频号个人主页 上传封面" },
    { id: "crop", visible: true, text: "裁剪封面 确认" },
  ]);
  assert.strictEqual(picked.count, 2);
  assert.strictEqual(picked.dialog.id, "crop", "叠加弹窗时应优先命中顶层弹窗");
}

/* 3) 构造极简影子树 DOM，直接运行浏览器端序列化函数验证（确保完全自包含） */
function makeNode({
  tag = "div",
  classes = [],
  attrs = {},
  text = "",
  rect = { width: 600, height: 500 },
  style = { display: "block", visibility: "visible" },
  children = [],
  parentElement = null,
  disabled = false,
  src = "",
  accept = "",
  onClick = null,
} = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    classList: {
      contains: (c) => classes.includes(c),
    },
    _classes: classes,
    _attrs: attrs,
    _style: style,
    _rect: rect,
    disabled,
    src,
    accept,
    parentElement,
    children: [],
    clicked: 0,
    scrolled: false,
    get textContent() {
      if (this.children.length === 0) return text;
      return text + this.children.map((c) => c.textContent).join(" ");
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this._attrs, k)
        ? this._attrs[k]
        : null;
    },
    getBoundingClientRect() {
      return this._rect;
    },
    scrollIntoView() {
      this.scrolled = true;
    },
    click() {
      this.clicked += 1;
      if (typeof onClick === "function") onClick(this);
    },
    _matches(sel) {
      return sel.split(",").some((part) => {
        const s = part.trim();
        if (s === "*") return true;
        if (s === 'input[type="file"]') {
          return this.tagName === "INPUT" && this._attrs.type === "file";
        }
        if (s === "button") return this.tagName === "BUTTON";
        if (s === "[role='button']") return this._attrs.role === "button";
        if (s.startsWith(".")) {
          return this._classes.includes(s.slice(1));
        }
        if (/^[a-z]+$/i.test(s)) {
          return this.tagName === s.toUpperCase();
        }
        return false;
      });
    },
    _descendants() {
      const list = [];
      const walk = (n) => {
        for (const ch of n.children) {
          list.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return list;
    },
    querySelectorAll(sel) {
      const desc = this._descendants();
      if (sel.includes(" ") && !sel.includes(",")) {
        const parts = sel.trim().split(/\s+/);
        if (parts.length === 2) {
          const out = [];
          for (const container of desc) {
            if (!container._matches(parts[0])) continue;
            for (const sub of container._descendants()) {
              if (sub._matches(parts[1]) && !out.includes(sub)) out.push(sub);
            }
          }
          return out;
        }
      }
      return desc.filter((n) => n._matches(sel));
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
  };
  for (const ch of children) {
    ch.parentElement = node;
    node.children.push(ch);
  }
  return node;
}

function runSerialized(fn, ...args) {
  // 模拟 Puppeteer 将函数源码序列化后在新函数作用域执行的隔离性（禁止闭包引用模块变量）
  const revived = new Function(`return (${fn.toString()})`)();
  return revived(...args);
}

function withMockShadowDom(shadowRoot, runner) {
  const prevDoc = global.document;
  const prevGetComputedStyle = global.getComputedStyle;
  global.document = {
    querySelector(sel) {
      if (sel === "wujie-app.wujie_iframe") return { shadowRoot };
      return null;
    },
  };
  global.getComputedStyle = (el) =>
    (el && el._style) || { display: "block", visibility: "visible" };
  try {
    return runner();
  } finally {
    global.document = prevDoc;
    global.getComputedStyle = prevGetComputedStyle;
  }
}

/* 4) 端到端模拟横屏视频「编辑个人主页卡片」+ 隐藏旧模板 + 嵌套裁剪弹窗流程 */
{
  const staleInput = makeNode({
    tag: "input",
    attrs: { type: "file" },
    accept: "image/jpeg,image/png",
    rect: { width: 0, height: 0 },
  });
  const staleDialog = makeNode({
    classes: ["weui-desktop-dialog"],
    text: "编辑封面 上传封面 确认",
    children: [
      makeNode({ classes: ["single-cover-uploader-wrap"], children: [staleInput] }),
    ],
  });
  const staleWrapper = makeNode({
    classes: ["weui-desktop-dialog__wrp"],
    style: { display: "none", visibility: "visible" },
    children: [staleDialog],
  });

  const activeInput = makeNode({
    tag: "input",
    attrs: { type: "file" },
    accept: "image/jpeg,image/jpg,image/png",
    rect: { width: 0, height: 0 },
  });
  const uploadBtn = makeNode({
    tag: "div",
    text: "上传封面",
    rect: { width: 80, height: 80 },
  });
  const cancelBtn = makeNode({
    tag: "button",
    classes: ["weui-desktop-btn"],
    text: "取消",
    rect: { width: 96, height: 36 },
  });
  const confirmBtn = makeNode({
    tag: "button",
    classes: ["weui-desktop-btn", "weui-desktop-btn_primary"],
    text: "确认",
    rect: { width: 96, height: 36 },
  });
  const activeDialog = makeNode({
    classes: ["weui-desktop-dialog"],
    text: "编辑个人主页卡片 将会用在视频号个人主页 平铺展示 从视频中选择封面 效果预览",
    children: [
      uploadBtn,
      makeNode({ classes: ["single-cover-uploader-wrap"], children: [activeInput] }),
      cancelBtn,
      confirmBtn,
    ],
  });
  const activeWrapper = makeNode({
    classes: ["weui-desktop-dialog__wrp"],
    style: { display: "none", visibility: "visible" },
    children: [activeDialog],
  });

  const cropConfirmBtn = makeNode({
    tag: "button",
    classes: ["weui-desktop-btn", "weui-desktop-btn_primary"],
    text: "确定",
    rect: { width: 96, height: 36 },
  });
  const cropDialog = makeNode({
    classes: ["weui-desktop-dialog"],
    text: "裁剪封面",
    children: [cropConfirmBtn],
  });
  const cropWrapper = makeNode({
    classes: ["weui-desktop-dialog__wrp"],
    style: { display: "none", visibility: "visible" },
    children: [cropDialog],
  });

  const slotImg = makeNode({
    tag: "img",
    src: "blob:https://channels.weixin.qq.com/initial-frame",
    rect: { width: 108, height: 144 },
  });
  const verticalSlot = makeNode({
    classes: ["vertical-cover-wrap"],
    children: [slotImg],
    onClick: () => {
      activeWrapper._style.display = "block";
    },
  });

  const shadowRoot = makeNode({
    children: [verticalSlot, staleWrapper, activeWrapper, cropWrapper],
  });

  withMockShadowDom(shadowRoot, () => {
    // 初始未打开弹窗：残留隐藏模板不能被误判为可见
    assert.strictEqual(
      runSerialized(hasVisibleSphCoverDialogInPage, SPH_COVER_DIALOG_MATCH_CONFIG),
      false,
      "祖先 display:none 的残留编辑封面模板不应被判为可见"
    );
    assert.strictEqual(
      runSerialized(readSphVerticalCoverSrcInPage),
      "blob:https://channels.weixin.qq.com/initial-frame",
      "无 .cover-img-vertical 类名时应兜底读取 .vertical-cover-wrap img src"
    );

    // 点击 3:4 槽位打开「编辑个人主页卡片」
    assert.strictEqual(runSerialized(openSphCoverSlotInPage), true);
    assert.strictEqual(verticalSlot.scrolled, true);
    assert.strictEqual(
      runSerialized(hasVisibleSphCoverDialogInPage, SPH_COVER_DIALOG_MATCH_CONFIG),
      true,
      "打开「编辑个人主页卡片」弹窗后必须立刻识别为可见封面弹窗"
    );
    assert.deepStrictEqual(runSerialized(listVisibleSphDialogsInPage).length, 1);

    // 点击「上传封面」
    const triggerRes = runSerialized(
      clickSphCoverUploadTriggerInPage,
      SPH_COVER_DIALOG_MATCH_CONFIG
    );
    assert.strictEqual(triggerRes.ok, true);
    assert.strictEqual(triggerRes.mode, "clicked");
    assert.strictEqual(uploadBtn.clicked, 1);

    // 定位 file input：必须命中活动弹窗的 activeInput，而不是前面隐藏模板的 staleInput
    const pickedInput = runSerialized(
      findSphCoverFileInputInPage,
      SPH_COVER_DIALOG_MATCH_CONFIG
    );
    assert.strictEqual(
      pickedInput,
      activeInput,
      "应优先返回当前可见封面弹窗内的 file input，绝不误拿隐藏模板的旧 input"
    );

    // 模拟选图后上方弹出嵌套「裁剪封面」子弹窗
    cropWrapper._style.display = "block";
    const firstConfirm = runSerialized(
      confirmSphCoverDialogInPage,
      SPH_COVER_DIALOG_MATCH_CONFIG
    );
    assert.strictEqual(firstConfirm.ok, true);
    assert.strictEqual(firstConfirm.label, "确定");
    assert.strictEqual(firstConfirm.dialogCount, 2);
    assert.strictEqual(cropConfirmBtn.clicked, 1);
    assert.strictEqual(confirmBtn.clicked, 0);

    // 裁剪弹窗关闭，外层「编辑个人主页卡片」仍在，此时二次确认命中外层「确认」
    cropWrapper._style.display = "none";
    const midState = runSerialized(
      readSphCoverAfterStateInPage,
      SPH_COVER_DIALOG_MATCH_CONFIG
    );
    assert.strictEqual(midState.dialogOpen, true);
    assert.strictEqual(midState.dialogCount, 1);

    const secondConfirm = runSerialized(
      confirmSphCoverDialogInPage,
      SPH_COVER_DIALOG_MATCH_CONFIG
    );
    assert.strictEqual(secondConfirm.ok, true);
    assert.strictEqual(secondConfirm.label, "确认");
    assert.strictEqual(confirmBtn.clicked, 1);

    // 外层关闭且槽位 src 变为微信 CDN
    activeWrapper._style.display = "none";
    slotImg.src = "https://finder.video.qq.com/251/20304/stodownload?custom=1";
    const finalState = runSerialized(
      readSphCoverAfterStateInPage,
      SPH_COVER_DIALOG_MATCH_CONFIG
    );
    assert.strictEqual(finalState.dialogOpen, false);
    assert.ok(finalState.src.includes("finder.video.qq.com"));
  });
}

console.log("test-sph-cover-dialog: 全部断言通过");
