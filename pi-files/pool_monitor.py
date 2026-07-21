import os
import glob
import time
import json
import requests
import subprocess
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, db

# Initialize the DS18B20 sensors
os.system('modprobe w1-gpio')
os.system('modprobe w1-therm')

# Initialize Firebase Admin SDK with your service account
cred = credentials.Certificate('/home/pi/Desktop/water-heater-sensors-firebase-adminsdk-fbsvc-0a078f1c90.json')
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://water-heater-sensors-default-rtdb.firebaseio.com'
})

def log_to_db(level, message):
    """Log messages to Firebase database"""
    try:
        ref = db.reference('/water-heater-user/logs')
        timestamp = datetime.now().isoformat()
        unix_timestamp = int(time.time())
       
        log_entry = {
            'timestamp': timestamp,
            'unix_timestamp': unix_timestamp,
            'level': level,
            'message': message
        }
       
        ref.child(str(unix_timestamp)).set(log_entry)
        print(f"[{level}] {message}")
    except Exception as e:
        # Fallback to console if Firebase logging fails
        print(f"[{level}] {message}")
        print(f"(Failed to log to Firebase: {e})")

# Load sensor mappings from JSON file
def load_sensor_mappings():
    """Load sensor name mappings from sensors.json"""
    try:
        with open('/home/pi/Desktop/sensors.json', 'r') as f:
            mappings = json.load(f)
        print(f"[INFO] Loaded {len(mappings)} sensor mapping(s) from sensors.json")
        return mappings
    except FileNotFoundError:
        print("[WARNING] sensors.json not found. Using sensor IDs as names.")
        return {}
    except json.JSONDecodeError as e:
        print(f"[ERROR] Error parsing sensors.json: {e}")
        return {}

SENSOR_NAMES = load_sensor_mappings()

base_dir = '/sys/bus/w1/devices/'

def get_device_folders():
    """Get all DS18B20 sensor device folders"""
    return glob.glob(base_dir + '28*')

def read_temp_raw(device_file):
    """Read raw temperature data from sensor"""
    with open(device_file, 'r') as f:
        lines = f.readlines()
    return lines

def read_temp(device_folder):
    """Read temperature from a DS18B20 sensor"""
    device_file = device_folder + '/w1_slave'
   
    try:
        lines = read_temp_raw(device_file)
       
        # Retry if CRC check fails
        retries = 0
        while lines[0].strip()[-3:] != 'YES' and retries < 5:
            time.sleep(0.2)
            lines = read_temp_raw(device_file)
            retries += 1
       
        if retries >= 5:
            return None
       
        equals_pos = lines[1].find('t=')
        if equals_pos != -1:
            temp_string = lines[1][equals_pos+2:]
            temp_c = float(temp_string) / 1000.0
            return temp_c
    except Exception as e:
        print(f"[ERROR] Error reading temperature: {e}")
        return None
   
    return None

def read_all_sensors():
    """Read all DS18B20 sensors and return as dictionary with sensor names (not IDs)"""
    readings = {}
    device_folders = get_device_folders()
   
    if not device_folders:
        print("[WARNING] No DS18B20 sensors found!")
   
    for device in device_folders:
        sensor_id = device.split('/')[-1]
        sensor_name = SENSOR_NAMES.get(sensor_id, sensor_id)
        temp = read_temp(device)
       
        if temp is not None:
            readings[sensor_name] = round(temp, 2)
        else:
            readings[sensor_name] = None
            print(f"[WARNING] Failed to read {sensor_name} ({sensor_id})")
   
    return readings

