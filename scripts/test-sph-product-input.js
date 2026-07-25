"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  searchProduct,
} = require("../src/main/services/upLoad/sphProduct");

(async () => {
  const actions = [];
  const input = {
    async click(options) {
      actions.push(["input.click", options]);
    },
  };
  const button = {
    async click(options) {
      actions.push(["button.click", options]);
    },
  };
  const dialog = {
    async $(selector) {
      if (selector.includes("请输入商品名称/编码搜索")) return input;
      if (selector === ".search-btn button") return button;
      return null;
    },
  };
  const dialogHandle = {
    asElement() {
      return dialog;
    },
    async dispose() {
      actions.push(["dialog.dispose"]);
    },
  };
  const page = {
    async evaluateHandle() {
      actions.push(["dialog.find"]);
      return dialogHandle;
    },
    keyboard: {
      async down(key) {
        actions.push(["keyboard.down", key]);
      },
      async press(key) {
        actions.push(["keyboard.press", key]);
      },
      async up(key) {
        actions.push(["keyboard.up", key]);
      },
      async type(value, options) {
        actions.push(["keyboard.type", value, options]);
      },
    },
  };

  await searchProduct(page, "10000591263144");

  assert.deepStrictEqual(actions, [
    ["dialog.find"],
    ["input.click", { delay: 80 }],
    ["keyboard.down", "Control"],
    ["keyboard.press", "A"],
    ["keyboard.up", "Control"],
    ["keyboard.press", "Backspace"],
    ["keyboard.type", "10000591263144", { delay: 50 }],
    ["button.click", { delay: 120 }],
    ["dialog.dispose"],
  ]);

  console.log("test-sph-product-input passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
