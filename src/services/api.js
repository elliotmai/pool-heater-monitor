import { 
  ref, 
  get, 
  // query, 
  // orderByChild, 
  remove } from 'firebase/database';
import { database } from '../config/firebase';
// import { CONFIG } from '../config/config';
import { transformSensorData } from './sensorMapping';

/**
 * Convert Celsius to Fahrenheit
 */
const celsiusToFahrenheit = (celsius) => {
  if (celsius === null || celsius === undefined) return null;
  return (celsius * 9/5) + 32;
};

/**
 * Fetch the latest sensor readings from Firebase
 */
export const fetchLatestData = async () => {
  try {
    const latestRef = ref(database, 'latest');
    const weatherHistoryRef = ref(database, 'weather_history');
    
    const [sensorsSnapshot, weatherSnapshot] = await Promise.all([
      get(latestRef),
      get(weatherHistoryRef)
    ]);
    
    if (!sensorsSnapshot.exists()) {
      throw new Error('Failed to fetch latest data');
    }
    
    const sensorsData = sensorsSnapshot.val();
    const weatherData = weatherSnapshot.exists() ? weatherSnapshot.val() : null;
    
    const transformed = transformSensorData(sensorsData);
    
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
    if (transformed) {
      const converted = { ...transformed };
      
      // Convert each numeric property (temperature sensors) to Fahrenheit
      Object.keys(converted).forEach(key => {
        if (typeof converted[key] === 'number') {
          converted[key] = celsiusToFahrenheit(converted[key]);
        }
      });
      
      converted.weather = latestWeather;
      return converted;
    }
    return null;
  } catch (error) {
    console.error('Error fetching latest data:', error);
    throw error;
  }
};

/**
 * Fetch historical sensor readings with merged weather data
 * Fetches all available data (no filtering by date)
 * @param {Date} targetDate - Not used anymore, kept for API compatibility
 */
export const fetchHistoricalData = async (targetDate = new Date()) => {
  try {
    const readingsRef = ref(database, 'readings');
    const weatherHistoryRef = ref(database, 'weather_history');
    
    const [sensorsSnapshot, weatherSnapshot] = await Promise.all([
      get(readingsRef),
      get(weatherHistoryRef)
    ]);
    
    if (!sensorsSnapshot.exists()) {
      throw new Error('Failed to fetch historical data');
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
        .filter(reading => reading.unix_timestamp) // Only filter out readings without timestamp
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
            // Try to find weather within 5 minutes
            const timestamps = Object.keys(weatherMap).map(Number);
            const closest = timestamps.find(t => 
              Math.abs(t - reading.unix_timestamp) <= 300 // 5 minutes
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
    throw error;
  }
};

/**
 * Fetch system logs from Firebase
 */
export const fetchLogs = async () => {
  try {
    const logsRef = ref(database, 'logs');
    const snapshot = await get(logsRef);
    
    if (!snapshot.exists()) return [];
    
    const data = snapshot.val();
    
    if (data) {
      // Filter to last 7 days based on timestamp field
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoffTime = sevenDaysAgo.getTime();
      
      // Convert to array, filter by last 7 days, and reverse (newest first)
      return Object.values(data)
        .filter(log => {
          if (!log.timestamp) return false;
          const logTime = new Date(log.timestamp).getTime();
          return logTime >= cutoffTime;
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
    return [];
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
    const weatherHistoryRef = ref(database, 'weather_history');
    const snapshot = await get(weatherHistoryRef);
    
    if (!snapshot.exists()) return [];
    
    const data = snapshot.val();
    
    if (data) {
      return Object.values(data)
        .sort((a, b) => a.unix_timestamp - b.unix_timestamp)
        .slice(-100) // Take last 100 weather records
        .map(weather => ({
          ...weather,
          timestamp: weather.timestamp || new Date(weather.unix_timestamp * 1000).toISOString()
        }));
    }
    return [];
  } catch (error) {
    console.error('Weather history fetch error:', error);
    return [];
  }
};

/**
 * Delete records older than 7 days from Firebase tables
 * Uses Firebase SDK for proper database operations
 */
export const cleanupOldRecords = async () => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffTimestamp = Math.floor(sevenDaysAgo.getTime() / 1000); // Convert to Unix timestamp

  const tables = ['logs', 'readings', 'weather_history'];
  const results = {
    success: [],
    errors: []
  };

  for (const table of tables) {
    try {
      const tableRef = ref(database, table);
      const snapshot = await get(tableRef);
      
      if (!snapshot.exists()) {
        results.success.push({ table, deletedCount: 0 });
        continue;
      }

      const data = snapshot.val();
      
      // Find records to delete
      const keysToDelete = [];
      Object.entries(data).forEach(([key, record]) => {
        let recordTimestamp;
        
        // Handle different timestamp formats
        if (record.unix_timestamp) {
          recordTimestamp = record.unix_timestamp;
        } else if (record.timestamp) {
          recordTimestamp = Math.floor(new Date(record.timestamp).getTime() / 1000);
        } else {
          return; // Skip records without timestamp
        }

        if (recordTimestamp < cutoffTimestamp) {
          keysToDelete.push(key);
        }
      });

      // Delete old records using Firebase SDK
      let deletedCount = 0;
      for (const key of keysToDelete) {
        const recordRef = ref(database, `${table}/${key}`);
        await remove(recordRef);
        deletedCount++;
      }

      results.success.push({ 
        table, 
        deletedCount,
        totalRecords: Object.keys(data).length 
      });

    } catch (error) {
      results.errors.push({ 
        table, 
        error: error.message 
      });
    }
  }

  return results;
};

/**
 * Fetch all data in parallel
 */
export const fetchAllData = async (targetDate) => {

  const [latest, historical, weatherHistory, logs] = await Promise.all([
    fetchLatestData(),
    fetchHistoricalData(targetDate),
    fetchWeatherHistory(),
    fetchLogs()
  ]);

  cleanupOldRecords();
  // console.log('Cleanup results:', deletedRecords);

  return { latest, historical, weatherHistory, logs };
};