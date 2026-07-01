import {
  ref,
  get,
  set,
  update,
  query,
  orderByKey,
  limitToLast } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * Convert Celsius to Fahrenheit
 */
const celsiusToFahrenheit = (celsius) => {
  if (celsius === null || celsius === undefined) return null;
  return (celsius * 9/5) + 32;
};

/**
 * Fetch sensor configuration from Firebase
 * This is the source of truth for sensor metadata
 */
export const fetchSensorConfig = async () => {
  try {
    const sensorsRef = ref(database, 'water-heater-user/sensors');
    const snapshot = await get(sensorsRef);
    
    if (!snapshot.exists()) {
      return {};
    }
    
    const sensorsData = snapshot.val();
    
    // Transform to the format expected by the app
    const sensorConfig = {};
    Object.entries(sensorsData).forEach(([sensorId, config]) => {
      sensorConfig[sensorId] = {
        displayName: config.displayName || sensorId,
        color: config.color || '#007aff',
        enabled: config.alive !== false // Use 'alive' from DB as 'enabled' in app
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
    const sensorRef = ref(database, `water-heater-user/sensors/${sensorId}`);
    
    // Map app's 'enabled' to DB's 'alive'
    const dbConfig = {
      displayName: config.displayName,
      color: config.color,
      alive: config.enabled !== false
    };
    
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
    const sensorRef = ref(database, `water-heater-user/sensors/${sensorId}`);
    
    const dbConfig = {
      displayName: config.displayName || sensorId,
      color: config.color || '#007aff',
      alive: config.enabled !== false
    };
    
    await set(sensorRef, dbConfig);
    return true;
  } catch (error) {
    console.error('Error creating sensor config:', error);
    return false;
  }
};

/**
 * Discover sensors from Firebase data and ensure they exist in sensor config
 * Auto-creates sensor config entries for any new sensors found in readings
 */
const discoverAndEnsureSensors = async (firebaseData, currentSensorConfig) => {
  if (!firebaseData) return currentSensorConfig;

  const excludedKeys = ['timestamp', 'unix_timestamp', 'weather'];
  const sensorKeys = Object.keys(firebaseData).filter(
    key => !excludedKeys.includes(key) && typeof firebaseData[key] === 'number'
  );

  const DEFAULT_COLORS = [
    '#007aff', '#ff3b30', '#ffcc00', '#34c759', '#8e44ad',
    '#dca225', '#f9abdf', '#00d4ff', '#ff6b6b', '#4ecdc4'
  ];

  let hasNewSensors = false;
  const newSensorConfig = { ...currentSensorConfig };
  let colorIndex = Object.keys(currentSensorConfig).length;

  // Check for sensors that don't have config entries
  for (const sensorKey of sensorKeys) {
    if (!currentSensorConfig[sensorKey]) {
      hasNewSensors = true;
      const config = {
        displayName: sensorKey.replace(/([A-Z])/g, ' $1').trim(),
        color: DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length],
        enabled: true
      };
      
      newSensorConfig[sensorKey] = config;
      
      // Create the sensor config in Firebase
      await createSensorConfig(sensorKey, config);
      
      colorIndex++;
    }
  }

  return hasNewSensors ? newSensorConfig : currentSensorConfig;
};

/**
 * Fetch the latest sensor readings from Firebase
 */
export const fetchLatestData = async () => {
  try {
    const latestRef = ref(database, 'water-heater-user/latest');
    const weatherHistoryRef = ref(database, 'water-heater-user/weather_history');
    
    const [sensorsSnapshot, weatherSnapshot] = await Promise.all([
      get(latestRef),
      get(weatherHistoryRef)
    ]);
    
    if (!sensorsSnapshot.exists()) {
      throw new Error('Failed to fetch latest data');
    }
    
    const sensorsData = sensorsSnapshot.val();
    const weatherData = weatherSnapshot.exists() ? weatherSnapshot.val() : null;
    
    // Get the latest weather reading
    let latestWeather = null;
    if (weatherData) {
      const weatherArray = Object.values(weatherData)
        .sort((a, b) => b.unix_timestamp - a.unix_timestamp);
      if (weatherArray.length > 0) {
        latestWeather = weatherArray[0];
      }
    }
    
    // Convert all temperatures to Fahrenheit
    const converted = {
      timestamp: sensorsData.timestamp,
      unix_timestamp: sensorsData.unix_timestamp,
    };
    
    Object.keys(sensorsData).forEach(key => {
      if (typeof sensorsData[key] === 'number' && key !== 'unix_timestamp') {
        converted[key] = celsiusToFahrenheit(sensorsData[key]);
      }
    });
    
    converted.weather = latestWeather;
    return converted;
  } catch (error) {
    console.error('Error fetching latest data:', error);
    throw error;
  }
};

/**
 * Fetch historical sensor readings with merged weather data
 */
export const fetchHistoricalData = async (targetDate = new Date()) => {
  try {
    const readingsRef = ref(database, 'water-heater-user/readings');
    const weatherQuery = query(
      ref(database, 'water-heater-user/weather_history'),
      orderByKey(),
      limitToLast(500)
    );

    const [sensorsSnapshot, weatherSnapshot] = await Promise.all([
      get(readingsRef),
      get(weatherQuery)
    ]);
    
    if (!sensorsSnapshot.exists()) {
      return []; // no readings yet — return empty instead of throwing (would blank weather+logs too)
    }
    
    const sensorsData = sensorsSnapshot.val();
    const weatherData = weatherSnapshot.exists() ? weatherSnapshot.val() : null;
    
    // Create a map of weather data by timestamp
    const weatherMap = {};
    if (weatherData) {
      Object.values(weatherData).forEach(weather => {
        weatherMap[weather.unix_timestamp] = weather;
      });
    }
    
    if (sensorsData) {
      // Load ALL readings and sort by unix_timestamp
      const readings = Object.values(sensorsData)
        .filter(reading => reading.unix_timestamp)
        .sort((a, b) => (a.unix_timestamp || 0) - (b.unix_timestamp || 0))
        .map(reading => {
          const date = new Date(reading.timestamp);
          const time = date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
          });

          // Find matching weather data (within 5 minutes)
          let matchingWeather = weatherMap[reading.unix_timestamp];
          if (!matchingWeather) {
            const timestamps = Object.keys(weatherMap).map(Number);
            const closest = timestamps.find(t => 
              Math.abs(t - reading.unix_timestamp) <= 300
            );
            if (closest) {
              matchingWeather = weatherMap[closest];
            }
          }
          
          // Build base result object
          const result = {
            time,
            timestamp: reading.timestamp,
            unix_timestamp: reading.unix_timestamp,
          };

          // Convert all numeric sensor values to Fahrenheit
          Object.keys(reading).forEach(key => {
            if (typeof reading[key] === 'number' && key !== 'unix_timestamp') {
              result[key] = celsiusToFahrenheit(reading[key]);
            }
          });

          // Add weather data
          result.outdoor_temp = matchingWeather?.temp_f || null;
          result.outdoor_humidity = matchingWeather?.humidity || null;
          result.weather_description = matchingWeather?.description || null;

          return result;
        });

      return readings;
    }
    return [];
  } catch (error) {
    console.error('Error fetching historical data:', error);
    return [];
  }
};

