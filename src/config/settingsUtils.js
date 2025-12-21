/**
 * Default settings
 */
const DEFAULT_SETTINGS = {
  location: {
    name: 'Rhome',
    region: 'Texas',
    lat: 33.0258,
    lon: -97.5025
  },
  sensors: {
    Blue: { displayName: 'Blue Sensor', color: '#007aff' },
    Red: { displayName: 'Red Sensor', color: '#ff3b30' },
    Yellow: { displayName: 'Yellow Sensor', color: '#ffcc00' },
    Green: { displayName: 'Green Sensor', color: '#34c759' },
    OriaCH1: { displayName: 'Oria Sensor 1', color: '#8e44ad' },
    OriaCH2: { displayName: 'Oria Sensor 2', color: '#dca225' },
    OriaCH3: { displayName: 'Oria Sensor 3', color: '#f9abdf' },
  }
};

/**
 * Get settings from localStorage or return defaults
 */
export const getSettings = () => {
  try {
    const saved = localStorage.getItem('poolHeaterSettings');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return DEFAULT_SETTINGS;
};

/**
 * Get location settings
 */
export const getLocation = () => {
  const settings = getSettings();
  return settings.location;
};

/**
 * Get sensor configuration
 */
export const getSensorConfig = () => {
  const settings = getSettings();
  return settings.sensors;
};

/**
 * Save settings to localStorage
 */
export const saveSettings = (settings) => {
  try {
    localStorage.setItem('poolHeaterSettings', JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
};