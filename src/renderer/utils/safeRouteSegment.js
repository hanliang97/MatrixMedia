/**
 * 转义会被 vue-router 3（path-to-regexp）解析为路由/正则语法的特殊字符
 *（如分组名「测试分组(主号)」中的英文括号），且不引入 `%` 序列以免触发
 * vue-router 的 decodeURI 匹配失配。
 */
export function safeRouteSegment(raw) {
  return String(raw || "").replace(
    /[\\()[\]*+?^${}|:/#%]/g,
    (ch) => `_u${ch.charCodeAt(0).toString(16)}_`
  );
}
