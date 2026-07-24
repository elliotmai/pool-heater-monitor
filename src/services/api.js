import {
  ref,
  get,
  set,
  update,
  push,
  query,
  orderByKey,
  startAt,
  limitToLast } from 'firebase/database';
import { database } from '../config/firebase';

const BASE = 'water-heater-user';

/**
 * Convert Celsius to Fahrenheit
 */
const celsiusToFahrenheit = (celsius) => {
  if (celsius === null || celsius === undefined) return null;
  return (celsius * 9 / 5) + 32;
};

/**
 * Time ranges the dashboard can display. Each maps to the tier that holds the
 * right resolution for that span, so a query never pulls more than a few
 * hundred points:
 *   raw    → 5-min points   (readings_raw)
 *   hourly → hourly summary (readings_hourly)
 *   daily  → daily summary  (readings_daily)
 */
export const RANGES = {
  '24h': { seconds: 86400, tier: 'raw' },
  '7d': { seconds: 7 * 86400, tier: 'raw' },
  '30d': { seconds: 30 * 86400, tier: 'hourly' },
  '6mo': { seconds: 182 * 86400, tier: 'daily' },
  '1y': { seconds: 365 * 86400, tier: 'daily' },
};

const TIER_PATH = {
  raw: `${BASE}/readings_raw`,
  hourly: `${BASE}/readings_hourly`,
  daily: `${BASE}/readings_daily`,
};

const META_KEYS = new Set(['timestamp', 'unix_timestamp', 'bucket_start', 'bucket_end', 'count']);

// ─────────────────────────── Sensor config ───────────────────────────

/**
 * Fetch sensor configuration from Firebase
 * This is the source of truth for sensor metadata
 */
export const fetchSensorConfig = async () => {
  try {
    const sensorsRef = ref(database, `${BASE}/sensors`);
    const snapshot = await get(sensorsRef);

    if (!snapshot.exists()) {
      return {};
    }

    const sensorsData = snapshot.val();

    const sensorConfig = {};
    Object.entries(sensorsData).forEach(([sensorId, config]) => {
      sensorConfig[sensorId] = {
        displayName: config.displayName || sensorId,
        color: config.color || '#007aff',
        enabled: config.alive !== false, // Use 'alive' from DB as 'enabled' in app
        location: config.location || null,
        status: config.status || 'online',
        lastSeen: config.lastSeen || null,
      };
    });

    return sensorConfig;
  } catch (error) {
    console.error('Error fetching sensor config:', error);
    return {};
  }
};

/**
 * Update a sensor's configuration in Firebase
 */
export const updateSensorConfig = async (sensorId, config) => {
  try {
    const sensorRef = ref(database, `${BASE}/sensors/${sensorId}`);

    // Map app's 'enabled' to DB's 'alive'. Only include fields that were passed.
    const dbConfig = {};
    if (config.displayName !== undefined) dbConfig.displayName = config.displayName;
    if (config.color !== undefined) dbConfig.color = config.color;
    if (config.enabled !== undefined) dbConfig.alive = config.enabled !== false;
    if (config.location !== undefined) dbConfig.location = config.location;

    await update(sensorRef, dbConfig);
    return true;
  } catch (error) {
    console.error('Error updating sensor config:', error);
    return false;
  }
};

/**
 * Create a new sensor configuration in Firebase
 */
export const createSensorConfig = async (sensorId, config) => {
  try {
    const sensorRef = ref(database, `${BASE}/sensors/${sensorId}`);

    const dbConfig = {
      displayName: config.displayName || sensorId,
      color: config.color || '#007aff',
      alive: config.enabled !== false,
      location: config.location || null,
    };

    await set(sensorRef, dbConfig);
    return true;
  } catch (error) {
    console.error('Error creating sensor config:', error);
    return false;
  }
};

/**
 * Is this a data key that represents a sensor (vs metadata or outside weather)?
 */
const isSensorKey = (key, value) =>
  typeof value === 'number' && !META_KEYS.has(key) && !key.startsWith('outside_');

/**
 * Discover sensors from a reading and ensure they exist in sensor config.
 * Auto-creates config entries for any new sensor names found.
 */
