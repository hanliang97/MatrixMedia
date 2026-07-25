"use strict";

function pickProductId(item) {
  const candidates = [
    item && item.productId,
    item && item.product_id,
    item && item.outProductId,
    item && item.out_product_id,
    item && item.spuId,
    item && item.spu_id,
    item && item.appid,
    item && item.id,
  ];
  for (const value of candidates) {
    const id = String(value == null ? "" : value).trim();
    if (/^\d+$/.test(id)) return id;
  }
  return "";
}

function pickProductTitle(item) {
  const candidates = [
    item && item.title,
    item && item.productTitle,
    item && item.product_title,
    item && item.name,
    item && item.productName,
    item && item.product_name,
  ];
  for (const value of candidates) {
    const title = String(value == null ? "" : value).trim();
    if (title) return title;
  }
  return "";
}

function pickProductThumb(item) {
  const candidates = [
    item && item.imgUrl,
    item && item.img_url,
    item && item.thumb,
    item && item.cover,
    item && item.headImg,
    item && item.head_img,
  ];
  for (const value of candidates) {
    const url = String(value == null ? "" : value).trim();
    if (url) return url;
  }
  return "";
}

export function normalizeSphWindowProducts(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const lists = [
    data.productList,
    data.products,
    data.list,
    data.windowProducts,
    data.itemList,
    root.productList,
    root.products,
    root.list,
  ];
  let rows = [];
  for (const list of lists) {
    if (Array.isArray(list) && list.length) {
      rows = list;
      break;
    }
  }
  const products = [];
  const seen = new Set();
  for (const item of rows) {
    const productId = pickProductId(item);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    products.push({
      productId,
      title: pickProductTitle(item) || productId,
      thumb: pickProductThumb(item),
      raw: item,
    });
  }
  return products;
}
