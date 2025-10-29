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
      return {
        ...transformed,
        Blue: celsiusToFahrenheit(transformed.Blue),
        Red: celsiusToFahrenheit(transformed.Red),
        Yellow: celsiusToFahrenheit(transformed.Yellow),
        Green: celsiusToFahrenheit(transformed.Green),
        weather: latestWeather
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching latest data:', error);
    throw error;
  }
};

/**
 * Fetch historical sensor readings with merged weather data
 */
export const fetchHistoricalData = async () => {
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
      // Convert to array and sort by unix_timestamp, then take last 100
      const readings = Object.values(sensorsData)
        .sort((a, b) => (a.unix_timestamp || 0) - (b.unix_timestamp || 0))
        .slice(-100) // Take last 100 readings
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
          
          return {
            time,
            timestamp: reading.timestamp,
            unix_timestamp: reading.unix_timestamp,
            Blue: celsiusToFahrenheit(reading.Blue),
            Red: celsiusToFahrenheit(reading.Red),
            Yellow: celsiusToFahrenheit(reading.Yellow),
            Green: celsiusToFahrenheit(reading.Green),
            outdoor_temp: matchingWeather?.temp_f || null,
            outdoor_humidity: matchingWeather?.humidity || null,
            weather_description: matchingWeather?.description || null
          };
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
export const fetchAllData = async () => {
  const [latest, historical, weatherHistory, logs] = await Promise.all([
    fetchLatestData(),
    fetchHistoricalData(),
    fetchWeatherHistory(),
    fetchLogs()
  ]);

  return { latest, historical, weatherHistory, logs };
};