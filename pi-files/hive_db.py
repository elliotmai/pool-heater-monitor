"""Where the monitor writes: Hive (Supabase) once it has a device key, else Firebase.

The pool app's data moved from Firebase's Realtime Database into Hive. The Pi
writes there through one narrow door, pool.device_sync: with its own device
key it can write readings, logs, weather, diagnostics and sensor last-seen
times, and read and answer dashboard commands — nothing else.

    db = hive_db.connect()
    db.reference('/water-heater-user/live').set({...})

`connect()` returns an object with the same `reference(path).child() / .set()
/ .update() / .get()` calls pool_monitor.py already makes on firebase_admin.db,
so the rest of the monitor didn't have to change. It picks:

  1. Hive, if KEY_FILE exists.
  2. Otherwise Hive, if Firebase holds a key waiting for this Pi
     (/hive_bridge/pi_key, readable only with the Pi's admin credentials):
     it is saved to KEY_FILE and removed from Firebase. This is the hand-off —
     the first restart after this file reaches the Pi moves it over on its own.
  3. Otherwise Firebase, exactly as before.

Once Hive answers, the temporary bridge that copies Firebase into Hive is told
to stand down (/hive_bridge/pi_switched_at).
"""
import json
import os
import time

import requests

KEY_FILE = '/home/pi/Desktop/hive-device-key'
FIREBASE_CREDENTIALS = '/home/pi/Desktop/water-heater-sensors-firebase-adminsdk-fbsvc-0a078f1c90.json'
FIREBASE_URL = 'https://water-heater-sensors-default-rtdb.firebaseio.com'

HIVE_RPC = 'https://fcjiummxpacwriwopcho.supabase.co/rest/v1/rpc/device_sync'
# Publishable (public) key: it only lets the request reach the API. The device
# key is what the database checks.
HIVE_PUBLISHABLE_KEY = 'sb_publishable_fZo1FUg_j4O1EHH-W2Jr1A_4P8W3o2S'
TIMEOUT = 20


class HiveError(Exception):
    pass


class _Ref:
    def __init__(self, hive, path):
        self._hive = hive
        self._path = '/' + path.strip('/')

    def child(self, name):
        return _Ref(self._hive, f'{self._path}/{str(name).strip("/")}')

    def set(self, value):
        self._hive.call('set', self._path, value)

    def update(self, value):
        self._hive.call('update', self._path, value)

    def get(self):
        return self._hive.call('get', self._path)


class Hive:
    name = 'Hive (Supabase)'

    def __init__(self, device_key, session=None):
        self._key = device_key
        self._http = session or requests.Session()

    def reference(self, path='/'):
        return _Ref(self, path)

    def call(self, op, path, value=None):
        body = {'device_key': self._key, 'ops': [{'op': op, 'path': path, 'value': value}]}
        r = self._http.post(HIVE_RPC, data=json.dumps(body, allow_nan=False), timeout=TIMEOUT, headers={
            'apikey': HIVE_PUBLISHABLE_KEY,
            'content-type': 'application/json',
            'content-profile': 'pool',
        })
        if r.status_code != 200:
            try:
                detail = r.json().get('message')
            except Exception:
                detail = r.text[:200]
            raise HiveError(f'Hive refused {op} {path}: {r.status_code} {detail}')
        return r.json()[0]


def _read_key():
    try:
        with open(KEY_FILE, encoding='utf-8') as f:
            return f.read().strip() or None
    except FileNotFoundError:
        return None


def _firebase():
    import firebase_admin
    from firebase_admin import credentials, db
    if not getattr(firebase_admin, '_apps', None):
        firebase_admin.initialize_app(credentials.Certificate(FIREBASE_CREDENTIALS), {'databaseURL': FIREBASE_URL})
    return db


def _save_key(key):
    fd = os.open(KEY_FILE + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(key + '\n')
    os.replace(KEY_FILE + '.tmp', KEY_FILE)


def connect():
    key = _read_key()
    if not key:
        try:
            fdb = _firebase()
            handed = fdb.reference('/hive_bridge/pi_key').get()
            if not isinstance(handed, str) or len(handed) < 32:
                print('[INFO] Writing to Firebase (no Hive device key yet).')
                return fdb
            _save_key(handed)
            key = handed
            print(f'[INFO] Picked up the Hive device key; saved to {KEY_FILE}.')
        except Exception as e:
            print(f'[WARNING] Hive hand-off check failed ({e}); writing to Firebase.')
            return _firebase()

    hive = Hive(key)
    try:
        hive.reference('/water-heater-user/commands/restart').get()  # proves the key works
        print('[INFO] Writing to Hive (Supabase).')
    except HiveError as e:
        if ' 403 ' in str(e):  # key unknown or revoked: keep the old path alive
            print(f'[ERROR] Hive does not know this device key ({e}); writing to Firebase.')
            return _firebase()
        print(f'[WARNING] Hive did not answer yet ({e}); writing to Hive anyway.')
        return hive
    except Exception as e:
        print(f'[WARNING] Hive did not answer yet ({e}); writing to Hive anyway.')
        return hive

    # Tell the bridge it can stop, and drop the hand-off copy of the key.
    try:
        if os.path.exists(FIREBASE_CREDENTIALS):
            fdb = _firebase()
            fdb.reference('/hive_bridge').update({'pi_switched_at': int(time.time()), 'pi_key': None})
    except Exception as e:
        print(f'[WARNING] Could not tell the Firebase bridge to stand down ({e}).')
    return hive
