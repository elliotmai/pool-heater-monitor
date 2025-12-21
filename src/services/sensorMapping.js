// Sensor mapping utilities
export const transformSensorData = (firebaseData) => {
  if (!firebaseData) return null;
  
  return {
    timestamp: firebaseData.timestamp,
    unix_timestamp: firebaseData.unix_timestamp,
    Blue: firebaseData.Blue || null,
    Red: firebaseData.Red || null,
    Yellow: firebaseData.Yellow || null,
    Green: firebaseData.Green || null,
    OriaCH1: firebaseData.OriaCH1 || null,
    OriaCH2: firebaseData.OriaCH2 || null,
    OriaCH3: firebaseData.OriaCH3 || null
  };
};