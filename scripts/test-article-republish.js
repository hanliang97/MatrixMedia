require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  buildArticleRepublishState,
  parseArticleTags,
} = require("../src/renderer/utils/articleRepublish");

const state = buildArticleRepublishState({
  bt: "历史文章标题",
  content: "# 正文",
  articleFilePath: "/tmp/post.md",
  coverPath: "/tmp/cover.png",
  category: "后端",
  bq: "前端 electron",
  summary: "摘要",
});

assert.deepStrictEqual(parseArticleTags("前端 electron"), ["前端", "electron"]);
assert.strictEqual(state.form.title, "历史文章标题");
assert.strictEqual(state.form.content, "# 正文");
assert.strictEqual(state.articleFilePath, "/tmp/post.md");
assert.strictEqual(state.coverPath, "/tmp/cover.png");
assert.strictEqual(state.form.category, "后端");
assert.deepStrictEqual(state.tags, ["前端", "electron"]);
assert.strictEqual(state.form.summary, "摘要");
assert.deepStrictEqual(buildArticleRepublishState({}).tags, ["前端", "electron"]);
assert.strictEqual(buildArticleRepublishState({}).form.category, "前端");

console.log("test-article-republish passed");
