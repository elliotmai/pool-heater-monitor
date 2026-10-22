#!/usr/bin/env python3
"""
Offline tests for ha_publisher.py, the optional Home Assistant (MQTT) mirror.

No Home Assistant, no broker, no Pi needed - a throwaway MQTT broker runs on
localhost for the duration:

    python3 pi-files/test_ha_publisher.py

What they protect:
  * with no config the mirror does not exist, so the monitor behaves as before;
  * what Home Assistant would be told (discovery + state) for a normal cycle,
    and that failed or missing sensors are never published as numbers;
  * the hand-rolled MQTT packets are accepted by a real parser - this fake
    broker decodes them independently of the encoder;
  * a down, refusing or broken broker costs a bounded amount of time and never
    raises into the sensor loop.
"""
import json
import os
import socket
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ha_publisher as ha  # noqa: E402


def read_varint(sock):
    value, shift = 0, 0
    while True:
        byte = sock.recv(1)[0]
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value
        shift += 7


def read_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('closed')
        buf += chunk
    return buf


def read_str(buf, pos):
    n = int.from_bytes(buf[pos:pos + 2], 'big')
    return buf[pos + 2:pos + 2 + n].decode('utf-8'), pos + 2 + n


class FakeBroker(object):
    """Accepts one connection at a time and records what it was sent."""

    def __init__(self, connack_code=0, drop_after_connect=False, no_ack=False):
        self.no_ack = no_ack
        self.connack_code = connack_code
        self.drop_after_connect = drop_after_connect
        self.connects = []
        self.published = []  # (topic, payload, retain)
        self.disconnected = False
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen(5)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            try:
                self._handle(conn)
            except Exception:
                pass
            finally:
                conn.close()

    def _handle(self, conn):
        conn.settimeout(3)
        first = read_exact(conn, 1)[0]
        assert first == 0x10, 'first packet must be CONNECT'
        body = read_exact(conn, read_varint(conn))
        proto, pos = read_str(body, 0)
        level, flags = body[pos], body[pos + 1]
        pos += 2 + 2  # level, flags, keepalive
        client_id, pos = read_str(body, pos)
        username = password = None
        if flags & 0x80:
            username, pos = read_str(body, pos)
        if flags & 0x40:
            password, pos = read_str(body, pos)
        self.connects.append({'proto': proto, 'level': level, 'client_id': client_id,
                              'username': username, 'password': password})
        conn.sendall(bytes([0x20, 0x02, 0x00, self.connack_code]))
        if self.drop_after_connect or self.connack_code:
            return
        while True:
            header = read_exact(conn, 1)[0]
            if header == 0xE0:
                read_exact(conn, 1)
                self.disconnected = True
                return
            assert header & 0xF0 == 0x30, 'only PUBLISH expected, got %#x' % header
            body = read_exact(conn, read_varint(conn))
            topic, pos = read_str(body, 0)
            qos = (header >> 1) & 3
            if qos and not self.no_ack:
                conn.sendall(bytes([0x40, 0x02]) + body[pos:pos + 2])
                pos += 2
            self.published.append((topic, body[pos:].decode('utf-8'), bool(header & 1)))

    def close(self):
        self.server.close()


