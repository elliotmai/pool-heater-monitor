import os
import sys
import glob
import time
import json
import requests
import subprocess
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, db

# USB-level recovery for a wedged SDR. Optional on purpose: a Pi running an
# older deploy simply won't have the file yet, and the monitor must still boot.
try:
    import sdr_recovery
except Exception as e:
    sdr_recovery = None
    print(f'[WARNING] sdr_recovery.py not available ({e}); USB recovery is disabled')

# Initialize the DS18B20 sensors
os.system('modprobe w1-gpio')
os.system('modprobe w1-therm')

# Initialize Firebase Admin SDK with your service account
cred = credentials.Certificate('/home/pi/Desktop/water-heater-sensors-firebase-adminsdk-fbsvc-0a078f1c90.json')
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://water-heater-sensors-default-rtdb.firebaseio.com'
})

def log_to_db(level, message):
    """Log messages to Firebase database.

    Warnings/errors go to a separate 'logs_errors' node that's retained longer
    than routine info/heartbeat logs.
    """
    try:
        timestamp = datetime.now().isoformat()
        unix_timestamp = int(time.time())

        log_entry = {
            'timestamp': timestamp,
            'unix_timestamp': unix_timestamp,
            'level': level,
            'message': message
        }

        node = 'logs_errors' if level in ('ERROR', 'WARNING') else 'logs'
        db.reference(f'/water-heater-user/{node}').child(str(unix_timestamp)).set(log_entry)

        print(f"[{level}] {message}")
    except Exception as e:
        # Fallback to console if Firebase logging fails
        print(f"[{level}] {message}")
        print(f"(Failed to log to Firebase: {e})")

# --- Throttled logging -------------------------------------------------------
# A persistent problem (e.g. sensors unplugged) used to write an identical error
# to Firebase every single cycle, filling up the logs. These throttles keep at
# most one copy per interval so the database isn't spammed with duplicates.
ERROR_LOG_THROTTLE = 3600     # seconds between repeats of an identical error
SUCCESS_LOG_THROTTLE = 3600   # seconds between "cycle ok" heartbeat logs
_last_logged = {}

def log_to_db_throttled(level, message, throttle_secs=ERROR_LOG_THROTTLE):
    """Like log_to_db, but suppress an identical message within throttle_secs.

    The message still prints to the console (captured by journald) every time;
    only the Firebase write is skipped, so the DB isn't filled with duplicates.
    """
    now = time.time()
    last = _last_logged.get(message, 0)
    if now - last < throttle_secs:
        print(f"[{level}] {message} (throttled, not re-sent to DB)")
        return
    _last_logged[message] = now
    log_to_db(level, message)

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

def claim_command(name, claiming_status, newer_than=0):
    """Claim a pending dashboard command, or return None if there isn't one.

    "Pending" means the request is newer than both the last time we handled
    this command and `newer_than`. Stamping handled_at as we claim it is what
    makes a command fire exactly once: re-reading the same node next cycle
    finds nothing new, so nothing loops.
    """
    try:
        ref = db.reference(f'/water-heater-user/commands/{name}')
        cmd = ref.get()
        if not isinstance(cmd, dict):
            return None
        requested_at = cmd.get('requested_at') or 0
        if requested_at <= max(cmd.get('handled_at') or 0, newer_than):
            return None
        # Acknowledge so the dashboard can reflect that it was picked up.
        ref.update({'status': claiming_status, 'handled_at': int(time.time())})
        return cmd
    except Exception as e:
        print(f"[WARNING] {name}-command check failed: {e}")
        return None


def finish_command(name, **fields):
    """Write the outcome of a command back so the dashboard can show it."""
    try:
        db.reference(f'/water-heater-user/commands/{name}').update(
            dict(fields, completed_at=int(time.time())))
    except Exception as e:
        print(f'[WARNING] Could not record the outcome of {name}: {e}')


