#!/usr/bin/env python3
"""
One-time backfill: roll EXISTING raw readings up into the warm (hourly) and
cold (daily) summary tiers, so the 30D / 6M / 1Y dashboard views have history
right away instead of waiting for the scheduled rollups to accumulate.

This is a whole-house wireless temperature logger: an RTL-SDR on the Pi picks
up several Oria 433 MHz room sensors plus outdoor weather. Data lives in
Realtime Database, keyed by unix_timestamp (seconds).

Reads : water-heater-user/readings_raw   (+ legacy water-heater-user/readings)
Writes: water-heater-user/readings_hourly/{hourStart}   min/max/avg per sensor
        water-heater-user/readings_daily/{dayStart}      min/max/avg per sensor
        water-heater-user/stats/records                  all-time min/max

Bucket shapes match functions/index.js exactly, so this is interchangeable with
the scheduled rollups. Idempotent: re-running overwrites the same buckets. It
does NOT delete raw data — the enforceTtl function prunes raw > 7 days on its
own schedule; this only builds the summaries the raw rolls into.

Run on the Pi (it has firebase-admin and the service-account key):
    python3 ~/pool-heater-monitor/deploy/backfill_rollups.py
"""

import time
from collections import defaultdict

import firebase_admin
from firebase_admin import credentials, db

# ─────────────────────────── CONFIG ───────────────────────────
CRED_PATH = '/home/pi/Desktop/water-heater-sensors-firebase-adminsdk-fbsvc-0a078f1c90.json'
DB_URL = 'https://water-heater-sensors-default-rtdb.firebaseio.com'
BASE = '/water-heater-user'

# Also fold the legacy 'readings' node (pre-migration data) into the rollups.
INCLUDE_LEGACY_READINGS = True

HOUR = 3600
DAY = 86400
# ───────────────────────────────────────────────────────────────


def round2(x):
    return round(x * 100) / 100


def aggregate_window(readings):
    """Aggregate a list of raw readings into per-sensor / outside summaries.
    Mirrors aggregateWindow() in functions/index.js."""
    sensors = {}
    outside = {}
    count = 0
    conditions_last = None
    conditions_ts = -1

    def acc(store, key, value, ts):
        s = store.get(key)
        if s is None:
            s = store[key] = {'min': value, 'max': value, 'sum': 0.0,
                              'count': 0, 'last': value, 'lastTs': -1}
        if value < s['min']:
            s['min'] = value
        if value > s['max']:
            s['max'] = value
        s['sum'] += value
        s['count'] += 1
        if ts >= s['lastTs']:
            s['last'] = value
            s['lastTs'] = ts

    for r in readings:
        if not isinstance(r, dict):
            continue
        ts = int(r.get('unix_timestamp') or 0)
        count += 1
        for k, v in r.items():
            if k in ('timestamp', 'unix_timestamp'):
                continue
            if k == 'outside_conditions':
                if v is not None and ts >= conditions_ts:
                    conditions_last = v
                    conditions_ts = ts
                continue
            # Exclude booleans (isinstance(True, int) is True in Python).
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                continue
            if k.startswith('outside_'):
                acc(outside, k[len('outside_'):], v, ts)
            else:
                acc(sensors, k, v, ts)

    def finalize(store):
        out = {}
        for k, s in store.items():
            out[k] = {
                'min': round2(s['min']), 'max': round2(s['max']),
                'avg': round2(s['sum'] / s['count']), 'last': round2(s['last']),
                'count': s['count'],
            }
        return out

    outside_out = finalize(outside)
    if conditions_last is not None:
        outside_out['conditions_last'] = conditions_last
    return {'count': count, 'sensors': finalize(sensors), 'outside': outside_out}


def fold_records(records, agg, ts):
    """Track all-time min/max as daily buckets are built."""
    for group in ('sensors', 'outside'):
        for name, s in agg.get(group, {}).items():
            if not isinstance(s, dict) or 'min' not in s:
                continue  # skips e.g. outside.conditions_last (a string)
            rec = records[group].setdefault(name, {})
            if 'min' not in rec or s['min'] < rec['min']['value']:
                rec['min'] = {'value': s['min'], 'unix_timestamp': ts}
            if 'max' not in rec or s['max'] > rec['max']['value']:
                rec['max'] = {'value': s['max'], 'unix_timestamp': ts}


