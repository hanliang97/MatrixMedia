"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  normalizeSphWindowProducts,
} = require("../src/shared/sphWindowProductList");

assert.deepStrictEqual(
  normalizeSphWindowProducts({
    data: {
      productList: [
        { productId: "1001", title: "商品A", imgUrl: "http://a" },
        { product_id: "1002", product_title: "商品B" },
        { productId: "1001", title: "重复" },
        { title: "无ID" },
      ],
    },
  }).map((item) => ({
    productId: item.productId,
    title: item.title,
  })),
  [
    { productId: "1001", title: "商品A" },
    { productId: "1002", title: "商品B" },
  ]
);

assert.deepStrictEqual(
  normalizeSphWindowProducts({
    data: { products: [{ id: "2005", name: "橱窗商品" }] },
  }).map((item) => item.productId),
  ["2005"]
);

console.log("test-sph-window-products passed");
