#!/usr/bin/env python3
"""Offline tests for hive_db.py: what the Pi sends to Hive, and which database it picks.

    python3 pi-files/test_hive_db.py
"""
import json
import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hive_db  # noqa: E402


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, status, body):
        self.sent = []
        self.status, self.body = status, body

    def post(self, url, data, timeout, headers):
        self.sent.append((url, json.loads(data), headers))
        return FakeResponse(self.status, self.body)


def main():
    failures = 0

    def check(label, ok):
        nonlocal failures
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {label}")

    s = FakeSession(200, [True])
    db = hive_db.Hive('k' * 40, session=s)
    db.reference('/water-heater-user/').child('readings_raw').child(123).set({'a': 1})
    url, body, headers = s.sent[-1]
    check('writes go to the device door', url == hive_db.HIVE_RPC and headers['content-profile'] == 'pool')
    check('the path and value are passed through',
          body['ops'] == [{'op': 'set', 'path': '/water-heater-user/readings_raw/123', 'value': {'a': 1}}])
    check('the device key rides along', body['device_key'] == 'k' * 40)

    s.body = [{'requested_at': 5}]
    check('get returns the value', db.reference('/water-heater-user/commands/restart').get() == {'requested_at': 5})

    refused = hive_db.Hive('k' * 40, session=FakeSession(401, {'message': 'a device cannot write x'}))
    try:
        refused.reference('/x').set({})
        check('a refusal raises', False)
    except hive_db.HiveError as e:
        check('a refusal raises, saying why', 'cannot write x' in str(e))

    # Picking a database: a saved key means Hive, with no Firebase needed.
    with tempfile.TemporaryDirectory() as tmp:
        hive_db.KEY_FILE = os.path.join(tmp, 'key')
        hive_db.FIREBASE_CREDENTIALS = os.path.join(tmp, 'missing.json')
        with open(hive_db.KEY_FILE, 'w') as f:
            f.write('k' * 40 + '\n')
        hive_db.requests = types.SimpleNamespace(Session=lambda: FakeSession(200, [None]))
        check('a saved key means Hive', isinstance(hive_db.connect(), hive_db.Hive))

        # No key file: a key handed over through Firebase is saved and used.
        os.remove(hive_db.KEY_FILE)
        handed = {'/hive_bridge/pi_key': 'h' * 40}
        fake_fdb = types.SimpleNamespace(reference=lambda p: types.SimpleNamespace(
            get=lambda: handed.get(p),
            update=lambda v: handed.update({f'{p}/{k}': x for k, x in v.items()})))
        hive_db._firebase = lambda: fake_fdb
        open(hive_db.FIREBASE_CREDENTIALS, 'w').close()
        picked = hive_db.connect()
        check('a handed-over key means Hive', isinstance(picked, hive_db.Hive))
        with open(hive_db.KEY_FILE) as f:
            check('and is saved for next time', f.read().strip() == 'h' * 40)
        check('saved privately', (os.stat(hive_db.KEY_FILE).st_mode & 0o077) == 0)
        check('the bridge is told to stand down', '/hive_bridge/pi_switched_at' in handed and handed['/hive_bridge/pi_key'] is None)

        # Neither: Firebase, as before.
        os.remove(hive_db.KEY_FILE)
        check('no key anywhere means Firebase', hive_db.connect() is fake_fdb)

    print('\nAll checks passed.' if not failures else f'\n{failures} check(s) failed.')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