/**
 * Fetch system logs from Firebase
 */
export const fetchLogs = async () => {
  try {
    const logsQuery = query(
      ref(database, 'water-heater-user/logs'),
      orderByKey(),
      limitToLast(2000)
    );
    const snapshot = await get(logsQuery);

    if (!snapshot.exists()) return [];

    const data = snapshot.val();
    if (!data) return [];

    return Object.values(data)
      .filter(log => log && log.timestamp)                              // keep entries that have a timestamp
      .sort((a, b) => (b.unix_timestamp || 0) - (a.unix_timestamp || 0)); // newest first, by unix_timestamp
  } catch (error) {
    console.error('Logs fetch error:', error);
    return [];
  }
};

/**
 * Fetch weather history from Firebase
 */
export const fetchWeatherHistory = async () => {
  try {
    const weatherQuery = query(
      ref(database, 'water-heater-user/weather_history'),
      orderByKey(),
      limitToLast(5000)
    );
    const snapshot = await get(weatherQuery);

    if (!snapshot.exists()) return [];

    const data = snapshot.val();
    if (!data) return [];

    return Object.values(data)
      .sort((a, b) => (a.unix_timestamp || 0) - (b.unix_timestamp || 0))
      .map(weather => ({
        ...weather,
        timestamp: weather.timestamp || new Date(weather.unix_timestamp * 1000).toISOString()
      }));
  } catch (error) {
    console.error('Weather history fetch error:', error);
    return [];
  }
};

/**
 * Fetch the smallest critical payload needed to render the Overview tab.
 * Used to unblock the UI as fast as possible on first paint.
 */
export const fetchInitialData = async () => {
  const [sensorConfig, latest] = await Promise.all([
    fetchSensorConfig(),
    fetchLatestData()
  ]);

  const updatedSensorConfig = await discoverAndEnsureSensors(latest, sensorConfig);

  return {
    latest,
    sensorConfig: updatedSensorConfig
  };
};

/**
 * Fetch the larger payloads needed for the Trends and Logs tabs.
 * Runs after fetchInitialData so the Overview is already visible.
 */
export const fetchBackgroundData = async (targetDate) => {
  // allSettled (not all): if one fetch fails, keep the others instead of
  // discarding everything.
  const results = await Promise.allSettled([
    fetchHistoricalData(targetDate),
    fetchWeatherHistory(),
    fetchLogs()
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : []);

  return {
    historical: val(results[0]),
    weatherHistory: val(results[1]),
    logs: val(results[2]),
  };
};