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

const { fillDyDescription, DY_EDITOR_SELECTOR, checkDescriptionOnce } = require(outfile);

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
} = {}) {
  const editor = {
    text: restoredDraft,
    get textContent() {
      return this.text;
    },
    focus() {},
  };
  const calls = { typeCount: 0, execCommands: [], keyPresses: [] };
  const kbd = { mod: null, selectedAll: false };
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
        // Windows 后台窗口场景：execCommand 依赖文档焦点，静默 no-op
        if (execCommandDeleteWorks) editor.text = "";
        return execCommandDeleteWorks;
      }
      if (cmd === "insertText" && execCommandLands) {
        editor.text = String(text || "");
        return true;
      }
      return false;
    },
  };
  const page = {
    keyboard: {
      type: async (t) => {
        calls.typeCount += 1;
        if (typeLands) editor.text += t;
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
            editor.text = "";
            kbd.selectedAll = false;
          }
        }
      },
    },
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

  console.log("dy-description: 全部断言通过");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
