"use strict";

/**
 * 评论模块专用嗅探 preload（增强版，独立于 dataStats/preloadSource.js）：
 * - hook window.fetch 与 XMLHttpRequest；
 * - 除响应 JSON 外，额外记录请求 method 与请求体（参数探明用，截断 600 字符）；
 * - XHR responseType 为 ""/text/json 都能捕获（视频号互动页疑似用 json 型）。
 * 条目形状：{ url, method, body, json }，上限 600 条（滚动窗口）。
 */
const PRELOAD_SOURCE_COMMENTS = `
(function () {
  var store = [];
  try {
    Object.defineProperty(window, "__mmSniffed", {
      value: store,
      writable: false,
      configurable: false,
    });
  } catch (e) {
    window.__mmSniffed = store;
  }

  function push(url, method, body, text) {
    try {
      store.push({
        url: String(url),
        method: String(method || "GET"),
        body: body ? String(body).slice(0, 600) : "",
        json: JSON.parse(text),
      });
      if (store.length > 600) store.splice(0, store.length - 600);
    } catch (e) {
      /* 非 JSON 响应忽略 */
    }
  }

  var ofetch = window.fetch;
  if (typeof ofetch === "function") {
    window.fetch = async function () {
      var args = arguments;
      var res = await ofetch.apply(this, args);
      try {
        var a0 = args[0];
        var url = String((a0 && a0.url) || a0);
        var method = (args[1] && args[1].method) || (a0 && a0.method) || "GET";
        var body = (args[1] && args[1].body) || (a0 && a0.body) || "";
        if (body && typeof body !== "string") {
          try { body = JSON.stringify(body); } catch (e) { body = String(body); }
        }
        var clone = res.clone();
        clone.text().then(function (t) { push(url, method, body, t); }).catch(function () {});
      } catch (e) {
        /* ignore */
      }
      return res;
    };
  }

  var oOpen = XMLHttpRequest.prototype.open;
  var oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mmMethod = method;
    this.__mmUrl = url;
    var rest = Array.prototype.slice.call(arguments, 2);
    this.addEventListener("load", function () {
      try {
        var rt = this.responseType;
        if (rt === "" || rt === "text") {
          push(this.__mmUrl, this.__mmMethod, this.__mmBody, this.responseText);
        } else if (rt === "json") {
          push(this.__mmUrl, this.__mmMethod, this.__mmBody, JSON.stringify(this.response));
        }
      } catch (e) {
        /* ignore */
      }
    });
    return oOpen.apply(this, [method, url].concat(rest));
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      this.__mmBody = body ? (typeof body === "string" ? body : JSON.stringify(body)) : "";
    } catch (e) {
      this.__mmBody = "";
    }
    return oSend.apply(this, arguments);
  };
})();
`;

module.exports = { PRELOAD_SOURCE_COMMENTS };
