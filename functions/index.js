/**
 * ONGOING TTL ENFORCEMENT (Cloud Functions v2, scheduled, paginated)
 * ------------------------------------------------------------------
 * Deletes anything past the retention window on a schedule. Reads are paginated
 * so even the first run against a large backlog won't hit "payload too large".
 * Requires the Blaze plan. Place in functions/index.js and deploy:
 *   firebase deploy --only functions:enforceTtl
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase } = require("firebase-admin/database");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

// ─────────────────────────── CONFIG ───────────────────────────
const RETENTION_DAYS = 7;
const SCHEDULE = "every 30 minutes";
const PAGE_SIZE = 200;
// unix_timestamp is in SECONDS.
// ───────────────────────────────────────────────────────────────

const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
function pushIdBoundary(timestampMs) {
  let ts = timestampMs;
  const out = new Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = PUSH_CHARS.charAt(ts % 64);
    ts = Math.floor(ts / 64);
  }
  return out.join("") + "------------";
}

// Deletion drives progress here, so each round just reads the first PAGE_SIZE
// still-expired items, deletes them, and repeats until none remain.
async function pruneByTimestamp(db, path, cutoffSec) {
  const ref = db.ref(path);
  let removed = 0;
  while (true) {
    const snap = await ref.orderByChild("unix_timestamp").endAt(cutoffSec).limitToFirst(PAGE_SIZE).once("value");
    const updates = {};
    let n = 0;
    snap.forEach((c) => { updates[c.key] = null; n++; });
    if (n === 0) break;
    await ref.update(updates);
    removed += n;
    if (n < PAGE_SIZE) break;
  }
  console.log(`enforceTtl: ${path} removed ${removed} expired record(s).`);
}

async function pruneLogs(db, path, cutoffMs) {
  const ref = db.ref(path);
  const boundary = pushIdBoundary(cutoffMs);
  let removed = 0;
  while (true) {
    const snap = await ref.orderByKey().endAt(boundary).limitToFirst(PAGE_SIZE).once("value");
    const updates = {};
    let n = 0;
    snap.forEach((c) => { updates[c.key] = null; n++; });
    if (n === 0) break;
    await ref.update(updates);
    removed += n;
    if (n < PAGE_SIZE) break;
  }
  console.log(`enforceTtl: ${path} removed ${removed} expired log(s).`);
}

exports.enforceTtl = onSchedule(SCHEDULE, async () => {
  const db = getDatabase();
  const cutoffMs = Date.now() - RETENTION_DAYS * 86400 * 1000;
  const cutoffSec = Math.floor(cutoffMs / 1000);

  await pruneByTimestamp(db, "water-heater-user/readings", cutoffSec);
  await pruneByTimestamp(db, "water-heater-user/weather_history", cutoffSec);
  await pruneLogs(db, "water-heater-user/logs", cutoffMs);
});