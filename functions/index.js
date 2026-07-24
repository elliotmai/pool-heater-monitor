/**
 * Pool Heater Monitor — data lifecycle functions (Cloud Functions v2)
 * -------------------------------------------------------------------
 * Tiered time-series storage, all in Realtime Database, all keyed by
 * unix_timestamp (seconds) so every query uses orderByKey() and needs NO
 * database index.
 *
 *   readings_raw/{ts}      5-min points      HOT   — kept 7 days
 *   readings_hourly/{ts}   min/max/avg       WARM  — kept 90 days
 *   readings_daily/{ts}    min/max/avg       COLD  — kept forever
 *   logs/{ts}              info/heartbeat          — kept 14 days
 *   logs_errors/{ts}       warn/error              — kept 90 days
 *   sensor_events/{pushId} audit trail             — kept forever
 *   stats/records          all-time min/max        — kept forever
 *
 * Scheduled jobs (all require the Blaze plan):
 *   rollupHourly  :05 each hour  raw -> hourly bucket for the previous hour
 *   rollupDaily   00:15 daily    raw -> daily bucket for the previous UTC day
 *   enforceTtl    every 6 hours  prune each tier past its retention window
 *   sensorHealth  every 15 min   emit offline/online sensor_events
 *
 * Deploy: firebase deploy --only functions
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase } = require("firebase-admin/database");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

// ─────────────────────────── CONFIG ───────────────────────────
const BASE = "water-heater-user";
const RAW = `${BASE}/readings_raw`;
const HOURLY = `${BASE}/readings_hourly`;
const DAILY = `${BASE}/readings_daily`;

const RETENTION = {
  [RAW]: 7 * 86400,
  [HOURLY]: 90 * 86400,
  [`${BASE}/logs`]: 14 * 86400,
  [`${BASE}/logs_errors`]: 90 * 86400,
  // weather_history is still written every cycle (its latest record powers the
  // Overview weather card) — bounded here.
  [`${BASE}/weather_history`]: 7 * 86400,
  // 'readings' is the retired legacy node (no longer written); kept here only
  // to drain any residual entries, after which it prunes to empty.
  [`${BASE}/readings`]: 7 * 86400,
};

const OFFLINE_AFTER = 20 * 60; // sensor considered offline after 20 min silent
const PAGE_SIZE = 200;
// ───────────────────────────────────────────────────────────────

const nowSec = () => Math.floor(Date.now() / 1000);
const round2 = (n) => Math.round(n * 100) / 100;

// ─────────────────────────── AGGREGATION ───────────────────────────

function accumulate(store, key, value, ts) {
  let s = store[key];
  if (!s) {
    s = store[key] = { min: value, max: value, sum: 0, count: 0, last: value, lastTs: -1 };
  }
  if (value < s.min) s.min = value;
  if (value > s.max) s.max = value;
  s.sum += value;
  s.count += 1;
  if (ts >= s.lastTs) { s.last = value; s.lastTs = ts; }
}

function finalizeStore(store) {
  const out = {};
  for (const [k, s] of Object.entries(store)) {
    out[k] = { min: round2(s.min), max: round2(s.max), avg: round2(s.sum / s.count), last: round2(s.last), count: s.count };
  }
  return out;
}

/**
 * Aggregate a window of raw readings into per-sensor and outside-weather
 * min/max/avg/last summaries. Any numeric field that isn't metadata or an
 * `outside_*` field is treated as a sensor.
 */
function aggregateWindow(readingsObj) {
  const sensors = {};
  const outside = {};
  let count = 0;
  let conditionsLast = null;
  let conditionsTs = -1;

  for (const r of Object.values(readingsObj)) {
    if (!r || typeof r !== "object") continue;
    const ts = Number(r.unix_timestamp) || 0;
    count += 1;
    for (const [k, v] of Object.entries(r)) {
      if (k === "timestamp" || k === "unix_timestamp") continue;
      if (k === "outside_conditions") {
        if (v != null && ts >= conditionsTs) { conditionsLast = v; conditionsTs = ts; }
        continue;
      }
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (k.startsWith("outside_")) accumulate(outside, k.slice(8), v, ts);
      else accumulate(sensors, k, v, ts);
    }
  }

  const outsideOut = finalizeStore(outside);
  if (conditionsLast != null) outsideOut.conditions_last = conditionsLast;
  return { count, sensors: finalizeStore(sensors), outside: outsideOut };
}