def read_rtl433_sensors(duration=30):
    """
    Read 433MHz sensors using rtl_433
    Only logs data from sensors where model contains "Oria-"
   
    Args:
        duration: How long to listen for sensor data (seconds)
   
    Returns:
        Tuple of (readings dict, error message or None)
    """
    readings = {}
    non_weather_readings = {}
   
    try:
        print(f'[INFO] Starting RTL-SDR scan for {duration} seconds (filtering for Oria sensors)...')
        
        # Find rtl_433 executable
        rtl_path = None
        possible_paths = [
            '/home/pi/rtl_433/build/src/rtl_433',
            '/usr/local/bin/rtl_433',
            '/usr/bin/rtl_433',
            'rtl_433'
        ]
        
        for path in possible_paths:
            try:
                result = subprocess.run(
                    [path, '-h'],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=2
                )
                
                rtl433_path = path
                print(f"[INFO] Found rtl_433 at: {path}")
                break
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
            
        if not rtl433_path:
            return readings, 'rtl_433 command not found in possible paths', non_weather_readings
       
        # Run rtl_433 with JSON output
        cmd = [
            rtl433_path,
            '-F', 'json',
            '-T', str(duration),
            '-M', 'time:iso',
            '-f', '433.92M',
            '-s', '250k'
        ]
       
        # Print the command being run
        print(f"Running command: {' '.join(cmd)}")
       
        # Run the command and capture output
        # Capture stdout but suppress stderr to avoid bitbuffer warnings
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=duration + 10
        )
       
        # Parse the JSON output line by line
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
           
            # Skip warning messages from rtl_433
            if 'Warning:' in line or 'bitbuffer_add_bit' in line:
                continue
           
            # Only process lines that look like JSON (start with {)
            if not line.strip().startswith('{'):
                continue
               
            try:
                data = json.loads(line)
                
                print(data)
                
                model = data.get('model', 'Unknown')
                sensor_id = data.get('id')
                
                if not data.get('temperature'):
                    sensor_name = f"{model}"
                    non_weather_readings[sensor_name] = data
                    continue
               
                # FILTER: Only process sensors where model contains "Oria-"
                if 'Oria-' in model and sensor_id:
                    sensor_name = f"OriaID{sensor_id}"
                elif not sensor_id or not model:
                    continue
                else:
                    sensor_name = f"{model}"
               
                # Extract temperature (prefer Celsius, but Oria uses 'temperature' field)
                temp_c = data.get('temperature_C') or data.get('temperature')
                if temp_c is None:
                    temp_f = data.get('temperature_F')
                    if temp_f is not None:
                        temp_c = (temp_f - 32) * 5/9
               
                if temp_c is not None:
                    # Update existing sensor or add new one (keeps latest reading)
                    readings[sensor_name] = {
                        'temperature_c': round(temp_c, 2)
                    }
                   
                    print(f"  ✓ Sensor: {sensor_name} = {temp_c:.2f}°C")
               
            except json.JSONDecodeError as e:
                # Skip lines that aren't valid JSON (silently)
                continue
            except Exception as e:
                # Log unexpected errors but continue processing
                print(f"  ! Error parsing line: {e}")
                continue
       
        if readings:
            print(f'[INFO] Found {len(readings)} sensor(s)')
        else:
            print('[WARNING] No sensors detected during scan')
       
        return readings, None, non_weather_readings
       
    except subprocess.TimeoutExpired:
        return readings, 'RTL-433 command timed out', non_weather_readings
    except FileNotFoundError:
        return readings, 'rtl_433 command not found. Please install rtl_433.', non_weather_readings
    except Exception as e:
        return readings, f'Error reading RTL-433 sensors: {e}', non_weather_readings

def get_location_from_ip():
    """Get location information based on public IP address"""
    try:
        # Use ipapi.co for geolocation (free, no API key needed)
        response = requests.get('https://ipapi.co/json/', timeout=10)
       
        if not response.ok:
            print(f'[WARNING] IP geolocation failed: {response.status_code}')
            return None
       
        data = response.json()
       
        location = {
            'name': data.get('city', 'Unknown'),
            'region': data.get('region', 'Unknown'),
            'lat': float(data.get('latitude', 0)),
            'lon': float(data.get('longitude', 0)),
            'country': data.get('country_name', 'Unknown')
        }
       
        print(f"[INFO] Location detected: {location['name']}, {location['region']}")
        return location
       
    except requests.exceptions.RequestException as e:
        print(f'[ERROR] IP geolocation request error: {e}')
        return None
    except Exception as e:
        print(f'[ERROR] Location detection error: {e}')
        return None

