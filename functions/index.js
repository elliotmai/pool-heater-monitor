/**
 * Pool Heater Monitor — the bridge to Hive (Cloud Functions v2)
 * -------------------------------------------------------------
 * The app's data now lives in Hive's Supabase project (schema `pool`): the
 * dashboard reads it there, and the rollups, retention and sensor-health jobs
 * that used to run here are pg_cron jobs now (Fridge-Board/supabase/migrations/
 * 20261125010000_pool.sql).
 *
 * Until the Pi writes to Hive itself, this one job keeps both sides in step,
 * every two minutes:
 *   Firebase → Hive   new readings, logs, weather, chatter, the live/diagnostic
 *                     snapshots, sensor last-seen times, and the Pi's progress
 *                     on a command
 *   Hive → Firebase   a command sent from the dashboard (restart, reset SDR),
 *                     so the Pi still picks it up
 *
 * It talks to Hive as a device (pool.device_sync), with a key kept at
 * /hive_bridge/key — outside water-heater-user/, so only admin code can read
 * it. Its cursor lives beside it. Once the Pi has moved over it stamps
 * /hive_bridge/pi_switched_at; this job makes one last pass and then does
 * nothing. Delete it then.
 *
 * Deploy: firebase deploy --only functions
 */

const crypto = require("node:crypto");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase } = require("firebase-admin/database");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

const BASE = "water-heater-user";
const HIVE_RPC = "https://fcjiummxpacwriwopcho.supabase.co/rest/v1/rpc/device_sync";
const HIVE_KEY = "sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S";

const SERIES = ["readings_raw", "logs", "logs_errors", "weather_history", "non-weather-sensors"];
const SNAPSHOTS = ["live", "diagnostics", "sdr_recovery", "non-weather-latest"];
const COMMANDS = ["restart", "reset_sdr"];
const PAGE = 400;

const hash = (v) => crypto.createHash("sha1").update(JSON.stringify(v ?? null)).digest("hex");
const progress = (c) => Math.max(Number(c?.handled_at) || 0, Number(c?.completed_at) || 0);

async function sync(deviceKey, ops) {
  const out = [];
  for (let i = 0; i < ops.length; i += PAGE) {
    const r = await fetch(HIVE_RPC, {
      method: "POST",
      headers: { apikey: HIVE_KEY, "content-type": "application/json", "content-profile": "pool" },
      body: JSON.stringify({ device_key: deviceKey, ops: ops.slice(i, i + PAGE) }),
    });
    if (!r.ok) throw new Error(`Hive said ${r.status}: ${(await r.text()).slice(0, 300)}`);
    out.push(...(await r.json()));
  }
  return out;
}

/** One pass. Exported for tests; `db` is a firebase-admin Database. */
async function bridgeOnce(db, send = sync) {
  const ctl = (await db.ref("hive_bridge").get()).val() || {};
  if (!ctl.key) return { skipped: "no key" };
  // Once the Pi has moved over: one last pass to pick up whatever it wrote to
  // Firebase just before, then nothing. Snapshots and commands are left out
  // of that pass; Hive's copies are the newer ones by then.
  if (ctl.pi_switched_at && ctl.final_pass_done) return { skipped: "the Pi writes to Hive itself" };
  const final = !!ctl.pi_switched_at;

  const cursor = ctl.cursor || {};
  const next = { ...cursor };
  const ops = [];
  const firstRun = Math.floor(Date.now() / 1000) - 86400;

  for (const node of SERIES) {
    const after = Number(cursor[node]) || firstRun;
    const snap = await db.ref(`${BASE}/${node}`).orderByKey().startAt(String(after + 1)).limitToFirst(PAGE * 5).get();
    snap.forEach((c) => {
      if (!/^\d+$/.test(c.key) || typeof c.val() !== "object") return;
      ops.push({ op: "set", path: `${node}/${c.key}`, value: c.val() });
      next[node] = Math.max(Number(next[node]) || 0, Number(c.key));
    });
  }

  // Snapshots are overwritten in place: send one only when it changed, so a
  // stale copy here can never overwrite a newer one in Hive.
  const snaps = final ? [] : await Promise.all(SNAPSHOTS.map((n) => db.ref(`${BASE}/${n}`).get()));
  if (!final) SNAPSHOTS.forEach((node, i) => {
    const v = snaps[i].val();
    const h = hash(v);
    if (v && typeof v === "object" && cursor[`hash_${node}`] !== h) {
      ops.push({ op: "set", path: node, value: v });
      next[`hash_${node}`] = h;
    }
  });

  const sensors = (await db.ref(`${BASE}/sensors`).get()).val() || {};
  const seen = {};
  for (const [id, cfg] of Object.entries(sensors)) {
    if (cfg && typeof cfg.lastSeen === "number" && !id.includes("/")) seen[`${id}/lastSeen`] = cfg.lastSeen;
  }
  if (Object.keys(seen).length && cursor["hash_sensors"] !== hash(seen)) {
    ops.push({ op: "update", path: "sensors", value: seen });
    next["hash_sensors"] = hash(seen);
  }

  // Commands: the newer request wins downwards; the Pi's progress goes up.
  const theirs = final ? [] : await send(ctl.key, COMMANDS.map((n) => ({ op: "get", path: `commands/${n}` })));
  for (const [i, name] of final ? [] : COMMANDS.entries()) {
    const hive = theirs[i];
    const ref = db.ref(`${BASE}/commands/${name}`);
    const fb = (await ref.get()).val();
    if ((Number(hive?.requested_at) || 0) > (Number(fb?.requested_at) || 0)) {
      await ref.set(hive);
    } else if (fb && typeof fb === "object" && progress(fb) > progress(hive)) {
      ops.push({ op: "set", path: `commands/${name}`, value: fb });
    }
  }

  if (ops.length) await send(ctl.key, ops);
  await db.ref("hive_bridge/cursor").set(next);
  if (final) await db.ref("hive_bridge/final_pass_done").set(true);
  return { sent: ops.length, final };
}

exports.bridgeOnce = bridgeOnce;

exports.bridgeToHive = onSchedule({ schedule: "every 2 minutes", timeZone: "UTC", retryCount: 0 }, async () => {
  const result = await bridgeOnce(getDatabase());
  console.log("[bridgeToHive]", JSON.stringify(result));
});
