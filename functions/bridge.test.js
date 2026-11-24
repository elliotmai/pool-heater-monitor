const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bridgeOnce } = require("./index");

/** A tiny in-memory stand-in for the firebase-admin Database API the bridge uses. */
function fakeDb(tree) {
  const at = (path) => path.split("/").reduce((n, k) => (n == null ? undefined : n[k]), tree);
  const put = (path, v) => {
    const keys = path.split("/");
    let n = tree;
    for (const k of keys.slice(0, -1)) n = n[k] ??= {};
    n[keys.at(-1)] = v;
  };
  const snap = (v) => ({ val: () => (v === undefined ? null : structuredClone(v)) });
  const ref = (path) => {
    let start = null;
    let limit = Infinity;
    const q = {
      orderByKey: () => q,
      startAt: (s) => ((start = s), q),
      limitToFirst: (n) => ((limit = n), q),
      get: async () => {
        const v = at(path);
        if (start == null) return snap(v);
        const keys = Object.keys(v || {}).sort().filter((k) => k >= start).slice(0, limit);
        return { forEach: (fn) => keys.forEach((k) => fn({ key: k, val: () => v[k] })) };
      },
      set: async (v) => put(path, structuredClone(v)),
    };
    return q;
  };
  return { ref, tree };
}

const now = Math.floor(Date.now() / 1000);

test("copies new Pi writes up once, and a dashboard command down", async () => {
  const db = fakeDb({
    hive_bridge: { key: "k" },
    "water-heater-user": {
      readings_raw: { [now - 60]: { a: 1, unix_timestamp: now - 60 } },
      logs: {},
      live: { a: 1 },
      sensors: { a: { lastSeen: now - 60, displayName: "A" } },
      commands: { restart: { requested_at: 10, handled_at: 11, status: "completed" } },
    },
  });
  const sent = [];
  const hiveCommands = [{ requested_at: 20, status: "requested" }, null];
  const send = async (_key, ops) => {
    if (ops[0].op === "get") return hiveCommands;
    sent.push(...ops);
    return ops.map(() => true);
  };

  await bridgeOnce(db, send);
  assert.deepEqual(sent.map((o) => o.path).sort(), [`readings_raw/${now - 60}`, "live", "sensors"].sort());
  assert.deepEqual(db.tree["water-heater-user"].commands.restart, { requested_at: 20, status: "requested" });

  // Nothing new: nothing is sent again (a stale snapshot never overwrites Hive).
  sent.length = 0;
  hiveCommands[0] = { requested_at: 20, status: "requested" };
  await bridgeOnce(db, send);
  assert.deepEqual(sent, []);

  // The Pi claims the command in Firebase: its progress goes up to Hive.
  db.tree["water-heater-user"].commands.restart = { requested_at: 20, handled_at: 25, status: "restarting" };
  await bridgeOnce(db, send);
  assert.deepEqual(sent, [{ op: "set", path: "commands/restart", value: { requested_at: 20, handled_at: 25, status: "restarting" } }]);
});

test("after the Pi moves: one last pass for its final Firebase rows, then nothing", async () => {
  const db = fakeDb({
    hive_bridge: { key: "k", pi_switched_at: 1, cursor: { readings_raw: now - 120 } },
    "water-heater-user": { readings_raw: { [now - 60]: { a: 1 } }, live: { a: 2 }, commands: { restart: { handled_at: 9 } } },
  });
  const sent = [];
  await bridgeOnce(db, async (_k, ops) => (sent.push(...ops), ops.map(() => true)));
  assert.deepEqual(sent.map((o) => o.path), [`readings_raw/${now - 60}`]);
  assert.equal(db.tree.hive_bridge.final_pass_done, true);
  assert.deepEqual(await bridgeOnce(db, async () => assert.fail("should not call Hive")), { skipped: "the Pi writes to Hive itself" });
});

test("stays stood down after its last pass", async () => {
  const db = fakeDb({ hive_bridge: { key: "k", pi_switched_at: 1, final_pass_done: true } });
  assert.deepEqual(await bridgeOnce(db, async () => assert.fail("should not call Hive")), { skipped: "the Pi writes to Hive itself" });
});
