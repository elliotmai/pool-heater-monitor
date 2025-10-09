// Application Configuration
export const CONFIG = {
  FIREBASE_URL: 'https://water-heater-sensors-default-rtdb.firebaseio.com',
  WEATHER_API_KEY: 'f8c6c1c8e0d64f5b8a5165045242909',
  LOCATION: 'Rhome ,Texas',
  REFRESH_INTERVAL: 60000, // 5 minutes
};

// Sensor display configuration
export const SENSOR_CONFIG = {
  Blue: {
    displayName: 'Heater Input',
    icon: 'input',
    color: '#007aff'
  },
  Red: {
    displayName: 'Heater Output',
    icon: 'output',
    color: '#ff3b30'
  },
  Yellow: {
    displayName: 'Core Temp',
    icon: 'circle',
    color: '#ffcc00'
  },
  Green: {
    displayName: 'Sand Temp',
    icon: 'terrain',
    color: '#34c759'
  }
};