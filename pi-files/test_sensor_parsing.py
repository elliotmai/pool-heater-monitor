#!/usr/bin/env python3
"""
Offline regression tests for pool_monitor.py's sensor parsing.

No RTL-SDR, no Firebase, no Pi hardware needed — run it anywhere:

    python3 pi-files/test_sensor_parsing.py

These lock in the bug that let the monitor run for weeks looking healthy while
every reading row went out empty:
  * an rtl_433 packet reporting `temperature_C` (the standard field name)
    was dropped as a "non-weather" device, because the old guard only
    checked `temperature`;
  * a genuine 0.0 degC reading was dropped too, being falsy;
  * a dict of failed wired reads ({'Green': None}) counted as "we got data",
    which kept the watchdog from ever restarting.
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
MONITOR = os.path.join(HERE, 'pool_monitor.py')


def load_helpers():
    """Exec pool_monitor.py's helper section with the Pi-only bits stubbed out."""
    for name in ('firebase_admin', 'requests'):
        sys.modules.setdefault(name, types.ModuleType(name))
    credentials = types.ModuleType('firebase_admin.credentials')
    credentials.Certificate = lambda path: None
    db = types.ModuleType('firebase_admin.db')
    db.reference = lambda *a, **k: None
    sys.modules['firebase_admin.credentials'] = credentials
    sys.modules['firebase_admin.db'] = db
    sys.modules['firebase_admin'].credentials = credentials
    sys.modules['firebase_admin'].db = db
    sys.modules['firebase_admin'].initialize_app = lambda *a, **k: None
    os.system = lambda *a, **k: 0  # skip modprobe on non-Pi machines

    with open(MONITOR, encoding='utf-8') as f:
        source = f.read().split('def main()')[0]  # helpers only, never the loop

    namespace = {}
    exec(compile(source, 'pool_monitor.py', 'exec'), namespace)
    return namespace


def main():
    ns = load_helpers()
    extract_temp_c = ns['extract_temp_c']
    is_number = ns['is_number']
    numeric_readings = ns['numeric_readings']
    diagnose_no_data = ns['diagnose_no_data']

    failures = 0

    def check(label, ok):
        nonlocal failures
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {label}")

    def close(got, expected):
        if got is None or expected is None:
            return got is expected
        return abs(got - expected) < 1e-9

    # --- temperature extraction ---
    packets = [
        ("packet using 'temperature'", {'model': 'Oria-TH', 'id': 5, 'temperature': 22.5}, 22.5),
        ("packet using 'temperature_C'", {'model': 'Oria-TH', 'id': 5, 'temperature_C': 22.5}, 22.5),
        ("packet using 'temperature_F'", {'model': 'Acurite', 'id': 9, 'temperature_F': 32.0}, 0.0),
        ("a real 0.0 degC reading survives", {'model': 'Oria-TH', 'id': 5, 'temperature_C': 0.0}, 0.0),
        ("device with no temperature at all", {'model': 'Doorbell', 'id': 3, 'code': 'ab12'}, None),
        ("non-numeric temperature is ignored", {'model': 'Junk', 'temperature': 'n/a'}, None),
    ]
    for label, packet, expected in packets:
        check(label, close(extract_temp_c(packet), expected))

    # --- "did we actually get data?" ---
    all_failed = {'Green': None, 'Blue': None}
    check('all-failed wired reads count as no data', numeric_readings(all_failed) == {})
    check('a mixed batch keeps the good reading',
          numeric_readings({'Green': 21.0, 'Blue': None}) == {'Green': 21.0})
    check('True is not a temperature', not is_number(True))

    # --- diagnosis strings (stable text: the log throttle dedupes on them) ---
    deaf = {'packets': 0, 'temp_packets': 0, 'models': []}
    noisy = {'packets': 12, 'temp_packets': 0, 'models': ['Doorbell']}
    check('deaf receiver is diagnosed', 'heard nothing' in diagnose_no_data({}, deaf))
    check('noisy-but-no-thermometers is diagnosed',
          'no temperature sensors' in diagnose_no_data({}, noisy))
    check('wired failure takes priority', 'wired sensor' in diagnose_no_data(all_failed, noisy))
    check('diagnosis carries no varying detail (throttle key stays stable)',
          diagnose_no_data({}, noisy) == diagnose_no_data({}, {'packets': 3, 'temp_packets': 0, 'models': ['Other']}))

    print('\n' + ('All checks passed.' if not failures else f'{failures} check(s) FAILED.'))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
