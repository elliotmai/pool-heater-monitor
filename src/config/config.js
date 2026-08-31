// Application Configuration
export const CONFIG = {
  FIREBASE_URL: 'https://water-heater-sensors-default-rtdb.firebaseio.com/water-heater-user',
  WEATHER_API_KEY: 'f8c6c1c8e0d64f5b8a5165045242909',
  LOCATION: 'Rhome ,Texas',
  REFRESH_INTERVAL: 60000, // 5 minutes
  // The Pi writes a heartbeat row every cycle (~5 min), so roughly three
  // missed cycles means it is off power or internet rather than merely late.
  // Shared so "is the Pi alive?" is answered the same way everywhere.
  PI_SILENT_AFTER_MINS: 16,
};