def get_weather_from_weathergov(lat, lon):
    """Fetch weather data from weather.gov API"""
    try:
        # Get grid point data
        points_url = f"https://api.weather.gov/points/{lat},{lon}"
        headers = {'User-Agent': 'PoolHeaterMonitor/1.0 (contact@example.com)'}
       
        points_response = requests.get(points_url, headers=headers, timeout=10)
        if not points_response.ok:
            print(f'[WARNING] Weather.gov points API failed: {points_response.status_code}')
            return None
       
        points_data = points_response.json()
       
        # Get observation stations
        observation_stations_url = points_data['properties']['observationStations']
        stations_response = requests.get(observation_stations_url, headers=headers, timeout=10)
       
        if not stations_response.ok:
            print(f'[WARNING] Weather.gov stations API failed: {stations_response.status_code}')
            return None
       
        stations_data = stations_response.json()
       
        if not stations_data.get('features') or len(stations_data['features']) == 0:
            print('[WARNING] No weather stations found')
            return None
           
        first_station_url = stations_data['features'][0]['id']
       
        # Get latest observation
        observation_url = f"{first_station_url}/observations/latest"
        observation_response = requests.get(observation_url, headers=headers, timeout=10)
       
        if not observation_response.ok:
            print(f'[WARNING] Weather.gov observation API failed: {observation_response.status_code}')
            return None
       
        observation_data = observation_response.json()
        obs = observation_data['properties']
       
        # Convert temperatures
        temp_c = obs['temperature']['value'] if obs.get('temperature') and obs['temperature'].get('value') is not None else -100
        temp_f = (temp_c * 9/5) + 32 if temp_c != -100 else -100
       
        humidity = obs['relativeHumidity']['value'] if obs.get('relativeHumidity') and obs['relativeHumidity'].get('value') is not None else -100
        description = obs.get('textDescription') or ''
        icon = obs.get('icon') or ''
       
        return {
            'temp_f': round(temp_f, 1),
            'temp_c': round(temp_c, 1),
            'humidity': round(humidity),
            'description': description,
            'icon': icon
        }
       
    except requests.exceptions.RequestException as e:
        print(f'[ERROR] Weather API request error: {e}')
        return None
    except KeyError as e:
        print(f'[ERROR] Weather API response missing key: {e}')
        return None
    except Exception as e:
        print(f'[ERROR] Weather fetch error: {e}')
        return None

def fetch_weather_with_location():
    """Get current location and fetch weather data"""
    try:
        # Get current location based on IP
        # location = get_location_from_ip()
        
        location = {
            'name': 'Rhome',
            'region': 'Texas',
            'lat': 33.0534563,
            'lon': -97.4719662,
            'country': 'United States'
        }
       
        if not location:
            print('[WARNING] Failed to detect location')
            return None
       
        # Fetch weather for this location
        weather_data = get_weather_from_weathergov(location['lat'], location['lon'])
       
        if not weather_data:
            print('[WARNING] Failed to fetch weather data')
            return None
       
        # Combine location and weather data
        return {
            'location': location,
            'weather': weather_data
        }
       
    except Exception as e:
        print(f'[ERROR] Failed to fetch weather with location: {e}')
        return None

def log_weather_to_firebase(location, weather_data):
    """Log weather data with location to Firebase"""
    try:
        unix_timestamp = int(time.time())
        timestamp_iso = datetime.now().isoformat()
       
        weather_record = {
            'timestamp': timestamp_iso,
            'unix_timestamp': unix_timestamp,
            'location': {
                'name': location['name'],
                'region': location['region'],
                'lat': location['lat'],
                'lon': location['lon'],
                'country': location.get('country', 'Unknown')
            },
            'temp_f': weather_data['temp_f'],
            'temp_c': weather_data['temp_c'],
            'humidity': weather_data['humidity'],
            'description': weather_data['description'],
            'icon': weather_data['icon']
        }
       
        # Write to Firebase under /weather_history/{unix_timestamp}
        ref = db.reference('/water-heater-user/')
        weather_ref = ref.child('weather_history').child(str(unix_timestamp))
        weather_ref.set(weather_record)
       
        print(f"[INFO] Weather logged: {location['name']}, {weather_data['temp_f']}°F, {weather_data['description']}")
        return True
       
    except Exception as e:
        print(f'[ERROR] Failed to log weather to Firebase: {e}')
        return False