const discoverAndEnsureSensors = async (firebaseData, currentSensorConfig) => {
  if (!firebaseData) return currentSensorConfig;

  const sensorKeys = Object.keys(firebaseData).filter(key => isSensorKey(key, firebaseData[key]));

  const DEFAULT_COLORS = [
    '#007aff', '#ff3b30', '#ffcc00', '#34c759', '#8e44ad',
    '#dca225', '#f9abdf', '#00d4ff', '#ff6b6b', '#4ecdc4'
  ];

  let hasNewSensors = false;
  const newSensorConfig = { ...currentSensorConfig };
  let colorIndex = Object.keys(currentSensorConfig).length;

  for (const sensorKey of sensorKeys) {
    if (!currentSensorConfig[sensorKey]) {
      hasNewSensors = true;
      const config = {
        displayName: sensorKey.replace(/([A-Z])/g, ' $1').trim(),
        color: DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length],
        enabled: true
      };
      newSensorConfig[sensorKey] = config;
      await createSensorConfig(sensorKey, config);
      colorIndex++;
    }
  }

  return hasNewSensors ? newSensorConfig : currentSensorConfig;
};

// ─────────────────────────── Latest snapshot ───────────────────────────

/**
 * Fetch the latest sensor snapshot (the 'live' node) plus the most recent
 * rich weather record (which carries location + icon for the Overview card).
 */
export const fetchLatestData = async () => {
  try {
    const liveRef = ref(database, `${BASE}/live`);
    const weatherQuery = query(ref(database, `${BASE}/weather_history`), orderByKey(), limitToLast(1));

    const [liveSnap, weatherSnap] = await Promise.all([get(liveRef), get(weatherQuery)]);

    // No snapshot yet — return null so the UI shows placeholders, not a crash.
    const live = liveSnap.exists() ? liveSnap.val() : null;
    if (!live) return null;

    // Latest rich weather (for the Overview weather card).
    let latestWeather = null;
    if (weatherSnap.exists()) {
      const vals = Object.values(weatherSnap.val());
      latestWeather = vals[vals.length - 1] || null;
    }

    // Sensor values are stored in °C — convert to °F for display.
    const converted = {
      timestamp: live.timestamp,
      unix_timestamp: live.unix_timestamp,
    };
    Object.keys(live).forEach(key => {
      if (isSensorKey(key, live[key])) {
        converted[key] = celsiusToFahrenheit(live[key]);
      }
    });

    converted.weather = latestWeather;
    return converted;
  } catch (error) {
    console.error('Error fetching latest data:', error);
    return null;
  }
};

// ─────────────────────────── Historical (tiered) ───────────────────────────

const labelFor = (unixSec, range) => {
  const d = new Date(unixSec * 1000);
  if (range === '24h') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (range === '7d') return d.toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  if (range === '30d') return d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); // 6mo / 1y
};

/** Normalize a raw 5-min reading into a flat °F chart row. */
const normalizeRaw = (reading, range) => {
  const row = {
    time: labelFor(reading.unix_timestamp, range),
    timestamp: reading.timestamp,
    unix_timestamp: reading.unix_timestamp,
    outdoor_temp: reading.outside_temp_f ?? null,
    outdoor_humidity: reading.outside_humidity ?? null,
    weather_description: reading.outside_conditions ?? null,
  };
  Object.keys(reading).forEach(key => {
    if (isSensorKey(key, reading[key])) row[key] = celsiusToFahrenheit(reading[key]);
  });
  return row;
};

/** Normalize an hourly/daily rollup bucket into the same flat °F chart row.
 *  Uses the average as the line value and also exposes _min/_max for bands. */
const normalizeBucket = (bucket, range) => {
  const outside = bucket.outside || {};
  const row = {
    time: labelFor(bucket.unix_timestamp, range),
    timestamp: new Date(bucket.unix_timestamp * 1000).toISOString(),
    unix_timestamp: bucket.unix_timestamp,
    // outside_* were stored already in °F (temp_f) — no conversion.
    outdoor_temp: outside.temp_f?.avg ?? null,
    outdoor_humidity: outside.humidity?.avg ?? null,
    weather_description: outside.conditions_last ?? null,
  };
  Object.entries(bucket.sensors || {}).forEach(([name, agg]) => {
    if (!agg || typeof agg.avg !== 'number') return;
    row[name] = celsiusToFahrenheit(agg.avg);
    row[`${name}_min`] = celsiusToFahrenheit(agg.min);
    row[`${name}_max`] = celsiusToFahrenheit(agg.max);
  });
  return row;
};

/**
 * Fetch historical readings for a range, reading from the tier that holds the
 * right resolution and bounding the query by time (never downloads everything).
 * Returns flat, °F, chart-ready rows sorted oldest→newest.
 */
