const { test } = require("node:test");
const assert = require("node:assert/strict");
const { exchange } = require("./hiveSignIn");

const supabase = (user) => async () => (user ? { ok: true, json: async () => user } : { ok: false, json: async () => ({}) });
const mint = async (id) => `token-for-${id}`;

test("an account from before the move is an owner", async () => {
  const r = await exchange("at", { f: supabase({ id: "u1", created_at: "2026-11-20T13:54:52Z" }), isListed: async () => false, mint });
  assert.deepEqual(r, { status: 200, body: { token: "token-for-u1" } });
});

test("a newer account needs to be listed", async () => {
  const late = supabase({ id: "u2", created_at: "2026-12-01T00:00:00Z" });
  assert.equal((await exchange("at", { f: late, isListed: async () => false, mint })).status, 403);
  assert.equal((await exchange("at", { f: late, isListed: async (id) => id === "u2", mint })).status, 200);
});

test("no session, or one Supabase refuses, gets nothing", async () => {
  assert.equal((await exchange("", { f: supabase(null), isListed: async () => true, mint })).status, 401);
  assert.equal((await exchange("forged", { f: supabase(null), isListed: async () => true, mint })).status, 401);
});