def merge_records(existing, new):
    """Merge freshly-computed records into whatever the functions already wrote,
    keeping the more-extreme value on each side."""
    for group in ('sensors', 'outside'):
        existing.setdefault(group, {})
        for name, rec in new.get(group, {}).items():
            e = existing[group].setdefault(name, {})
            if 'min' in rec and ('min' not in e or rec['min']['value'] < e['min']['value']):
                e['min'] = rec['min']
            if 'max' in rec and ('max' not in e or rec['max']['value'] > e['max']['value']):
                e['max'] = rec['max']


def main():
    cred = credentials.Certificate(CRED_PATH)
    firebase_admin.initialize_app(cred, {'databaseURL': DB_URL})
    root = db.reference(BASE)

    # Gather existing raw readings, keyed by unix_timestamp (raw wins on tie).
    combined = {}
    raw = root.child('readings_raw').get() or {}
    for v in raw.values():
        if isinstance(v, dict) and v.get('unix_timestamp'):
            combined[int(v['unix_timestamp'])] = v
    print(f"readings_raw: {len(raw)} record(s)")

    if INCLUDE_LEGACY_READINGS:
        legacy = root.child('readings').get() or {}
        added = 0
        for v in legacy.values():
            if isinstance(v, dict) and v.get('unix_timestamp'):
                ts = int(v['unix_timestamp'])
                if ts not in combined:
                    combined[ts] = v
                    added += 1
        print(f"legacy readings: {len(legacy)} record(s) ({added} not already in raw)")

    if not combined:
        print("No existing readings found — nothing to backfill.")
        return

    now = int(time.time())
    cur_hour = (now // HOUR) * HOUR
    cur_day = (now // DAY) * DAY

    # Bucket by hour and day. Skip the still-in-progress current hour/day — the
    # scheduled rollups will complete those.
    hour_buckets = defaultdict(list)
    day_buckets = defaultdict(list)
    for ts, r in combined.items():
        h = (ts // HOUR) * HOUR
        d = (ts // DAY) * DAY
        if h < cur_hour:
            hour_buckets[h].append(r)
        if d < cur_day:
            day_buckets[d].append(r)

    span_lo = min(combined) if combined else 0
    span_hi = max(combined) if combined else 0
    print(f"{len(combined)} unique reading(s) spanning "
          f"{time.strftime('%Y-%m-%d', time.localtime(span_lo))} → "
          f"{time.strftime('%Y-%m-%d', time.localtime(span_hi))}")

    # Warm tier: hourly buckets.
    hourly_ref = root.child('readings_hourly')
    for h, rs in sorted(hour_buckets.items()):
        agg = aggregate_window(rs)
        hourly_ref.child(str(h)).set({
            'unix_timestamp': h, 'bucket_start': h, 'bucket_end': h + HOUR - 1, **agg,
        })
    print(f"Wrote {len(hour_buckets)} hourly bucket(s).")

    # Cold tier: daily buckets (+ all-time records).
    daily_ref = root.child('readings_daily')
    records = {'sensors': {}, 'outside': {}}
    for d, rs in sorted(day_buckets.items()):
        agg = aggregate_window(rs)
        daily_ref.child(str(d)).set({
            'unix_timestamp': d, 'bucket_start': d, 'bucket_end': d + DAY - 1, **agg,
        })
        fold_records(records, agg, d)
    print(f"Wrote {len(day_buckets)} daily bucket(s).")

    if day_buckets:
        rec_ref = root.child('stats/records')
        existing = rec_ref.get() or {'sensors': {}, 'outside': {}}
        merge_records(existing, records)
        existing['updated'] = now
        rec_ref.set(existing)
        print("Updated stats/records.")

    print("Backfill complete.")


if __name__ == '__main__':
    main()