def restart_requested(process_start):
    """Return True if the dashboard has requested a restart since we started.

    We only honor requests newer than this process's start time, so after we
    restart the same request won't trigger us again (no restart loop).
    """
    return claim_command('restart', 'restarting', newer_than=process_start) is not None

def complete_restart_command():
    """Close the loop on a dashboard-requested restart.

    restart_requested() marks the command 'restarting' just before we exit; the
    process that comes back up marks it 'completed'. Without this the dashboard
    can only say "sent", which is exactly the ambiguity you hit when a restart
    appears to do nothing.
    """
    try:
        ref = db.reference('/water-heater-user/commands/restart')
        cmd = ref.get()
        if isinstance(cmd, dict) and cmd.get('status') == 'restarting':
            ref.update({'status': 'completed', 'completed_at': int(time.time())})
            print('[INFO] Acknowledged completion of the requested restart.')
    except Exception as e:
        print(f'[WARNING] Could not mark restart complete: {e}')


SDR_PROBE_SECONDS = 30      # How long to listen when checking whether a
                            # recovery step actually brought the receiver back.


def run_sdr_recovery(reason, accept_silent=True):
    """Try to bring a wedged RTL-SDR back at the USB level, and publish what happened.

    This exists because the obvious remedies don't work on this failure:
    restarting the service reopens the same wedged device, and even rebooting
    the Pi leaves it wedged, because the USB ports stay powered across a soft
    reboot. Re-enumerating or power-cycling the port is the only thing that
    reproduces the unplug/replug that does work — see sdr_recovery.py.

    Returns the recovery record (or None if recovery isn't installed), and
    never raises: a failed recovery must not take the monitor down with it.
    """
    if sdr_recovery is None:
        log_to_db('ERROR', 'SDR recovery was needed but sdr_recovery.py is not deployed on '
                           'the Pi — see deploy/README.md to install it.')
        print('[ERROR] sdr_recovery.py is not available; cannot attempt USB recovery.')
        return None

    print(f'[INFO] Attempting USB-level SDR recovery ({reason})...')
    log_to_db('INFO', f'Attempting USB-level SDR recovery ({reason})')

    try:
        record = sdr_recovery.recover(probe_seconds=SDR_PROBE_SECONDS,
                                      accept_silent=accept_silent)
    except Exception as e:
        log_to_db('ERROR', f'SDR recovery itself failed: {e}')
        print(f'[ERROR] SDR recovery raised: {e}')
        return None

    record['reason'] = reason
    print(f"[INFO] SDR recovery: {record['summary']}")
    log_to_db('INFO' if record.get('recovered') else 'ERROR',
              f"SDR recovery ({reason}): {record['summary']}")

    # Its own node, not /diagnostics: diagnostics is overwritten every cycle,
    # and the last recovery attempt is exactly what you want to still be able
    # to read hours later.
    try:
        db.reference('/water-heater-user/sdr_recovery').set(record)
    except Exception as e:
        print(f'[WARNING] Could not publish the SDR recovery record: {e}')

    return record


def handle_sdr_reset_command():
    """Run USB recovery on demand when the dashboard asks for it.

    The watchdog gets there on its own eventually, but only after ~30 minutes
    of dead cycles. This is the button for when you already know it's stuck and
    don't want to wait — or to walk out to the Pi.
    """
    cmd = claim_command('reset_sdr', 'running')
    if cmd is None:
        return

    record = run_sdr_recovery('requested from dashboard')
    if record is None:
        finish_command('reset_sdr', status='failed',
                       summary='USB recovery is not installed on the Pi (see deploy/README.md).')
        return

    finish_command('reset_sdr',
                   status='completed' if record.get('recovered') else 'failed',
                   summary=record.get('summary', ''),
                   steps=[{'step': a['step'], 'ok': a['ok'], 'detail': a['detail']}
                          for a in record.get('attempts', [])])

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

