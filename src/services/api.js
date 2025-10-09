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
    const response = await fetch(`${CONFIG.FIREBASE_URL}/latest.json`);
    if (!response.ok) throw new Error('Failed to fetch latest data');
    const data = await response.json();
    const transformed = transformSensorData(data);
    
    // Convert all temperatures to Fahrenheit
    if (transformed) {
      return {
        ...transformed,
        Blue: celsiusToFahrenheit(transformed.Blue),
        Red: celsiusToFahrenheit(transformed.Red),
        Yellow: celsiusToFahrenheit(transformed.Yellow),
        Green: celsiusToFahrenheit(transformed.Green)
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
      fetch(`${CONFIG.FIREBASE_URL}/readings.json?orderBy="unix_timestamp"`),
      fetch(`${CONFIG.FIREBASE_URL}/weather_history.json?orderBy="unix_timestamp"`)
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
      // Convert to array and sort by unix_timestamp
      const readings = Object.values(sensorsData)
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
 * Get coordinates for location (Rhome, Texas)
 */
const getCoordinates = () => {
  // Rhome, Texas coordinates
  return { lat: 33.0258, lon: -97.5025 };
};

/**
 * Write weather data to Firebase under /weather_history
 */
const writeWeatherToFirebase = async (weatherData) => {
  try {
    const timestamp = Date.now();
    const isoTimestamp = new Date().toISOString();
    
    const weatherRecord = {
      timestamp: isoTimestamp,
      unix_timestamp: Math.floor(timestamp / 1000),
      temp_f: weatherData.current.temp_f,
      temp_c: weatherData.current.temp_c,
      humidity: weatherData.current.humidity,
      description: weatherData.current.condition.text,
      icon: weatherData.current.condition.icon
    };
    
    // Write to /weather_history/{unix_timestamp}
    const response = await fetch(
      `${CONFIG.FIREBASE_URL}/weather_history/${weatherRecord.unix_timestamp}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(weatherRecord)
      }
    );
    
    if (response.ok) {
      console.log('Weather data written to Firebase');
    }
  } catch (error) {
    console.error('Error writing weather to Firebase:', error);
  }
};

/**
 * Fetch current weather data from weather.gov and write to Firebase
 */
export const fetchWeatherData = async () => {
  try {
    const { lat, lon } = getCoordinates();
    
    // First, get the grid point data
    const pointsResponse = await fetch(
      `https://api.weather.gov/points/${lat},${lon}`
    );
    
    if (!pointsResponse.ok) {
      console.error('Weather.gov points API failed:', pointsResponse.status);
      return null;
    }
    
    const pointsData = await pointsResponse.json();
    
    // Get observation stations
    const observationStationsUrl = pointsData.properties.observationStations;
    
    const stationsResponse = await fetch(observationStationsUrl);
    
    if (!stationsResponse.ok) {
      console.error('Weather.gov stations API failed:', stationsResponse.status);
      return null;
    }
    
    const stationsData = await stationsResponse.json();
    const firstStationUrl = stationsData.features[0]?.id;
    
    if (!firstStationUrl) {
      console.error('No weather station found');
      return null;
    }
    
    // Get latest observation
    const observationResponse = await fetch(
      `${firstStationUrl}/observations/latest`
    );
    
    if (!observationResponse.ok) {
      console.error('Weather.gov observation API failed:', observationResponse.status);
      return null;
    }
    
    const observationData = await observationResponse.json();
    const obs = observationData.properties;
    
    // Convert temperatures to Fahrenheit
    const tempC = obs.temperature?.value || 0;
    const tempF = tempC ? (tempC * 9/5) + 32 : 0;
    
    const feelsLikeC = obs.heatIndex?.value || obs.windChill?.value || tempC;
    const feelsLikeF = feelsLikeC ? (feelsLikeC * 9/5) + 32 : tempF;
    
    // Transform to match our expected format
    const weatherData = {
      location: {
        name: 'Rhome',
        region: 'Texas'
      },
      current: {
        temp_f: parseFloat(tempF.toFixed(1)),
        temp_c: parseFloat(tempC.toFixed(1)),
        feelslike_f: parseFloat(feelsLikeF.toFixed(1)),
        feelslike_c: parseFloat(feelsLikeC.toFixed(1)),
        humidity: Math.round(obs.relativeHumidity?.value || 0),
        condition: {
          text: obs.textDescription || 'Clear',
          icon: obs.icon || ''
        }
      }
    };
    
    // Write weather data to Firebase
    await writeWeatherToFirebase(weatherData);
    
    return weatherData;
  } catch (error) {
    console.error('Weather API error:', error);
    // Return fallback data instead of null
    return {
      location: {
        name: 'Rhome',
        region: 'Texas'
      },
      current: {
        temp_f: 0,
        temp_c: 0,
        feelslike_f: 0,
        feelslike_c: 0,
        humidity: 0,
        condition: {
          text: 'Weather data unavailable',
          icon: ''
        }
      }
    };
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
      `${CONFIG.FIREBASE_URL}/weather_history.json?orderBy="unix_timestamp"`
    );
    if (!response.ok) return [];
    const data = await response.json();
    
    if (data) {
      return Object.values(data)
        .sort((a, b) => a.unix_timestamp - b.unix_timestamp)
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
  const [latest, historical, weather, weatherHistory, logs] = await Promise.all([
    fetchLatestData(),
    fetchHistoricalData(),
    fetchWeatherData(),
    fetchWeatherHistory(),
    fetchLogs()
  ]);

  return { latest, historical, weather, weatherHistory, logs };
};