"use strict";

/**
 * 采集嗅探 preload 的源码（字符串形式内嵌，避免 webpack 打包后文件路径失效）。
 * collector 在采集前将其写入 userData 临时文件，再作为 webPreferences.preload 引用。
 *
 * hook window.fetch 与 XMLHttpRequest，把页面自己发出的请求的 JSON 响应
 * 存入 window.__mmSniffed（签名等由页面自己完成，我们只读响应）。
 */
const PRELOAD_SOURCE = `
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

  function push(url, text) {
    try {
      store.push({ url: String(url), json: JSON.parse(text) });
      if (store.length > 500) store.splice(0, store.length - 500);
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
        var url = String((args[0] && args[0].url) || args[0]);
        var clone = res.clone();
        clone.text().then(function (t) { push(url, t); }).catch(function () {});
      } catch (e) {
        /* ignore */
      }
      return res;
    };
  }

  var oOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var rest = Array.prototype.slice.call(arguments, 2);
    this.addEventListener("load", function () {
      try {
        if (this.responseType === "" || this.responseType === "text") {
          push(url, this.responseText);
        }
      } catch (e) {
        /* ignore */
      }
    });
    return oOpen.apply(this, [method, url].concat(rest));
  };
})();
`;

module.exports = { PRELOAD_SOURCE };
