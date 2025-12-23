// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAuxd7JdNTlZh30J9MoArlWEqFtUsIhqrw",
  authDomain: "water-heater-sensors.firebaseapp.com",
  databaseURL: "https://water-heater-sensors-default-rtdb.firebaseio.com",
  projectId: "water-heater-sensors",
  storageBucket: "water-heater-sensors.firebasestorage.app",
  messagingSenderId: "363833716089",
  appId: "1:363833716089:web:402814303a3ae11ae153a8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database
const database = getDatabase(app);

export { database };