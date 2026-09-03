/**
 * Settings utilities for working with Firebase-based sensor configuration
 * Sensor config is now stored in Firebase at /water-heater-user/sensors
 * This file provides helper functions for accessing the config
 */

// Global variable to cache sensor config fetched from Firebase
let cachedSensorConfig = null;

/**
 * Set the sensor configuration (called by App.js after fetching from Firebase)
 */
export const setSensorConfig = (config) => {
  cachedSensorConfig = config;
};

/**
 * Get the current sensor configuration
 */
export const getSensorConfig = () => {
  return cachedSensorConfig || {};
};

/**
 * Get all sensor keys that have been discovered
 */
export const getDiscoveredSensors = () => {
  return Object.keys(cachedSensorConfig || {});
};

/**
 * Is this a sensor the rest of the app should show?
 *
 * Disabled sensors are kept off every screen except Settings, which is where
 * they get switched back on. The Pi knows nothing about this flag — it keeps
 * recording whatever it hears — so this predicate is the only thing keeping a
 * disabled sensor out of the charts, stats, records and exports.
 *
 * Pass `config` explicitly when you hold it as a prop; it defaults to the
 * cached copy App fetched.
 *
 * A key with no config entry counts as enabled. The Pi writes a newly heard
 * sensor's readings a cycle before its config row exists, so treating unknown
 * keys as disabled would make new sensors invisible rather than merely unnamed.
 */
export const isSensorEnabled = (sensorKey, config = cachedSensorConfig) =>
  config?.[sensorKey]?.enabled !== false;

/**
 * Keep only the enabled entries of a `{ sensorKey: config }` map — the sensor
 * list every screen but Settings should render.
 */
export const getEnabledSensors = (config = cachedSensorConfig) =>
  Object.fromEntries(
    Object.entries(config || {}).filter(([key]) => isSensorEnabled(key, config))
  );

/**
 * Drop disabled sensors from a list of sensor keys. Stats discovers its keys
 * from the readings themselves rather than from the config, so it needs to
 * filter the keys instead of the config map.
 */
export const enabledSensorKeys = (keys, config = cachedSensorConfig) =>
  [...keys].filter((key) => isSensorEnabled(key, config));
