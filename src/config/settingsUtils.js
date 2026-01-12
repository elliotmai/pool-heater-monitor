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
 * Check if a sensor is enabled
 */
export const isSensorEnabled = (sensorKey) => {
  const config = cachedSensorConfig?.[sensorKey];
  return config?.enabled !== false; // Default to true
};

/**
 * Get enabled sensors only
 */
export const getEnabledSensors = () => {
  const config = cachedSensorConfig || {};
  return Object.fromEntries(
    Object.entries(config).filter(([_, sensorConfig]) => sensorConfig.enabled !== false)
  );
};