/** Read raw readings in [startSec, endSec] and write one rollup bucket. */
async function buildBucket(db, destPath, startSec, endSec, bucketKey) {
  const snap = await db.ref(RAW).orderByKey().startAt(String(startSec)).endAt(String(endSec)).once("value");
  const val = snap.val();
  if (!val) {
    console.log(`rollup: no raw data for ${destPath}/${bucketKey} [${startSec}, ${endSec}]`);
    return null;
  }
  const agg = aggregateWindow(val);
  const doc = { unix_timestamp: bucketKey, bucket_start: startSec, bucket_end: endSec, ...agg };
  await db.ref(`${destPath}/${bucketKey}`).set(doc);
  console.log(`rollup: wrote ${destPath}/${bucketKey} (count=${agg.count})`);
  return doc;
}

/** Fold a freshly-built daily bucket into the all-time records. */
async function updateRecords(db, dailyDoc) {
  const ref = db.ref(`${BASE}/stats/records`);
  const cur = (await ref.once("value")).val() || { sensors: {}, outside: {} };
  cur.sensors = cur.sensors || {};
  cur.outside = cur.outside || {};
  const ts = dailyDoc.unix_timestamp;

  const fold = (bucketGroup, recGroup) => {
    for (const [name, s] of Object.entries(bucketGroup || {})) {
      if (!s || typeof s !== "object" || typeof s.min !== "number") continue;
      const rec = recGroup[name] || {};
      if (!rec.min || s.min < rec.min.value) rec.min = { value: s.min, unix_timestamp: ts };
      if (!rec.max || s.max > rec.max.value) rec.max = { value: s.max, unix_timestamp: ts };
      recGroup[name] = rec;
    }
  };
  fold(dailyDoc.sensors, cur.sensors);
  fold(dailyDoc.outside, cur.outside);

  cur.updated = ts;
  await ref.set(cur);
  console.log(`records: updated from daily bucket ${ts}`);
}

// ─────────────────────────── RETENTION ───────────────────────────

/** Delete everything in `path` whose key (a unix_timestamp) is <= cutoffSec. */
async function pruneByKey(db, path, cutoffSec) {
  const ref = db.ref(path);
  let removed = 0;
  while (true) {
    const snap = await ref.orderByKey().endAt(String(cutoffSec)).limitToFirst(PAGE_SIZE).once("value");
    const updates = {};
    let n = 0;
    snap.forEach((c) => { updates[c.key] = null; n += 1; });
    if (n === 0) break;
    await ref.update(updates);
    removed += n;
    if (n < PAGE_SIZE) break;
  }
  if (removed) console.log(`enforceTtl: ${path} removed ${removed} expired record(s).`);
}

async function pushEvent(db, sensorId, event, extra = {}) {
  const ts = nowSec();
  await db.ref(`${BASE}/sensor_events`).push({
    sensorId, event, timestamp: new Date(ts * 1000).toISOString(), unix_timestamp: ts, ...extra,
  });
  console.log(`sensor_events: ${sensorId} ${event}`);
}

// ─────────────────────────── SCHEDULED JOBS ───────────────────────────

exports.rollupHourly = onSchedule("5 * * * *", async () => {
  const db = getDatabase();
  const hourStart = Math.floor(nowSec() / 3600) * 3600 - 3600; // previous full hour
  await buildBucket(db, HOURLY, hourStart, hourStart + 3599, hourStart);
});

exports.rollupDaily = onSchedule("15 0 * * *", async () => {
  const db = getDatabase();
  const dayStart = Math.floor(nowSec() / 86400) * 86400 - 86400; // previous full UTC day
  const doc = await buildBucket(db, DAILY, dayStart, dayStart + 86399, dayStart);
  if (doc) await updateRecords(db, doc);
});

exports.enforceTtl = onSchedule("0 */6 * * *", async () => {
  const db = getDatabase();
  const now = nowSec();
  for (const [path, window] of Object.entries(RETENTION)) {
    await pruneByKey(db, path, now - window);
  }
  // readings_daily, sensor_events and stats are intentionally kept forever.
});

exports.sensorHealth = onSchedule("*/15 * * * *", async () => {
  const db = getDatabase();
  const now = nowSec();
  const sensors = (await db.ref(`${BASE}/sensors`).once("value")).val() || {};

  for (const [id, cfg] of Object.entries(sensors)) {
    if (!cfg || cfg.lastSeen == null) continue;
    const silentFor = now - cfg.lastSeen;
    const status = cfg.status || "online";
    if (silentFor > OFFLINE_AFTER && status !== "offline") {
      await db.ref(`${BASE}/sensors/${id}/status`).set("offline");
      await pushEvent(db, id, "offline", { note: `No data for ${Math.round(silentFor / 60)} min` });
    } else if (silentFor <= OFFLINE_AFTER && status === "offline") {
      await db.ref(`${BASE}/sensors/${id}/status`).set("online");
      await pushEvent(db, id, "online", {});
    }
  }
});
