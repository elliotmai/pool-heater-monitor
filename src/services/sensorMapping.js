// Sensor mapping utilities
// Directly use color names as they come from Firebase
export const transformSensorData = (firebaseData) => {
  if (!firebaseData) return null;
  
  // Firebase data already has Blue, Red, Yellow, Green as keys
  return {
    timestamp: firebaseData.timestamp,
    unix_timestamp: firebaseData.unix_timestamp,
    Blue: firebaseData.Blue || null,
    Red: firebaseData.Red || null,
    Yellow: firebaseData.Yellow || null,
    Green: firebaseData.Green || null
  };
};