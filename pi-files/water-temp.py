import os
import glob
import time
import json

# Initialize the sensors
os.system('modprobe w1-gpio')
os.system('modprobe w1-therm')

# Load sensor names from config
with open('sensors.json', 'r') as f:
    SENSOR_NAMES = json.load(f)

base_dir = '/sys/bus/w1/devices/'
device_folders = glob.glob(base_dir + '28*')

def read_temp_raw(device_file):
    with open(device_file, 'r') as f:
        lines = f.readlines()
    return lines

def read_temp(device_folder):
    device_file = device_folder + '/w1_slave'
    lines = read_temp_raw(device_file)
    
    while lines[0].strip()[-3:] != 'YES':
        time.sleep(0.2)
        lines = read_temp_raw(device_file)
    
    equals_pos = lines[1].find('t=')
    if equals_pos != -1:
        temp_string = lines[1][equals_pos+2:]
        temp_c = float(temp_string) / 1000.0
        return temp_c

# Read all sensors with custom names
for device in device_folders:
    sensor_id = device.split('/')[-1]
    sensor_name = SENSOR_NAMES.get(sensor_id, sensor_id)
    temp = read_temp(device)
    print(f"{sensor_name}: {temp:.2f}°C")