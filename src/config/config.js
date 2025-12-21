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
    displayName: 'Blue Sensor',
    color: '#007aff'
  },
  Red: {
    displayName: 'Red Sensor',
    color: '#ff3b30'
  },
  Yellow: {
    displayName: 'Yellow Sensor',
    color: '#ffcc00'
  },
  Green: {
    displayName: 'Green Sensor',
    color: '#34c759'
  },
  OriaCH1: {
    displayName: 'Oria Sensor 1',
    color: '#8e44ad'
  },
  OriaCH2: {
    displayName: 'Oria Sensor 2',
    color: '#dca225'
  },
  OriaCH3: {
    displayName: 'Oria Sensor 3',
    color: '#f9abdf'
  }
};