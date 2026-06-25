/**
 * 分组排序：底层仍用 phone 字段，UI 展示为「分组」
 */

export function normalizeGroupOrder(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function compareGroups(aKey, aOrder, bKey, bOrder) {
  const ao = normalizeGroupOrder(aOrder);
  const bo = normalizeGroupOrder(bOrder);
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if (ao != null && bo == null) return -1;
  if (ao == null && bo != null) return 1;
  return String(aKey).localeCompare(String(bKey));
}

/** 从 account 原始数据提取每个分组的 groupOrder（取该分组下任意一条记录） */
export function buildGroupOrderMap(rawAccountData) {
  const map = {};
  if (!rawAccountData || typeof rawAccountData !== "object") return map;
  for (const dateKey of Object.keys(rawAccountData)) {
    const list = rawAccountData[dateKey];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const phone = item && item.phone;
      if (!phone || map[phone] != null) continue;
      map[phone] = normalizeGroupOrder(item.groupOrder);
    }
  }
  return map;
}

/** 按 groupOrder 排序路由对象数组（每项为 { path, meta, ... }，meta.title 为分组名） */
export function sortGroupRoutes(routeList, orderMap) {
  return [...routeList].sort((a, b) => {
    const aKey = extractGroupKey(a);
    const bKey = extractGroupKey(b);
    const ao =
      orderMap[aKey] != null
        ? orderMap[aKey]
        : normalizeGroupOrder(a.meta && a.meta.groupOrder);
    const bo =
      orderMap[bKey] != null
        ? orderMap[bKey]
        : normalizeGroupOrder(b.meta && b.meta.groupOrder);
    return compareGroups(aKey, ao, bKey, bo);
  });
}

export function extractGroupKey(route) {
  if (!route) return "";
  if (route.meta && route.meta.phone) return route.meta.phone;
  if (route.meta && route.meta.title) return route.meta.title;
  const path = route.path || "";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "accountManager" && parts[1]) return parts[1];
  return "";
}

/** 按新顺序重写 localStorage accountTree 的 key 顺序 */
export function reorderAccountTreeStorage(orderedPhones) {
  if (!Array.isArray(orderedPhones) || orderedPhones.length === 0) return;
  try {
    const raw = localStorage.getItem("accountTree");
    const tree = raw ? JSON.parse(raw) : {};
    const next = {};
    orderedPhones.forEach((phone) => {
      if (tree[phone]) next[phone] = tree[phone];
    });
    Object.keys(tree).forEach((phone) => {
      if (!next[phone]) next[phone] = tree[phone];
    });
    localStorage.setItem("accountTree", JSON.stringify(next));
  } catch (e) {
    /* ignore */
  }
}

/** 仅重排 permission store 中的分组路由，不重置 vue-router */
export function reorderPermissionStoreRouters(routers, orderedPhones) {
  if (!Array.isArray(routers) || !Array.isArray(orderedPhones)) {
    return routers || [];
  }
  const accountRouteMap = {};
  routers.forEach((route) => {
    const key = extractGroupKey(route);
    if (key && route.path && String(route.path).startsWith("/accountManager/")) {
      accountRouteMap[key] = route;
    }
  });
  const staticRoutes = routers.filter(
    (route) =>
      !route.path || !String(route.path).startsWith("/accountManager/")
  );
  const sortedAccountRoutes = orderedPhones
    .map((phone) => accountRouteMap[phone])
    .filter(Boolean);
  Object.keys(accountRouteMap).forEach((phone) => {
    if (!orderedPhones.includes(phone)) {
      sortedAccountRoutes.push(accountRouteMap[phone]);
    }
  });
  return [...staticRoutes, ...sortedAccountRoutes];
}

export function buildGroupOrderUpdates(rawAccountData, orderedPhones) {
  const updates = [];
  if (!rawAccountData || !Array.isArray(orderedPhones)) return updates;
  const orderIndex = {};
  orderedPhones.forEach((phone, idx) => {
    orderIndex[phone] = idx;
  });
  for (const dateKey of Object.keys(rawAccountData)) {
    const list = rawAccountData[dateKey];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const phone = item && item.phone;
      if (!phone || orderIndex[phone] === undefined) continue;
      const nextOrder = orderIndex[phone];
      if (normalizeGroupOrder(item.groupOrder) === nextOrder) continue;
      if (!item.id) continue;
      updates.push({
        id: item.id,
        date: item.date || dateKey,
        groupOrder: nextOrder,
      });
    }
  }
  return updates;
}
