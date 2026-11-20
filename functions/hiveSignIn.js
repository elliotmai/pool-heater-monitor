/**
 * Sign in with Hive, to change settings or send the Pi a command.
 *
 * Anyone can look at the pool dashboard; changing a sensor or restarting the
 * Pi takes an owner. The page posts its Hive (Supabase) session's access
 * token; Supabase says who that is; an owner gets a Firebase custom token
 * carrying `pool_owner: true`, which database.rules.json requires for writes.
 *
 * An owner is an account that existed before Hive's move to Supabase
 * (20 Nov 2026, 17:15 UTC), or anyone listed at water-heater-user/owners/{id}
 * (add them in the Firebase console). The Pi and these functions write with
 * the Admin SDK, which the rules don't apply to.
 *
 * POST { accessToken } → 200 { token } | 401 | 403
 */
const { onRequest } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const SUPABASE_URL = "https://fcjiummxpacwriwopcho.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S";
const OWNERS_BEFORE = Date.parse("2026-11-20T17:15:00Z");
const ALLOWED = /^https:\/\/(([a-z0-9-]+\.)?flyingdoublemranch\.com|pool-heater-monitor\.netlify\.app)$/;

async function exchange(accessToken, { f = fetch, isListed, mint } = {}) {
  if (!accessToken || typeof accessToken !== "string") return { status: 401, body: { error: "Sign in to Hive first" } };
  const r = await f(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return { status: 401, body: { error: "Sign in to Hive first" } };
  const user = await r.json();
  if (!user || !user.id) return { status: 401, body: { error: "Sign in to Hive first" } };
  const early = Date.parse(user.created_at) < OWNERS_BEFORE;
  if (!early && !(await isListed(user.id))) return { status: 403, body: { error: "Only the pool's owners can change settings", code: "not-owner" } };
  return { status: 200, body: { token: await mint(user.id) } };
}

exports.exchange = exchange;

exports.hiveSignIn = onRequest(async (req, res) => {
  const origin = req.get("origin");
  if (origin && ALLOWED.test(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "content-type");
    res.set("Access-Control-Max-Age", "86400");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { status, body } = await exchange(req.body && req.body.accessToken, {
      isListed: async (id) => (await getDatabase().ref(`water-heater-user/owners/${id}`).get()).val() === true,
      mint: (id) => getAuth().createCustomToken(`hive:${id}`, { pool_owner: true }),
    });
    return res.status(status).json(body);
  } catch (err) {
    console.error("[hiveSignIn] failed:", err);
    return res.status(500).json({ error: "Sign-in with Hive is having trouble" });
  }
});
