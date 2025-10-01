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
 * Fetch historical sensor readings (last 48 data points)
 */
export const fetchHistoricalData = async () => {
  try {
    const response = await fetch(
      `${CONFIG.FIREBASE_URL}/readings.json?orderBy="unix_timestamp"&limitToLast=48`
    );
    if (!response.ok) throw new Error('Failed to fetch historical data');
    const data = await response.json();
    
    if (data) {
      // Convert to array and sort by unix_timestamp
      const readings = Object.values(data)
        .sort((a, b) => (a.unix_timestamp || 0) - (b.unix_timestamp || 0))
        .map(reading => {
          const date = new Date(reading.timestamp);
          const time = date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
          });
          
          const transformed = transformSensorData(reading);
          return {
            ...transformed,
            time,
            Blue: celsiusToFahrenheit(transformed.Blue),
            Red: celsiusToFahrenheit(transformed.Red),
            Yellow: celsiusToFahrenheit(transformed.Yellow),
            Green: celsiusToFahrenheit(transformed.Green)
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
 * Get coordinates for location (Plano, Texas)
 */
const getCoordinates = () => {
  // Rhome, Texas coordinates
  return { lat: 33.0258, lon: -97.5025 };
};

/**
 * Fetch current weather data from weather.gov
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
    console.log('Latest weather observation:', obs);
    
    // Convert temperatures to Fahrenheit
    const tempC = obs.temperature?.value || 0;
    const tempF = tempC ? (tempC * 9/5) + 32 : 0;
    
    const feelsLikeC = obs.heatIndex?.value || obs.windChill?.value || tempC;
    const feelsLikeF = feelsLikeC ? (feelsLikeC * 9/5) + 32 : tempF;
    
    // Calculate UV estimate
    const uvIndex = calculateUVFromTime();
    
    // Transform to match our expected format
    return {
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
        uv: uvIndex,
        condition: {
          text: obs.textDescription || 'Clear',
          icon: obs.icon || ''
        }
      }
    };
  } catch (error) {
    console.error('Weather API error:', error);
    // Return fallback data instead of null
    return {
      location: {
        name: 'Rhome',
        region: 'Texas'
      },
      current: {
        temp_f: 75,
        temp_c: 24,
        feelslike_f: 75,
        feelslike_c: 24,
        humidity: 50,
        uv: calculateUVFromTime(),
        condition: {
          text: 'Weather data unavailable',
          icon: ''
        }
      }
    };
  }
};

/**
 * Calculate estimated UV index based on time of day
 * This is a rough estimate since weather.gov doesn't provide UV index directly
 */
const calculateUVFromTime = () => {
  const hour = new Date().getHours();
  
  // UV peaks around noon
  if (hour >= 10 && hour <= 14) {
    return 8; // High
  } else if (hour >= 8 && hour <= 16) {
    return 5; // Moderate
  } else if (hour >= 6 && hour <= 18) {
    return 3; // Low
  } else {
    return 0; // Night
  }
};

/**
 * Fetch system logs from Firebase
 */
export const fetchLogs = async () => {
  try {
    const response = await fetch(
      `${CONFIG.FIREBASE_URL}/logs.json?orderBy="$key"&limitToLast=50`
    );
    if (!response.ok) return [];
    const data = await response.json();
    
    if (data) {
      // Convert to array and reverse (newest first)
      return Object.values(data).reverse();
    }
    return [];
  } catch (error) {
    console.error('Logs fetch error:', error);
    return [];
  }
};

/**
 * Fetch all data in parallel
 */
export const fetchAllData = async () => {
  const [latest, historical, weather, logs] = await Promise.all([
    fetchLatestData(),
    fetchHistoricalData(),
    fetchWeatherData(),
    fetchLogs()
  ]);

  return { latest, historical, weather, logs };
};