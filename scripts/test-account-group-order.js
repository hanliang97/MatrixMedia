const assert = require("assert");
const {
  compareGroups,
  buildGroupOrderMap,
  sortGroupRoutes,
  buildGroupOrderUpdates,
  extractGroupKey,
} = require("../src/shared/accountGroupOrder.js");

assert.strictEqual(compareGroups("b", 1, "a", 0), 1);
assert.strictEqual(compareGroups("a", null, "b", null) < 0, true);

const raw = {
  "2024-01-01": [
    { phone: "group-b", groupOrder: 1, id: 2 },
    { phone: "group-a", groupOrder: 0, id: 1 },
  ],
};
const map = buildGroupOrderMap(raw);
assert.strictEqual(map["group-a"], 0);
assert.strictEqual(map["group-b"], 1);

const routes = sortGroupRoutes(
  [
    { path: "/accountManager/group-b", meta: { title: "group-b", phone: "group-b" } },
    { path: "/accountManager/group-a", meta: { title: "group-a", phone: "group-a" } },
  ],
  map
);
assert.strictEqual(extractGroupKey(routes[0]), "group-a");

const updates = buildGroupOrderUpdates(raw, ["group-b", "group-a"]);
assert.ok(updates.length >= 1);
assert.strictEqual(updates.find((u) => u.id === 1).groupOrder, 1);

console.log("accountGroupOrder: ok");