def is_number(value):
    """True only for a real numeric reading (bools and None don't count)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)

def numeric_readings(readings):
    """Drop keys whose read failed, so an all-failed dict is falsy.

    read_all_sensors() keeps failed sensors as None so they still show up in
    the console output; anything deciding "did we actually get data?" must
    look at this instead, or a dict full of Nones reads as success.
    """
    return {k: v for k, v in readings.items() if is_number(v)}

def diagnose_no_data(ds18b20_readings, rf_stats):
    """One-line, plain-language reason why a cycle produced no readings.

    Deliberately free of counts and model names: this string is the key the
    error-log throttle dedupes on, so it has to be identical cycle after cycle
    for the same underlying fault. The varying detail (packet counts, which
    models were heard) goes to the console and the /diagnostics node instead.
    """
    packets = rf_stats.get('packets', 0)
    temp_packets = rf_stats.get('temp_packets', 0)

    if ds18b20_readings and not numeric_readings(ds18b20_readings):
        return 'every wired sensor failed to read'
    if packets == 0:
        return 'RF receiver heard nothing at all — SDR or antenna problem'
    if temp_packets == 0:
        return 'RF receiver is hearing other 433MHz traffic, but no temperature sensors'
    return 'temperature packets were decoded, but none matched a known sensor'

def extract_temp_c(data):
    """Pull a temperature in °C out of one rtl_433 JSON packet.

    Decoders are inconsistent about the field name (and rtl_433 upgrades have
    switched sensors between them), so accept every spelling. Explicit
    `is None` checks throughout: a genuine 0.0°C reading is falsy, and a
    truthiness test would silently discard it.
    """
    for key in ('temperature_C', 'temperature_c', 'temperature'):
        value = data.get(key)
        if is_number(value):
            return float(value)

    value = data.get('temperature_F')
    if is_number(value):
        return (float(value) - 32) * 5 / 9

    return None

def read_rtl433_sensors(duration=30):
    """
    Read 433MHz sensors using rtl_433
    Only logs data from sensors where model contains "Oria-"
   
    Args:
        duration: How long to listen for sensor data (seconds)
   
    Returns:
        Tuple of (readings dict, error message or None, non-weather dict, stats dict).
        `stats` counts what the receiver actually heard this scan so a dead
        SDR can be told apart from silent sensors.
    """
    readings = {}
    non_weather_readings = {}
    stats = {'packets': 0, 'temp_packets': 0, 'models': [], 'scan_seconds': duration}
    models_seen = set()
   
    try:
        print(f'[INFO] Starting RTL-SDR scan for {duration} seconds (filtering for Oria sensors)...')
        
        # Find rtl_433 executable
        rtl433_path = None
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
            return readings, 'rtl_433 command not found in possible paths', non_weather_readings, stats
       
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

                stats['packets'] += 1
                models_seen.add(str(model))

                # Extract temperature first, accepting every field name a
                # decoder might use. Only a packet with NO temperature at all
                # is a non-weather device.
                temp_c = extract_temp_c(data)

                if temp_c is None:
                    sensor_name = f"{model}"
                    non_weather_readings[sensor_name] = data
                    continue

                stats['temp_packets'] += 1
               
                # FILTER: Only process sensors where model contains "Oria-"
                if 'Oria-' in model and sensor_id:
                    sensor_name = f"OriaID{sensor_id}"
                elif not sensor_id or not model:
                    continue
                else:
                    sensor_name = f"{model}"
               
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
       
        stats['models'] = sorted(models_seen)[:10]

        if readings:
            print(f'[INFO] Found {len(readings)} sensor(s)')
        else:
            print(f"[WARNING] No temperature sensors decoded during scan "
                  f"(heard {stats['packets']} packet(s) from: "
                  f"{', '.join(stats['models']) or 'nothing at all'})")
       
        return readings, None, non_weather_readings, stats
       
    except subprocess.TimeoutExpired:
        stats['models'] = sorted(models_seen)[:10]
        return readings, 'RTL-433 command timed out', non_weather_readings, stats
    except FileNotFoundError:
        stats['models'] = sorted(models_seen)[:10]
        return readings, 'rtl_433 command not found. Please install rtl_433.', non_weather_readings, stats
    except Exception as e:
        stats['models'] = sorted(models_seen)[:10]
        return readings, f'Error reading RTL-433 sensors: {e}', non_weather_readings, stats

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

def log_to_firebase(ds18b20_readings, rf_readings, weather_info=None):
    """Log all sensor data to Firebase Realtime Database with timestamp as document name

    Both DS18B20 and RF sensors are stored in the same flat structure with sensor names as keys.
    The outside weather (if available) is embedded in the same record so every reading
    captures the ambient conditions at the moment it was taken.
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

        # Embed the outside weather alongside the sensor readings so every
        # record captures ambient conditions at the moment of the read.
        if weather_info and weather_info.get('weather'):
            w = weather_info['weather']
            data['outside_temp_f'] = w.get('temp_f')
            data['outside_temp_c'] = w.get('temp_c')
            data['outside_humidity'] = w.get('humidity')
            data['outside_conditions'] = w.get('description')

        # Store the raw reading (HOT tier) keyed by unix timestamp, and refresh
        # the single 'live' snapshot used by the Overview.
        ref.child('readings_raw').child(str(unix_timestamp)).set(data)
        ref.child('live').set(data)

        # Stamp lastSeen for every sensor that reported a numeric value this
        # cycle, so the sensorHealth function can detect one going offline.
        sensor_updates = {}
        for key, value in data.items():
            if key in ('timestamp', 'unix_timestamp') or key.startswith('outside_'):
                continue
            if isinstance(value, (int, float)):
                sensor_updates[f'{key}/lastSeen'] = unix_timestamp
        if sensor_updates:
            ref.child('sensors').update(sensor_updates)

        print(f"[INFO] Successfully logged data for timestamp {unix_timestamp}")
        print("[DEBUG] Data written to Firebase:")
        print(json.dumps(data, indent=2))
        
        return True
       
    except Exception as e:
        print(f"[ERROR] Failed to log to Firebase: {e}")
        return False
    
