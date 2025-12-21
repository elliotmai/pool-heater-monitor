import { CONFIG } from '../config/config';
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
    const [sensorsResponse, weatherResponse] = await Promise.all([
      fetch(`${CONFIG.FIREBASE_URL}/latest.json`),
      fetch(`${CONFIG.FIREBASE_URL}/weather_history.json`)
    ]);
    
    if (!sensorsResponse.ok) throw new Error('Failed to fetch latest data');
    
    const sensorsData = await sensorsResponse.json();
    const weatherData = weatherResponse.ok ? await weatherResponse.json() : null;
    
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
 * Fetches 48 hours of data: the target date and the day before
 * @param {Date} targetDate - The date to fetch data for (defaults to today)
 */
export const fetchHistoricalData = async (targetDate = new Date()) => {
  try {
    const [sensorsResponse, weatherResponse] = await Promise.all([
      fetch(`${CONFIG.FIREBASE_URL}/readings.json`),
      fetch(`${CONFIG.FIREBASE_URL}/weather_history.json`)
    ]);
    
    if (!sensorsResponse.ok) throw new Error('Failed to fetch historical data');
    
    const sensorsData = await sensorsResponse.json();
    const weatherData = weatherResponse.ok ? await weatherResponse.json() : null;
    
    // Create a map of weather data by timestamp
    const weatherMap = {};
    if (weatherData) {
      Object.values(weatherData).forEach(weather => {
        weatherMap[weather.unix_timestamp] = weather;
      });
    }
    
    if (sensorsData) {
      // Calculate the start of the day before target date and end of target date
      const dayBefore = new Date(targetDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      dayBefore.setHours(0, 0, 0, 0);
      
      const endOfTargetDay = new Date(targetDate);
      endOfTargetDay.setHours(23, 59, 59, 999);
      
      const startTimestamp = dayBefore.getTime();
      const endTimestamp = endOfTargetDay.getTime();

      // Filter readings for the 48-hour period and sort by unix_timestamp
      const readings = Object.values(sensorsData)
        .filter(reading => {
          if (!reading.unix_timestamp) return false;
          const readingTime = reading.unix_timestamp * 1000;
          return readingTime >= startTimestamp && readingTime <= endTimestamp;
        })
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
    const response = await fetch(
      `${CONFIG.FIREBASE_URL}/logs.json`
    );
    if (!response.ok) return [];
    const data = await response.json();
    
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
    const response = await fetch(
      `${CONFIG.FIREBASE_URL}/weather_history.json`
    );
    if (!response.ok) return [];
    const data = await response.json();
    
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
 * Fetch all data in parallel
 */
export const fetchAllData = async (targetDate) => {
  const [latest, historical, weatherHistory, logs] = await Promise.all([
    fetchLatestData(),
    fetchHistoricalData(targetDate),
    fetchWeatherHistory(),
    fetchLogs()
  ]);

  return { latest, historical, weatherHistory, logs };
};