export const fetchHistoricalData = async (range = '24h') => {
  try {
    const cfg = RANGES[range] || RANGES['24h'];
    const cutoffSec = Math.floor(Date.now() / 1000) - cfg.seconds;

    const tierQuery = query(
      ref(database, TIER_PATH[cfg.tier]),
      orderByKey(),
      startAt(String(cutoffSec)),
    );
    const snapshot = await get(tierQuery);
    if (!snapshot.exists()) return [];
    const val = snapshot.val();

    const normalize = cfg.tier === 'raw' ? normalizeRaw : normalizeBucket;
    return Object.values(val)
      .filter(r => r && r.unix_timestamp)
      .sort((a, b) => (a.unix_timestamp || 0) - (b.unix_timestamp || 0))
      .map(r => normalize(r, range));
  } catch (error) {
    console.error('Error fetching historical data:', error);
    return [];
  }
};

// ─────────────────────────── Logs & events ───────────────────────────

/**
 * Fetch system logs — merges the info tier (`logs`) and the longer-retained
 * error tier (`logs_errors`) into one newest-first list.
 */
export const fetchLogs = async () => {
  try {
    const mk = (node) => query(ref(database, `${BASE}/${node}`), orderByKey(), limitToLast(1000));
    const [infoSnap, errSnap] = await Promise.all([get(mk('logs')), get(mk('logs_errors'))]);

    const collect = (snap) => (snap.exists() ? Object.values(snap.val()) : []);
    const all = [...collect(infoSnap), ...collect(errSnap)];

    return all
      .filter(log => log && log.timestamp)
      .sort((a, b) => (b.unix_timestamp || 0) - (a.unix_timestamp || 0)); // newest first
  } catch (error) {
    console.error('Logs fetch error:', error);
    return [];
  }
};

/**
 * Fetch sensor lifecycle events (moved, renamed, offline, online, …), newest
 * first. Optionally filter to a single sensor.
 */
export const fetchSensorEvents = async (sensorId = null) => {
  try {
    const eventsQuery = query(ref(database, `${BASE}/sensor_events`), orderByKey(), limitToLast(500));
    const snapshot = await get(eventsQuery);
    if (!snapshot.exists()) return [];

    let events = Object.values(snapshot.val()).filter(e => e && e.unix_timestamp);
    if (sensorId) events = events.filter(e => e.sensorId === sensorId);
    return events.sort((a, b) => (b.unix_timestamp || 0) - (a.unix_timestamp || 0));
  } catch (error) {
    console.error('Sensor events fetch error:', error);
    return [];
  }
};

/**
 * Record a sensor lifecycle event (e.g. a location move made from Settings).
 */
export const logSensorEvent = async (sensorId, event, extra = {}) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    // push() gives a unique chronological key, so several changes saved in the
    // same second don't overwrite each other.
    await push(ref(database, `${BASE}/sensor_events`), {
      sensorId,
      event,
      timestamp: new Date(now * 1000).toISOString(),
      unix_timestamp: now,
      ...extra,
    });
    return true;
  } catch (error) {
    console.error('Error logging sensor event:', error);
    return false;
  }
};

/**
 * Fetch everything the Stats page needs in one shot: raw (7d), hourly (30d)
 * and daily (up to 1y) readings, plus all-time records and sensor events.
 * Rows are already normalized to flat °F; bucket rows also carry `${name}_min`
 * and `${name}_max` so period min/max can be computed accurately.
 */
export const fetchStatsBundle = async () => {
  const [raw7d, hourly30d, dailyYear, records, events] = await Promise.all([
    fetchHistoricalData('7d'),
    fetchHistoricalData('30d'),
    fetchHistoricalData('1y'),
    fetchRecords(),
    fetchSensorEvents(),
  ]);
  return { raw7d, hourly30d, dailyYear, records, events };
};

/**
 * Fetch all-time records (min/max per sensor + when).
 */
export const fetchRecords = async () => {
  try {
    const snapshot = await get(ref(database, `${BASE}/stats/records`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error('Records fetch error:', error);
    return null;
  }
};

// ─────────────────────────── Orchestration ───────────────────────────

/**
 * Smallest payload to render the Overview fast on first paint.
 */
export const fetchInitialData = async () => {
  const [sensorConfig, latest] = await Promise.all([fetchSensorConfig(), fetchLatestData()]);
  const updatedSensorConfig = await discoverAndEnsureSensors(latest, sensorConfig);
  return { latest, sensorConfig: updatedSensorConfig };
};

/**
 * Larger payloads for Trends and Logs. `range` selects which tier historical
 * data comes from.
 */
export const fetchBackgroundData = async (range = '24h') => {
  const results = await Promise.allSettled([fetchHistoricalData(range), fetchLogs()]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : []);
  return {
    historical: val(results[0]),
    logs: val(results[1]),
  };
};