def log_diagnostics_to_firebase(diag):
    """Write a single, always-overwritten snapshot of what the Pi is hearing.

    This is the node to look at when readings stop: it separates "the SDR is
    deaf" (rf_packets 0) from "the SDR hears the neighborhood but none of our
    sensors" (rf_packets > 0, rf_sensors 0) from "wired sensors are failing"
    (ds18b20_ok < ds18b20_total) — without needing to SSH into the Pi.
    """
    try:
        db.reference('/water-heater-user/diagnostics').set(diag)
    except Exception as e:
        print(f'[ERROR] Failed to write diagnostics to Firebase: {e}')

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
    """Main loop - read sensors and weather roughly every CYCLE_TARGET seconds"""
    CYCLE_TARGET = 300         # Aim for one full cycle every ~5 minutes
    RTL_SCAN_DURATION = 120    # Seconds to listen for RF sensors each cycle.
                               # Shorter = lighter load (the SDR idles the rest
                               # of the cycle instead of running non-stop). Raise
                               # it toward CYCLE_TARGET if RF (Oria) readings
                               # start getting missed.
    MIN_LOOP_GAP = 5           # Hard floor between cycles (never busy-loop)
    FAILURE_BACKOFF = 60       # Extra cooldown added per consecutive failure
    MAX_FAILURE_BACKOFF = 900  # ...capped at 15 minutes
    EMPTY_RESTART_AFTER = 6     # consecutive cycles with NO sensor data before we
                               # assume the SDR/receiver has wedged and exit so
                               # systemd restarts us with a fresh SDR (~30 min).
   
    print("\n" + "="*60)
    print("MULTI-SENSOR POOL HEATER MONITOR")
    print("="*60)
    print(f"Cycle target: {CYCLE_TARGET} seconds ({CYCLE_TARGET/60:.0f} minutes)")
    print(f"RF scan duration: {RTL_SCAN_DURATION} seconds per cycle")
    print(f"Firebase project: water-heater-sensors")
    print(f"Weather source: weather.gov")
    print(f"Location: Automatically detected via IP")
    print("="*60 + "\n")
   
    # Startup log
    log_to_db('INFO', 'House Weather Monitor started')

    # If we're back up because the dashboard asked for a restart, say so there.
    complete_restart_command()
   
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

    consecutive_failures = 0  # Drives the post-failure back-off
    consecutive_empty = 0     # Cycles in a row with zero sensor data (SDR watchdog)
    last_data_unix = None     # When we last got a real reading (for diagnostics)
    process_start = int(time.time())  # For honoring remote restart requests

    while True:
        cycle_start = time.time()
        cycle_errors = []  # Track errors for this cycle

        # Honor a remote restart request from the dashboard (exit 0 -> systemd
        # restarts us). Checked once per cycle, so it applies within ~5 min.
        if restart_requested(process_start):
            log_to_db('INFO', 'Restart requested from dashboard — restarting service')
            print('[INFO] Restart requested from dashboard, exiting to restart.')
            sys.exit(0)

        # A restart reopens the same wedged dongle, so the dashboard has a
        # second button that resets the USB device itself. Handled in-process:
        # unlike a restart, we stay up and can report the outcome directly.
        handle_sdr_reset_command()

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
            rf_nonweather = {}
            rf_stats = {'packets': 0, 'temp_packets': 0, 'models': [], 'scan_seconds': RTL_SCAN_DURATION}
            try:
                rf_readings, rf_error, rf_nonweather, rf_stats = read_rtl433_sensors(duration=RTL_SCAN_DURATION)
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
           
            # Step 4: Log to Firebase. Always write a reading row — even with no
            # sensor values — so it doubles as a heartbeat: the dashboard can
            # tell the Pi is alive/online, and reliability is measurable against
            # the number of cycles that were expected.
            # "Data" means at least one real temperature value. Sensors whose
            # read failed (None) and 433MHz chatter from devices that aren't
            # thermometers (rf_nonweather) are NOT data — counting them is what
            # let the monitor report healthy cycles for weeks while every
            # reading row went out empty.
            ds18b20_ok = numeric_readings(ds18b20_readings)
            got_data = bool(ds18b20_ok) or bool(rf_readings)

            # Update the health counters up front so the diagnostics snapshot
            # written below reflects this cycle, not the previous one.
            if got_data:
                consecutive_empty = 0
                last_data_unix = int(time.time())
            else:
                consecutive_empty += 1

            if ds18b20_readings and not ds18b20_ok:
                cycle_errors.append('Every wired sensor failed to read')

            try:
                log_to_firebase(ds18b20_readings, rf_readings, weather_info)
                if rf_nonweather:
                    log_nonweather_to_firebase(rf_nonweather)
                if not got_data:
                    cycle_errors.append(f"No sensor readings available ({diagnose_no_data(ds18b20_readings, rf_stats)})")
                    print(f"[WARNING] No sensor readings available this cycle — "
                          f"{diagnose_no_data(ds18b20_readings, rf_stats)} "
                          f"(RF packets: {rf_stats.get('packets', 0)}, "
                          f"models: {', '.join(rf_stats.get('models', [])) or 'none'})")
            except Exception as e:
                error_msg = f"Sensor logging failed: {e}"
                cycle_errors.append(error_msg)
                print(f"[ERROR] {error_msg}")

            # Step 4b: Publish diagnostics so a silent failure is visible in
            # the dashboard instead of only in journald on the Pi.
            log_diagnostics_to_firebase({
                'unix_timestamp': int(time.time()),
                'timestamp': datetime.now().isoformat(),
                'ds18b20_total': len(ds18b20_readings),
                'ds18b20_ok': len(ds18b20_ok),
                'rf_packets': rf_stats.get('packets', 0),
                'rf_temp_packets': rf_stats.get('temp_packets', 0),
                'rf_sensors': len(rf_readings),
                'rf_models': rf_stats.get('models', []),
                'rf_scan_seconds': rf_stats.get('scan_seconds', RTL_SCAN_DURATION),
                'got_data': got_data,
                'consecutive_empty': consecutive_empty,
                'last_data_unix': last_data_unix,
                'diagnosis': 'ok' if got_data else diagnose_no_data(ds18b20_readings, rf_stats),
            })
           
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
           
            # Write cycle summary log to Firebase (throttled so a persistent
            # problem doesn't write an identical error every single cycle).
            if cycle_errors:
                consecutive_failures += 1
                error_summary = "; ".join(cycle_errors)
                log_to_db_throttled('ERROR', f"Cycle completed with errors: {error_summary}",
                                    throttle_secs=ERROR_LOG_THROTTLE)
            else:
                if consecutive_failures > 0:
                    # Note recovery once, immediately (not throttled).
                    log_to_db('INFO', f'Recovered after {consecutive_failures} failed cycle(s)')
                consecutive_failures = 0
                log_to_db_throttled('INFO', 'Cycle completed successfully',
                                    throttle_secs=SUCCESS_LOG_THROTTLE)

            # SDR watchdog: several cycles in a row with zero sensor data almost
            # always means the RTL-SDR has wedged (a known failure after hours of
            # use). Exit so systemd restarts us with a fresh SDR instead of
            # silently logging nothing until the next manual restart.
            if not got_data:
                heard_something = rf_stats.get('packets', 0) > 0
                if consecutive_empty >= EMPTY_RESTART_AFTER:
                    if heard_something:
                        # The receiver is decoding other 433MHz traffic, so the
                        # SDR is fine — restarting would just churn. The sensors
                        # themselves (batteries, range) or their decoder is the
                        # problem, so say that instead.
                        log_to_db_throttled('ERROR',
                            'No sensor data for hours, but the RF receiver is still decoding other '
                            '433MHz traffic — the SDR is fine; check sensor batteries/range (see diagnostics).',
                            throttle_secs=ERROR_LOG_THROTTLE)
                        print('[ERROR] Watchdog: no sensor data, but the receiver is hearing '
                              'other traffic — not restarting (see /diagnostics).')
                    else:
                        # The receiver is deaf. Try the USB device itself first:
                        # restarting the process (what we used to do here) just
                        # reopens the same wedged dongle, which is why this
                        # failure used to need someone to walk out and replug it.
                        # accept_silent=False: we got here only because the
                        # receiver heard nothing across many minutes of
                        # listening, so "opens but decoded nothing in 30s" is
                        # not evidence of a fix — keep climbing to the power cut.
                        record = run_sdr_recovery(f'no sensor data for {consecutive_empty} cycles',
                                                  accept_silent=False)
                        if record and record.get('recovered'):
                            # Give the revived dongle a clean run of cycles
                            # before the watchdog is allowed to fire again.
                            consecutive_empty = 0
                        else:
                            log_to_db('ERROR', f'No sensor data for {consecutive_empty} cycles and USB '
                                      'recovery did not bring the receiver back — restarting the service')
                            print(f'[ERROR] Watchdog: no data for {consecutive_empty} cycles and USB '
                                  'recovery failed, exiting to trigger a systemd restart.')
                            sys.exit(1)

            # Pace the loop. A healthy RF scan already used most of CYCLE_TARGET,
            # so we sleep the small remainder. If reads failed fast, we sleep the
            # full remainder plus a growing back-off, so failures never busy-loop
            # and hammer Firebase (the root cause of the ~24h bog-down).
            elapsed = time.time() - cycle_start
            backoff = min(FAILURE_BACKOFF * consecutive_failures, MAX_FAILURE_BACKOFF) if consecutive_failures else 0
            sleep_time = max(MIN_LOOP_GAP, CYCLE_TARGET - elapsed, backoff)

            print(f"\nNext reading in {int(sleep_time)} seconds...")
            time.sleep(sleep_time)
           
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
    # test