#!/usr/bin/env python3
"""
RTL-SDR Test Script for Antonki Thermometers
This script helps you identify your sensors and verify they're working
"""

import subprocess
import json
import time
from datetime import datetime

def test_rtl_sdr():
    """Test if RTL-SDR dongle is detected"""
    print("\n" + "="*60)
    print("Testing RTL-SDR Hardware")
    print("="*60)

    try:
        result = subprocess.run(['rtl_test', '-t'],
                              capture_output=True,
                              text=True,
                              timeout=3)

        output = result.stdout + result.stderr

        if "Found" in output:
            print("✓ RTL-SDR dongle detected!")
            for line in output.split('\n'):
                if 'Found' in line or 'Tuner' in line:
                    print(f"  {line.strip()}")
        else:
            print("✗ No RTL-SDR dongle found")
            print("\nTroubleshooting:")
            print("  1. Check USB connection")
            print("  2. Try a different USB port")
            print("  3. Run: lsusb | grep Realtek")
            return False

    except FileNotFoundError:
        print("✗ rtl_test not found - RTL-SDR tools not installed")
        print("\nPlease run the installation script first:")
        print("  bash rtl_sdr_setup.sh")
        return False
    except subprocess.TimeoutExpired:
        print("✓ RTL-SDR detected (test interrupted as expected)")
    except Exception as e:
        print(f"✗ Error testing RTL-SDR: {e}")
        return False

    return True

def scan_for_sensors(duration=60, frequency='433.92M'):
    """Scan for 433MHz sensors and display results"""
    print("\n" + "="*60)
    print(f"Scanning for 433MHz Sensors")
    print("="*60)
    print(f"Frequency: {frequency}")
    print(f"Duration: {duration} seconds")
    print(f"Started: {datetime.now().strftime('%H:%M:%S')}")
    print("\nListening... (This may take a minute)")
    print("If you have sensors, try triggering them by:")
    print("  - Pressing the reset button")
    print("  - Removing and reinserting batteries")
    print("  - Moving them closer to the antenna")
    print("="*60 + "\n")

    sensors_found = {}

    try:
        cmd = [
            'rtl_433',
            '-F', 'json',
            '-T', str(duration),
            '-M', 'time:iso',
            '-f', frequency,
            '-s', '250k'
        ]

        # Run with real-time output
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

        print("Detected signals:\n")

        line_count = 0
        for line in process.stdout:
            if not line.strip():
                continue

            try:
                data = json.loads(line)

                model = data.get('model', 'Unknown')
                sensor_id = data.get('id', 'N/A')
                temp_c = data.get('temperature_C')
                temp_f = data.get('temperature_F')
                humidity = data.get('humidity')
                battery = data.get('battery_ok')

                # Create unique key
                key = f"{model}_{sensor_id}"

                # Store the latest reading for this sensor
                sensors_found[key] = {
                    'model': model,
                    'id': sensor_id,
                    'temperature_C': temp_c,
                    'temperature_F': temp_f,
                    'humidity': humidity,
                    'battery_ok': battery,
                    'raw_data': data
                }

                # Display the detection
                line_count += 1
                timestamp = datetime.now().strftime('%H:%M:%S')
                print(f"[{timestamp}] Signal #{line_count}")
                print(f"  Model: {model}")
                print(f"  ID: {sensor_id}")
                if temp_c:
                    print(f"  Temperature: {temp_c}°C ({temp_f}°F)")
                if humidity:
                    print(f"  Humidity: {humidity}%")
                if battery is not None:
                    print(f"  Battery: {'OK' if battery else 'LOW'}")
                print()

            except json.JSONDecodeError:
                continue
            except Exception as e:
                print(f"Error parsing signal: {e}")

        process.wait()

    except FileNotFoundError:
        print("✗ rtl_433 not found")
        return {}
    except Exception as e:
        print(f"✗ Error scanning: {e}")
        return {}

    return sensors_found

def display_summary(sensors):
    """Display summary of found sensors"""
    print("\n" + "="*60)
    print("Scan Complete - Summary")
    print("="*60)

    if not sensors:
        print("\nNo sensors detected!")
        print("\nTroubleshooting:")
        print("  1. Check that sensors have fresh batteries")
        print("  2. Move sensors closer to the antenna")
        print("  3. Try triggering sensors by pressing reset button")
        print("  4. Verify sensors transmit at 433.92 MHz")
        print("  5. Check antenna connection to RTL-SDR")
        print("\nFor Antonki thermometers, they typically transmit every 60 seconds")
        print("You may need to wait longer or run the scan again")
    else:
        print(f"\nFound {len(sensors)} unique sensor(s):\n")

        for idx, (key, data) in enumerate(sensors.items(), 1):
            print(f"Sensor #{idx}:")
            print(f"  Identifier: {key}")
            print(f"  Model: {data['model']}")
            print(f"  ID: {data['id']}")

            if data['temperature_C']:
                print(f"  Last Temperature: {data['temperature_C']}°C ({data['temperature_F']}°F)")
            if data['humidity']:
                print(f"  Last Humidity: {data['humidity']}%")
            if data['battery_ok'] is not None:
                print(f"  Battery Status: {'OK' if data['battery_ok'] else 'LOW'}")

            print(f"\n  Full data: {json.dumps(data['raw_data'], indent=2)}")
            print()

        print("\nThese sensors will be automatically detected by pool_monitor_updated.py")
        print("They will appear in Firebase under 'rf_sensors' with names like:")
        for key in sensors.keys():
            print(f"  - RF_{key}")

    print("="*60)

def main():
    print("\n" + "="*60)
    print("RTL-SDR and Antonki Thermometer Test")
    print("="*60)

    # Test RTL-SDR hardware
    if not test_rtl_sdr():
        print("\nPlease fix RTL-SDR issues before continuing")
        return

    # Scan for sensors
    print("\n\nReady to scan for sensors!")
    print("This will listen for 60 seconds to detect your thermometers.")

    input("\nPress Enter to start scanning...")

    sensors = scan_for_sensors(duration=60)

    # Display results
    display_summary(sensors)

    print("\n\nTest complete!")

if __name__ == "__main__":
    main()