def wait_for(predicate, seconds=2.0):
    end = time.time() + seconds
    while time.time() < end:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def main():
    failures = 0

    def check(label, ok):
        nonlocal failures
        failures += 0 if ok else 1
        print('%s  %s' % ('PASS' if ok else 'FAIL', label))

    cfg = {'host': '127.0.0.1', 'port': 1883, 'username': None, 'password': None, 'tls': False,
           'discovery_prefix': 'homeassistant', 'base_topic': 'pool_monitor'}

    # --- configuration ---
    check('no config file -> mirror is off', ha.load_config('/nonexistent/ha_mqtt.json') is None)
    check('from_config() is None without a file', ha.from_config('/nonexistent/ha_mqtt.json') is None)

    with tempfile.TemporaryDirectory() as tmp:
        good = os.path.join(tmp, 'good.json')
        with open(good, 'w') as f:
            json.dump({'host': '10.0.0.5', 'username': 'pool', 'password': 'pw'}, f)
        loaded = ha.load_config(good)
        check('config defaults are filled in',
              loaded['port'] == 1883 and loaded['discovery_prefix'] == 'homeassistant'
              and loaded['base_topic'] == 'pool_monitor' and loaded['username'] == 'pool')

        tls = os.path.join(tmp, 'tls.json')
        with open(tls, 'w') as f:
            json.dump({'host': 'h', 'tls': True}, f)
        check('TLS defaults to port 8883', ha.load_config(tls)['port'] == 8883)

        broken = os.path.join(tmp, 'broken.json')
        with open(broken, 'w') as f:
            f.write('{ not json')
        check('unparseable config disables the mirror instead of raising',
              ha.load_config(broken) is None)

        nohost = os.path.join(tmp, 'nohost.json')
        with open(nohost, 'w') as f:
            json.dump({'port': 1883}, f)
        check('config without a host disables the mirror', ha.load_config(nohost) is None)

    # --- what gets published ---
    diag = {'rf_packets': 7, 'consecutive_empty': 0}
    msgs = ha.build_messages(cfg, {'Green': 24.5, 'Blue': None, 'Red': 30.0},
                             {'OriaID12': {'temperature_c': 19.25}}, diag)
    by_topic = {t: (p, r) for t, p, r in msgs}

    check('state topic carries the bare number', by_topic['pool_monitor/green'][0] == '24.5')
    check('wireless sensor is published', by_topic['pool_monitor/oriaid12'][0] == '19.25')
    check('a failed wired read (None) is not published at all',
          'pool_monitor/blue' not in by_topic
          and 'homeassistant/sensor/pool_monitor/blue/config' not in by_topic)
    check('outside weather is not mirrored',
          not any('outside' in t for t in by_topic))
    check('diagnostic counters publish as whole numbers',
          by_topic['pool_monitor/rf_packets_heard'][0] == '7'
          and by_topic['pool_monitor/empty_cycles_in_a_row'][0] == '0')

    disc = json.loads(by_topic['homeassistant/sensor/pool_monitor/green/config'][0])
    check('discovery is retained, state is not',
          by_topic['homeassistant/sensor/pool_monitor/green/config'][1] is True
          and by_topic['pool_monitor/green'][1] is False)
    check('temperature discovery is typed and unitised',
          disc['device_class'] == 'temperature' and disc['unit_of_measurement'] == '°C'
          and disc['state_topic'] == 'pool_monitor/green' and disc['state_class'] == 'measurement')
    check('every sensor can expire to "unavailable"', disc['expire_after'] == ha.EXPIRE_AFTER_SECONDS)
    check('sensors share one device', disc['device']['identifiers'] == ['pool_heater_monitor'])
    first_state = min(i for i, m in enumerate(msgs) if not m[2])
    last_discovery = max(i for i, m in enumerate(msgs) if m[2])
    check('every discovery message precedes every state message', last_discovery < first_state)
    cnt = json.loads(by_topic['homeassistant/sensor/pool_monitor/rf_packets_heard/config'][0])
    check('diagnostics are filed under diagnostic, not as temperatures',
          cnt.get('entity_category') == 'diagnostic' and 'device_class' not in cnt)

    check('a genuine 0.0 degC reading is published (0 is not "no data")',
          ('pool_monitor/freezer', '0.0', False) in
          [(t, p, r) for t, p, r in ha.build_messages(cfg, {'Freezer': 0.0}, {})])
    check('True is not a temperature',
          ha.build_messages(cfg, {'Green': True}, {}) == [])
    check('no readings -> nothing to send', ha.build_messages(cfg, {}, {}, None) == [])

    clash = ha.build_messages(cfg, {'Hot Tub': 38.0, 'hot-tub': 37.0}, {})
    states = [t for t, p, r in clash if not t.startswith('homeassistant')]
    check('names that slug identically do not overwrite each other', len(set(states)) == 2)
    check('slugify keeps entity ids safe', ha.slugify('Pool / Heater #2!') == 'pool_heater_2'
          and ha.slugify('???') == 'sensor')

    # --- the MQTT bytes, decoded by a separate implementation ---
    broker = FakeBroker()
    live = dict(cfg, port=broker.port, username='pool', password='s3cret')
    ok, why = ha.publish(live, ha.build_messages(live, {'Green': 24.5}, {}))
    check('publish succeeds against a broker (%s)' % why, ok)
    check('broker was sent a clean DISCONNECT', wait_for(lambda: broker.disconnected))
    check('CONNECT is MQTT 3.1.1 with the credentials',
          bool(broker.connects) and broker.connects[0]['proto'] == 'MQTT'
          and broker.connects[0]['level'] == 4 and broker.connects[0]['username'] == 'pool'
          and broker.connects[0]['password'] == 's3cret')
    check('broker received discovery and state',
          ('pool_monitor/green', '24.5', False) in broker.published
          and any(t == 'homeassistant/sensor/pool_monitor/green/config' and r
                  for t, p, r in broker.published))
    broker.close()

    big = {'Sensor %d' % i: 20.0 + i for i in range(40)}  # forces a 2-byte remaining length
    broker = FakeBroker()
    live = dict(cfg, port=broker.port)
    ok, why = ha.publish(live, ha.build_messages(live, big, {}))
    check('many sensors in one connection', ok and wait_for(lambda: len(broker.published) == 80))
    broker.close()

    # --- failure handling ---
    refusing = FakeBroker(connack_code=5)
    ok, why = ha.publish(dict(cfg, port=refusing.port), [('t', 'p', False)])
    check('a refused login is reported, not raised ("%s")' % why, (not ok) and 'not authorised' in why)
    refusing.close()

    closed = socket.socket()
    closed.bind(('127.0.0.1', 0))
    dead_port = closed.getsockname()[1]
    closed.close()
    started = time.time()
    ok, why = ha.publish(dict(cfg, port=dead_port), [('t', 'p', False)])
    check('connection refused is reported quickly', (not ok) and time.time() - started < 2)

    silent = FakeBroker(no_ack=True)
    ha.CONNECT_TIMEOUT = 1
    started = time.time()
    ok, why = ha.publish(dict(cfg, port=silent.port), [('t', 'p', False)])
    check('a broker that accepts but never acknowledges is given up on (%.1fs)' % (time.time() - started),
          (not ok) and time.time() - started < 3)
    silent.close()

    # An unreachable host (packets dropped) must still be bounded by the timeout.
    ha.CONNECT_TIMEOUT = 1
    started = time.time()
    ok, why = ha.publish(dict(cfg, host='10.255.255.1', port=1883), [('t', 'p', False)])
    elapsed = time.time() - started
    check('an unreachable broker cannot stall the sensor loop (%.1fs)' % elapsed,
          (not ok) and elapsed < 3)

    # --- the wrapper the monitor actually calls ---
    mirror = ha.HomeAssistantMirror(dict(cfg, port=dead_port))
    check('publish_cycle returns False instead of raising when the broker is down',
          mirror.publish_cycle({'Green': 24.5}, {}) is False)
    check('and keeps returning False without raising',
          mirror.publish_cycle({'Green': 24.5}, {}) is False)
    check('garbage input cannot raise out of publish_cycle',
          mirror.publish_cycle(object(), 'nope', 12) is False)

    broker = FakeBroker()
    mirror = ha.HomeAssistantMirror(dict(cfg, port=broker.port))
    check('publish_cycle succeeds when the broker is up',
          mirror.publish_cycle({'Green': 24.5}, {'OriaID1': {'temperature_c': 5.0}}) is True)
    check('an empty cycle is a quiet success', mirror.publish_cycle({}, {}) is True)
    broker.close()


    # --- the "unavailable" race: a new sensor's value must not beat its discovery ---
    ha.SETTLE_SECONDS = 0.6
    broker = FakeBroker()
    mirror = ha.HomeAssistantMirror(dict(cfg, port=broker.port))
    started = time.time()
    mirror.publish_cycle({'Green': 24.5}, {}, {'rf_packets': 3})
    first_elapsed = time.time() - started
    check('a new sensor pauses between its discovery and its first value (%.1fs)' % first_elapsed,
          first_elapsed >= 0.6)
    check('removed outside-weather entities are deleted with empty retained messages',
          ('homeassistant/sensor/pool_monitor/outside_temperature/config', '', True) in broker.published
          and ('homeassistant/sensor/pool_monitor/outside_humidity/config', '', True) in broker.published)
    topics = [t for t, p, r in broker.published]
    check('on the wire, discovery arrives before the value',
          topics.index('homeassistant/sensor/pool_monitor/green/config') < topics.index('pool_monitor/green'))
    count_before = len(broker.published)
    started = time.time()
    mirror.publish_cycle({'Green': 25.0}, {}, {'rf_packets': 3})
    check('the same sensors next cycle cost no pause (%.2fs)' % (time.time() - started),
          time.time() - started < 0.4)
    check('and the deletion is not repeated every cycle',
          sum(1 for t, p, r in broker.published[count_before:] if p == '' and r) == 0)
    started = time.time()
    mirror.publish_cycle({'Green': 25.0, 'Blue': 22.0}, {}, {'rf_packets': 3})
    check('a sensor that appears later pauses again', time.time() - started >= 0.6)
    broker.close()

    down = ha.HomeAssistantMirror(dict(cfg, port=dead_port))
    down.publish_cycle({'Green': 24.5}, {})
    check('a failed publish does not mark sensors as announced',
          down._announced == set() and down._cleaned is False)
    ha.SETTLE_SECONDS = 2

    print('\n' + ('All checks passed.' if not failures else '%d check(s) FAILED.' % failures))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
