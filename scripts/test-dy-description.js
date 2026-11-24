"use strict";

/**
 * 验证抖音简介填写逻辑（2026-11-01 用户反馈：Windows 下简介无限叠加）：
 * 1. fillDyDescription：keyboard.type 正常落地 → 直接成功，不走兜底
 * 2. Windows 场景回归：execCommand("delete") 静默失效（文档无焦点 no-op）→
 *    键盘全选（Ctrl/Cmd+A + Backspace）兜底清空，新简介不与旧草稿叠加
 * 3. type 不落地 → execCommand('insertText') 兜底成功
 * 4. 全部失败 → 尝试 maxAttempts 次后抛错中止（不再静默发出叠加/空简介作品）
 * 5. 编辑器缺失 → waitForSelector 抛错
 * 6. description 为空：只清空不写入也不报错
 * 7. ks 创作声明新旧文案兼容：「内容为AI生成」仍解析为 ai_generated，「含AI生成内容」为现行文案
 * 8. 假清空回归（Slate state 残留）：绝不允许「旧+新」/「新+新」叠加成双
 * 9. looksLikeDoubledLanding：叠加成双检测
 * 10. fiber 不可得：verifyDyEditorEmpty 双视图判定 + 端到端不无限失败、不叠加
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const outfile = path.join(outDir, "dyDescription.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/upLoad/dy.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  external: ["electron"],
});

const {
  fillDyDescription,
  DY_EDITOR_SELECTOR,
  checkDescriptionOnce,
  looksLikeDoubledLanding,
  verifyDyEditorEmpty,
  hardClearDyEditor,
} = require(outfile);

// 创作声明新旧文案兼容（shared 模块单独打包）
const csOutfile = path.join(outDir, "creativeStatement.cjs");
buildSync({
  entryPoints: [path.join(root, "src/shared/creativeStatement.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: csOutfile,
  external: ["electron"],
});
const { normalizeCreativeStatement, resolveKsCreativeStatementLabel } = require(csOutfile);

// ---------- 7. 快手声明文案兼容 ----------
assert.strictEqual(
  normalizeCreativeStatement("含AI生成内容"),
  "ai_generated",
  "快手现行文案「含AI生成内容」应解析为 ai_generated"
);
assert.strictEqual(
  normalizeCreativeStatement("内容为AI生成"),
  "ai_generated",
  "快手旧文案「内容为AI生成」应解析为 ai_generated（历史别名）"
);
assert.strictEqual(
  resolveKsCreativeStatementLabel("ai_generated"),
  "含AI生成内容",
  "ai_generated 在快手应输出现行文案「含AI生成内容」"
);

// ---------- 假 page：模拟抖音简介编辑器（contenteditable） ----------
function createFakePage({
  typeLands = true,
  execCommandDeleteWorks = true,
  execCommandLands = true,
  editorPresent = true,
  restoredDraft = "",
  // Slate fiber 模拟：
  //   undefined = 默认提供，且随 DOM 同步（绝大多数用例）
  //   null      = 拿不到 fiber（Windows 部分机器），验证「未验证清空」分支
  //   { staleText: true } = DOM 已空但 Slate state 仍是旧值（假清空回归场景）
  slateBehavior = undefined,
} = {}) {
  const editor = {
    text: restoredDraft,
    // Slate 内部 state（与 DOM 的 editor.text 分离，可故意不同步）
    slateText: restoredDraft,
    slateExtra: [],
    get textContent() {
      return this.text;
    },
    // dySlateOp / forceOverwriteClear 用 DOM 元素方法定位内层 contenteditable；
    // mock 里 editor 自身就是 contenteditable 节点
    matches: (s) => s === '[contenteditable="true"]',
    querySelector: () => null,
    focus() {},
  };
  const calls = { typeCount: 0, execCommands: [], keyPresses: [] };
  const kbd = { mod: null, selectedAll: false };
  // 键盘全选+Backspace 只删 DOM、Slate state 不动 —— 这正是线上假清空的成因。
  // staleText 显式模拟；null（拿不到 fiber 的 Windows 机器）同类机器同样命中。
  const keyboardClearLeavesStale =
    Boolean(slateBehavior && slateBehavior.staleText) || slateBehavior === null;
  // Slate 以内部 state 为准：输入经 Slate 管线写入 state，再重渲染 DOM。
  // DOM 被「假清空」后与 state 不一致，下一次输入会把旧 state 渲染回来 → 叠加成双。
  const slateRender = () => {
    editor.text = editor.slateText;
  };
  const slateType = (t) => {
    editor.slateText += t;
    slateRender();
  };
  const slateClear = () => {
    editor.slateText = "";
    editor.slateExtra = [];
    editor.text = "";
  };
  const fakeWindow = {
    getSelection: () => ({
      selectAllChildren: () => {},
      removeAllRanges: () => {},
      addRange: () => {},
    }),
  };
  const fakeDocument = {
    querySelector: (sel) =>
      editorPresent && sel === DY_EDITOR_SELECTOR ? editor : null,
    createRange: () => ({}),
    execCommand: (cmd, _a, text) => {
      calls.execCommands.push(cmd);
      if (cmd === "delete") {
        // Windows 后台窗口场景：execCommand 依赖文档焦点，静默 no-op；
        // 生效时走 Slate 编辑管线，state 与 DOM 一起清
        if (!execCommandDeleteWorks) return false;
        slateClear();
        return true;
      }
      if (cmd === "selectAll") {
        return true;
      }
      if (cmd === "insertText") {
        if (!execCommandLands) return false;
        editor.slateText = String(text || "");
        editor.slateExtra = [];
        slateRender();
        return true;
      }
      return false;
    },
  };
  // React fiber：挂在 editor 上，供 readDySlateState / dySlateOp 向上遍历命中。
  // 注意必须可枚举（真实 React fiber 就是普通可枚举属性），否则 Object.keys 找不到。
  // memoizedProps.text/textExtra 用 getter 反映「当前」state；onChange 真实生效。
  if (slateBehavior !== null) {
    editor.__reactFiber$fake = {
      memoizedProps: {},
      return: {
        memoizedProps: {
          get text() {
            return editor.slateText;
          },
          get textExtra() {
            return editor.slateExtra;
          },
          onChange: (...args) => {
            if (args[0] && typeof args[0] === "object") {
              // onChange({text, textExtra})
              editor.slateText = String(args[0].text ?? "");
              editor.slateExtra = Array.isArray(args[0].textExtra)
                ? args[0].textExtra
                : [];
            } else {
              // onChange("") / onChange("", [])
              editor.slateText = String(args[0] ?? "");
              editor.slateExtra =
                args.length > 1 && Array.isArray(args[1]) ? args[1] : [];
            }
            slateRender();
          },
        },
        return: null,
      },
    };
  }
  const page = {
    keyboard: {
      type: async (t) => {
        calls.typeCount += 1;
        if (typeLands) slateType(t);
      },
      down: async (key) => {
        kbd.mod = key;
      },
      up: async () => {
        kbd.mod = null;
      },
      press: async (key) => {
        calls.keyPresses.push(key);
        if (key === "a" && kbd.mod) kbd.selectedAll = true;
        if (key === "Backspace") {
          if (kbd.selectedAll) {
            kbd.selectedAll = false;
            if (keyboardClearLeavesStale) {
              editor.text = ""; // 假清空：只删 DOM，Slate state 保留旧值
            } else {
              slateClear();
            }
          }
        }
      },
    },
    async waitForTimeout() {},
    async click(sel) {
      if (sel === DY_EDITOR_SELECTOR && !editorPresent)
        throw new Error("no such element");
      calls.clickCount = (calls.clickCount || 0) + 1;
    },
    async focus(sel) {
      if (sel === DY_EDITOR_SELECTOR && !editorPresent)
        throw new Error("no such element");
    },
    async waitForSelector(sel) {
      if (editorPresent && sel === DY_EDITOR_SELECTOR) return editor;
      throw new Error(`waiting failed: timeout`);
    },
    async evaluate(fn, arg) {
      const f = new Function(
        "document",
        "window",
        "arg",
        `return (${fn.toString()})(arg);`
      );
      return f(fakeDocument, fakeWindow, arg);
    },
  };
  return { page, editor, calls };
}

(async () => {
  const DESC = "这是新简介 #标签A #标签B";

  // 1. 正常落地：type 写入成功，无需 insertText 兜底
  {
    const { page, editor, calls } = createFakePage({ typeLands: true });
    await fillDyDescription(page, DESC, false);
    assert.strictEqual(editor.text, DESC);
    assert.ok(!calls.execCommands.includes("insertText"), "正常落地不应走 insertText 兜底");
  }

  // 2. Windows 场景回归：execCommand delete 静默失效 → 键盘全选兜底清空，无叠加
  {
    const { page, editor } = createFakePage({
      typeLands: true,
      execCommandDeleteWorks: false,
      restoredDraft: "上次的旧简介 #旧标签",
    });
    await fillDyDescription(page, DESC, false);
    assert.strictEqual(
      editor.text,
      DESC,
      "旧草稿必须被键盘全选兜底清掉，不能与新简介叠加"
    );
    assert.ok(!editor.text.includes("旧简介"), "旧内容不得残留");
  }

  // 3. type 不落地 → insertText 兜底成功
  {
    const { page, editor, calls } = createFakePage({ typeLands: false });
    await fillDyDescription(page, DESC, false);
    assert.strictEqual(editor.text, DESC);
    assert.ok(calls.execCommands.includes("insertText"), "应调用 insertText 兜底");
  }

  // 4. 全部失败 → maxAttempts 次后抛错中止
  {
    const { page } = createFakePage({
      typeLands: false,
      execCommandLands: false,
      execCommandDeleteWorks: false,
    });
    await assert.rejects(
      () => fillDyDescription(page, DESC, false, { maxAttempts: 2 }),
      (e) => /抖音简介填写失败/.test(e.message) && /已中止/.test(e.message)
    );
  }

  // 5. 编辑器不存在 → waitForSelector 抛错
  {
    const { page } = createFakePage({ editorPresent: false });
    await assert.rejects(() => fillDyDescription(page, DESC, false), /timeout/);
  }

  // 6. description 为空：只清空不写入也不报错
  {
    const { page, editor, calls } = createFakePage({
      restoredDraft: "旧内容",
    });
    await fillDyDescription(page, "", false);
    assert.strictEqual(editor.text, "", "空简介也应清掉旧内容");
    assert.strictEqual(calls.typeCount, 0, "空简介不应触发键盘输入");
  }

  // ---------- 8. checkDescriptionOnce：话题胶囊改写场景 ----------
  // 注：前 12 字用纯文本（无 #），让话题 # 落在 suffix 窗口，才是胶囊改写的真实命中路径。

  // 8a. 话题 # 被胶囊吃掉后仍判定成功（landed 里 # 消失）
  {
    const expected = "这是一段较长的简介文案用来测试话题胶囊场景 #标签A #标签B";
    // 抖音胶囊化后 # 消失
    const landed = "这是一段较长的简介文案用来测试话题胶囊场景 标签A 标签B";
    assert.ok(
      checkDescriptionOnce(landed, expected),
      "话题胶囊去掉 # 后仍应判定为成功"
    );
  }

  // 8b. 胶囊导致空格从一个变成两个，仍判定成功
  {
    const expected = "这是一段较长的简介文案用来测试话题胶囊场景 #标签A #标签B";
    const landed = "这是一段较长的简介文案用来测试话题胶囊场景  标签A  标签B";
    assert.ok(
      checkDescriptionOnce(landed, expected),
      "胶囊导致的空格变化仍应判定为成功"
    );
  }

  // 8c. 真实的残留叠加（前残留 + 本次文案）仍判定失败
  {
    const expected = "这是一段较长的简介文案用来测试话题胶囊场景 #标签A #标签B";
    // 旧草稿残留在前面
    const landed = "上次旧草稿内容这是一段较长的简介文案用来测试话题胶囊场景 #标签A #标签B";
    assert.ok(
      !checkDescriptionOnce(landed, expected),
      "前残留叠加仍应判定为失败"
    );
  }

  // 8d. 只写了一半仍判定失败
  {
    const expected = "这是一段较长的简介文案用来测试话题胶囊场景 #标签A #标签B";
    const landed = "这是一段较长的简介";
    assert.ok(
      !checkDescriptionOnce(landed, expected),
      "只写一半仍应判定为失败"
    );
  }

  // 8e. 话题 # 落在前 12 字窗口内：prefix 锚点同样必须容忍胶囊改写
  // （slice(0,12) 可能正好切到「#标签」，胶囊吃掉 # 后 startsWith 在原始文本上必然失败）
  {
    const expected = "#标签A 这是一段较长的简介文案用来测试前段话题场景";
    const landed = "标签A 这是一段较长的简介文案用来测试前段话题场景";
    assert.ok(
      checkDescriptionOnce(landed, expected),
      "前 12 字内含话题胶囊时仍应判定为成功"
    );
  }

  // 8f. 前段话题胶囊场景下，前残留叠加仍必须拦（归一不能变成什么都放行）
  {
    const expected = "#标签A 这是一段较长的简介文案用来测试前段话题场景";
    const landed = "旧残留内容标签A 这是一段较长的简介文案用来测试前段话题场景";
    assert.ok(
      !checkDescriptionOnce(landed, expected),
      "前段话题胶囊场景下前残留叠加仍应判定为失败"
    );
  }

  // 8g. 前段话题胶囊场景下，同文案叠加成双仍必须拦
  {
    const expected = "#标签A 这是一段较长的简介文案用来测试前段话题场景";
    const landed =
      "标签A 这是一段较长的简介文案用来测试前段话题场景标签A 这是一段较长的简介文案用来测试前段话题场景";
    assert.ok(
      !checkDescriptionOnce(landed, expected),
      "前段话题胶囊场景下同文案叠加成双仍应判定为失败"
    );
  }

  // ---------- 9. 假清空回归：Slate state 残留时绝不允许叠加成双 ----------
  {
    const { page, editor } = createFakePage({
      slateBehavior: { staleText: true },
      restoredDraft: "旧简介内容",
    });
    await fillDyDescription(page, "新简介", false);
    assert.strictEqual(
      editor.text,
      "新简介",
      "假清空场景下最终必须只写入新简介"
    );
    assert.ok(!editor.text.includes("旧简介"), "旧内容不得残留");
    assert.ok(
      !looksLikeDoubledLanding(editor.text, "新简介"),
      "绝不允许出现「旧+新」或「新+新」的双份"
    );
  }

  // ---------- 10. looksLikeDoubledLanding：叠加成双检测 ----------
  {
    assert.strictEqual(
      looksLikeDoubledLanding("新简介新简介", "新简介"),
      true,
      "同文案连续出现两次应判定为叠加成双"
    );
    assert.strictEqual(
      looksLikeDoubledLanding("新简介", "新简介"),
      false,
      "恰好等于期望文案不是叠加"
    );
    assert.strictEqual(
      looksLikeDoubledLanding("完全不同的内容", "新简介"),
      false,
      "完全不同的内容不是叠加"
    );
  }

  // ---------- 11. fiber 不可得：双视图判定 + 不无限失败、不叠加 ----------
  // 11a. DOM 空但拿不到 Slate fiber → cleared:true / verified:false
  {
    const { page, editor } = createFakePage({
      slateBehavior: null,
      restoredDraft: "旧内容",
    });
    editor.text = "";
    const r = await verifyDyEditorEmpty(page);
    assert.strictEqual(r.cleared, true, "DOM 空应判定 cleared:true");
    assert.strictEqual(
      r.verified,
      false,
      "拿不到 fiber 时不得宣称 verified:true"
    );
  }
  // 11b. DOM 空但 Slate state 残留（假清空）→ 不得判定 cleared
  {
    const { page, editor } = createFakePage({
      slateBehavior: { staleText: true },
      restoredDraft: "旧内容",
    });
    editor.text = ""; // 键盘全选只清 DOM
    const r = await verifyDyEditorEmpty(page);
    assert.strictEqual(
      r.cleared,
      false,
      "Slate state 仍残留旧值时必须判未清空（假清空拦截）"
    );
  }
  // 11c. 双视图都空 → cleared:true / verified:true
  {
    const { page, editor } = createFakePage({});
    editor.text = "";
    editor.slateText = "";
    editor.slateExtra = [];
    assert.deepStrictEqual(
      await verifyDyEditorEmpty(page),
      { cleared: true, verified: true }
    );
  }
  // 11d. 端到端：拿不到 fiber 时不得无限失败，也不得叠加成双
  {
    const { page, editor } = createFakePage({
      slateBehavior: null,
      restoredDraft: "旧简介内容",
    });
    await fillDyDescription(page, DESC, false);
    assert.strictEqual(
      editor.text,
      DESC,
      "fiber 不可得的机器也必须能正常写入新简介"
    );
    assert.ok(!editor.text.includes("旧简介"), "旧内容不得残留");
  }

  // ---------- 12. hardClearDyEditor：发布前硬清空 ----------
  // 抖音创作页同分区会恢复上次未提交的简介；清不干净时输入新文案会叠加成双。
  // 12a. 页面预置「双份残留」→ 硬清空后必须为空
  {
    const { page, editor } = createFakePage({
      restoredDraft: "11月20日三国志水友赛11月20日三国志水友赛",
    });
    const r = await hardClearDyEditor(page);
    assert.strictEqual(r.cleared, true, "双份残留必须能被硬清空");
    assert.strictEqual(editor.text, "", "硬清空后 DOM 必须为空");
  }

  // 12b. 硬清空后写入单份文案 → 不得是双份
  {
    const { page, editor } = createFakePage({
      restoredDraft: "11月20日三国志水友赛11月20日三国志水友赛",
    });
    await hardClearDyEditor(page);
    await fillDyDescription(page, "11月20日三国志水友赛", false);
    assert.strictEqual(
      editor.text,
      "11月20日三国志水友赛",
      "硬清空后必须只写入单份，不能是双份"
    );
    assert.ok(
      !looksLikeDoubledLanding(editor.text, "11月20日三国志水友赛"),
      "结果不得叠加成双"
    );
  }

  // 12c. Slate state 残留（DOM 已空但 Slate 仍有旧值）→ 硬清空必须把 Slate 也清掉
  {
    const { page, editor } = createFakePage({
      restoredDraft: "旧简介",
      slateBehavior: { staleText: true },
    });
    // 先把 DOM 清掉但让 Slate 保留旧值：模拟键盘全选只删 DOM 的假清空
    editor.text = "";
    const r = await hardClearDyEditor(page);
    assert.strictEqual(r.cleared, true, "Slate 残留也必须能被硬清空");
  }

  // 12d. 清不干净时必须返回 cleared:false（调用方据此中止发布）
  {
    const { page, editor } = createFakePage({
      restoredDraft: "顽固内容",
      execCommandDeleteWorks: false,
      typeLands: false,
    });
    // 让所有清空手法都失效：DOM 始终不变
    const frozen = "顽固内容";
    Object.defineProperty(editor, "text", {
      get: () => frozen,
      set: () => {},
      configurable: true,
    });
    const r = await hardClearDyEditor(page, { maxRounds: 1 });
    assert.strictEqual(
      r.cleared,
      false,
      "清不干净时必须返回 cleared:false，让调用方中止发布而不是发出双份"
    );
  }

  console.log("dy-description: 全部断言通过");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