def log_to_firebase(ds18b20_readings, rf_readings):
    """Log all sensor data to Firebase Realtime Database with timestamp as document name
   
    Both DS18B20 and RF sensors are stored in the same flat structure with sensor names as keys
    """
    try:
        # Reference to your database
        ref = db.reference('/water-heater-user/')
       
        # Create timestamp for document name (using unix timestamp for easy sorting)
        unix_timestamp = int(time.time())
        timestamp_iso = datetime.now().isoformat()
       
        # Build data structure with sensor names as keys
        data = {
            'timestamp': timestamp_iso,
            'unix_timestamp': unix_timestamp
        }
       
        # Add DS18B20 readings directly (using sensor name as key, temp as value)
        for sensor_name, temp in ds18b20_readings.items():
            data[sensor_name] = temp
       
        # Add RF sensor readings directly (using sensor name as key, temp as value)
        for sensor_name, sensor_data in rf_readings.items():
            data[sensor_name] = sensor_data['temperature_c']
       
        # Store with unix timestamp as the document name
        readings_ref = ref.child('readings').child(str(unix_timestamp))
        readings_ref.set(data)
       
        # Also update latest reading for quick access
        latest_ref = ref.child('latest')
        latest_ref.set(data)
       
        print(f"[INFO] Successfully logged data for timestamp {unix_timestamp}")
        print("[DEBUG] Data written to Firebase:")
        print(json.dumps(data, indent=2))
        
        return True
       
    except Exception as e:
        print(f"[ERROR] Failed to log to Firebase: {e}")
        return False
    
def log_nonweather_to_firebase(rf_nonweather):
    """Log bad sensor data to Firebase Realtime Database with timestamp as document name
   
    """
    try:
        # Reference to your database
        ref = db.reference('/water-heater-user/')
       
        # Create timestamp for document name (using unix timestamp for easy sorting)
        unix_timestamp = int(time.time())
        timestamp_iso = datetime.now().isoformat()
       
        # Build data structure with sensor names as keys
        data = {
            'timestamp': timestamp_iso,
            'unix_timestamp': unix_timestamp
        }
       
        # Add RF sensor readings directly (using sensor name as key, temp as value)
        for sensor_name, sensor_data in rf_nonweather.items():
            data[sensor_name] = sensor_data
       
        # Store with unix timestamp as the document name
        nonweather_ref = ref.child('non-weather-sensors').child(str(unix_timestamp))
        nonweather_ref.set(data)
       
        # Also update latest reading for quick access
        nonweather_latest_ref = ref.child('non-weather-latest')
        nonweather_latest_ref.set(data)
       
        print(f"[INFO] Successfully logged non-weather data for timestamp {unix_timestamp}")
        print("[DEBUG] Data written to Firebase:")
        print(json.dumps(data, indent=2))
        
        return True
       
    except Exception as e:
        print(f"[ERROR] Failed to log to Firebase: {e}")
        return False

def display_readings(ds18b20_readings, rf_readings, weather_info=None):
    """Display current readings to console"""
    print(f"\n{'='*60}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")
   
    if weather_info:
        print(f"\nLocation: {weather_info['location']['name']}, {weather_info['location']['region']}")
        print(f"Weather: {weather_info['weather']['temp_f']}°F ({weather_info['weather']['temp_c']}°C)")
        print(f"         {weather_info['weather']['description']}, Humidity: {weather_info['weather']['humidity']}%")
   
    print("\nTemperatures:")
   
    # Display DS18B20 sensors
    for name, temp in ds18b20_readings.items():
        if temp is not None:
            print(f"  {name:30s}: {temp:6.2f}°C")
        else:
            print(f"  {name:30s}: ERROR")
   
    # Display RF sensors
    for name, data in rf_readings.items():
        temp = data['temperature_c']
        print(f"  {name:30s}: {temp:6.2f}°C")
   
    if not ds18b20_readings and not rf_readings:
        print("  No sensor readings available")
   
    print(f"{'='*60}")

def main():
    """Main loop - read sensors and weather every 5 minutes"""
    RUNTIME = 300 # Write to db every 5 minutes
    INTERVAL = 0 # Time between runs
    RTL_SCAN_DURATION =  RUNTIME - INTERVAL # Lenght of RTL Scan
   
    print("\n" + "="*60)
    print("MULTI-SENSOR POOL HEATER MONITOR")
    print("="*60)
    print(f"Logging interval: {INTERVAL} seconds ({INTERVAL/60:.0f} minutes)")
    print(f"RF scan duration: {RTL_SCAN_DURATION} seconds per cycle")
    print(f"Firebase project: water-heater-sensors")
    print(f"Weather source: weather.gov")
    print(f"Location: Automatically detected via IP")
    print("="*60 + "\n")
   
    # Startup log
    log_to_db('INFO', 'House Weather Monitor started')
   
    # Check for DS18B20 sensors on startup
    device_folders = get_device_folders()
    if device_folders:
        print(f"Found {len(device_folders)} DS18B20 sensor(s):")
        for device in device_folders:
            sensor_id = device.split('/')[-1]
            sensor_name = SENSOR_NAMES.get(sensor_id, sensor_id)
            print(f"  - {sensor_id} → {sensor_name}")
    else:
        print("WARNING: No DS18B20 sensors detected.")
   
    # Test RTL-SDR availability
    print("\nTesting RTL-SDR availability...")
    try:
        result = subprocess.run(['rtl_433', '-h'], capture_output=True, timeout=5)
        print("✓ RTL-SDR and rtl_433 are installed and ready")
    except FileNotFoundError:
        print("✗ rtl_433 not found - RF sensors will not be available")
        print("  Run the setup script to install: bash rtl_sdr_setup.sh")
    except Exception as e:
        print(f"✗ Error testing rtl_433: {e}")
   
    print("\nStarting monitoring loop...")
    print("Press Ctrl+C to stop\n")
   
    while True:
        cycle_errors = []  # Track errors for this cycle
       
        try:
            # Step 1: Read DS18B20 wired sensors (continue even if it fails)
            ds18b20_readings = {}
            try:
                ds18b20_readings = read_all_sensors()
            except Exception as e:
                error_msg = f"DS18B20 read failed: {e}"
                cycle_errors.append(error_msg)
                print(f"[ERROR] {error_msg}")
           
            # Step 2: Read RF 433MHz sensors (continue even if it fails)
            rf_readings = {}
            try:
                rf_readings, rf_error, rf_nonweather = read_rtl433_sensors(duration=RTL_SCAN_DURATION)
                if rf_error:
                    cycle_errors.append(f"RF read failed: {rf_error}")
                    print(f"[ERROR] RF read failed: {rf_error}")
            except Exception as e:
                error_msg = f"RF read failed: {e}"
                cycle_errors.append(error_msg)
                print(f"[ERROR] {error_msg}")
           
            # Step 3: Fetch weather with location (continue even if it fails)
            weather_info = None
            try:
                print("\nFetching location and weather data...")
                weather_info = fetch_weather_with_location()
            except Exception as e:
                error_msg = f"Weather fetch failed: {e}"
                cycle_errors.append(error_msg)
                print(f"[ERROR] {error_msg}")
           
            # Display locally
            display_readings(ds18b20_readings, rf_readings, weather_info)
           
            # Step 4: Log sensors to Firebase (continue even if it fails)
            try:
                if ds18b20_readings or rf_readings:
                    log_to_firebase(ds18b20_readings, rf_readings)
                elif rf_nonweather:
                    log_nonweather_to_firebase(rf_nonweather)
                    
                else:
                    cycle_errors.append("No sensor readings available")
                    print("[WARNING] No sensor readings available this cycle")
            except Exception as e:
                error_msg = f"Sensor logging failed: {e}"
                cycle_errors.append(error_msg)
                print(f"[ERROR] {error_msg}")
           
            # Step 5: Log weather to Firebase (continue even if it fails)
            try:
                if weather_info:
                    log_weather_to_firebase(weather_info['location'], weather_info['weather'])
                else:
                    print("Weather data unavailable this cycle")
            except Exception as e:
                error_msg = f"Weather logging failed: {e}"
                cycle_errors.append(error_msg)
                print(f"[ERROR] {error_msg}")
           
            # Write cycle summary log to Firebase
            if cycle_errors:
                # Log the specific errors that occurred
                error_summary = "; ".join(cycle_errors)
                log_to_db('ERROR', f"Cycle completed with errors: {error_summary}")
            else:
                # Log success
                log_to_db('INFO', 'Cycle completed successfully')
           
            print(f"\nNext reading in {INTERVAL} seconds...")
           
            # Wait for next interval
            time.sleep(INTERVAL)
           
        except KeyboardInterrupt:
            log_to_db('INFO', 'House Weather Monitor stopped by user')
            print("\n\nStopping monitor... Goodbye!")
            break
        except Exception as e:
            # Catch any unexpected errors
            log_to_db('ERROR', f"Unexpected error in main loop: {e}")
            print(f"\nUnexpected error in main loop: {e}")
            print("Retrying in 60 seconds...")
            time.sleep(60)

if __name__ == "__main__":
    main()