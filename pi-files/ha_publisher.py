#!/usr/bin/env python3
"""Mirror each cycle's readings into Home Assistant over MQTT.

This is an *additional* sink, not a replacement: the monitor keeps writing to
Firebase exactly as before, and the dashboard doesn't know this file exists.
The point is to start feeding Home Assistant now so its history and dashboards
fill up while the rest of the home server is still being built.

It is inert until configured. With no config file the monitor behaves exactly
as it did, and with one it publishes after every cycle:

  * a retained MQTT discovery message per sensor, so Home Assistant creates the
    entities by itself (no YAML), and
  * the latest value of each sensor on its own topic.

Every sensor is published with `expire_after`, so one that stops reporting
turns "unavailable" in Home Assistant instead of showing its last value
forever - the same silent failure the Firebase side works to surface.

Deliberately dependency-free (Python 3.7 stdlib only): a Pi that has not had
`pip install paho-mqtt` run on it still boots, and a deploy cannot break the
monitor by adding an import the Pi lacks. Publishing is QoS 1 over a short-lived
connection per cycle - a few small packets every ~5 minutes - so there is no
keepalive thread or reconnect logic to get wrong, and nothing here can raise
into, or stall, the sensor loop for more than ~15 seconds.

Config (JSON, default /home/pi/Desktop/ha_mqtt.json, override with the
POOL_HA_CONFIG env var). It lives only on the Pi because it holds a password:

    {
      "host": "192.168.1.50",          // use an IP: DNS lookups are not time-limited
      "port": 1883,                    // optional
      "username": "pool",              // optional
      "password": "...",               // optional
      "tls": false,                    // optional
      "discovery_prefix": "homeassistant",   // optional
      "base_topic": "pool_monitor"           // optional
    }

Run `python3 ha_publisher.py` to publish one test message and see the result.
"""
import json
import os
import re
import socket
import ssl
import sys
import time

DEFAULT_CONFIG_PATH = '/home/pi/Desktop/ha_mqtt.json'

# A sensor that has not reported for this long goes "unavailable" in Home
# Assistant. A cycle is ~5 minutes and a wireless sensor is only heard when it
# happens to transmit inside the scan window, so allow a few missed cycles
# before calling it gone.
EXPIRE_AFTER_SECONDS = 1200

CONNECT_TIMEOUT = 4  # seconds; bounds every socket operation below
PUBLISH_DEADLINE = 15  # seconds; bounds a whole cycle's publish, however slowly a broker acks

DEVICE = {
    'identifiers': ['pool_heater_monitor'],
    'name': 'Pool Heater Monitor',
    'manufacturer': 'DIY',
    'model': 'Raspberry Pi: DS18B20 + rtl_433',
}


# --- Config ------------------------------------------------------------------

def load_config(path=None):
    """Return the config dict, or None if the mirror is not set up (or broken).

    A missing file is the normal "not enabled" case and is not an error. A file
    that exists but is unusable is reported, because that is a mistake the owner
    wants to hear about - but still returns None, never raises.
    """
    path = path or os.environ.get('POOL_HA_CONFIG') or DEFAULT_CONFIG_PATH
    try:
        with open(path, 'r') as f:
            cfg = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        print('[WARNING] Home Assistant mirror: cannot read %s (%s); disabled' % (path, e))
        return None
    if not isinstance(cfg, dict) or not cfg.get('host'):
        print('[WARNING] Home Assistant mirror: %s needs a "host"; disabled' % path)
        return None
    out = {
        'host': str(cfg['host']),
        'port': int(cfg.get('port') or (8883 if cfg.get('tls') else 1883)),
        'username': cfg.get('username') or None,
        'password': cfg.get('password') or None,
        'tls': bool(cfg.get('tls')),
        'discovery_prefix': str(cfg.get('discovery_prefix') or 'homeassistant').strip('/'),
        'base_topic': str(cfg.get('base_topic') or 'pool_monitor').strip('/'),
    }
    return out


# --- Building the messages (pure: no network) ----------------------------------

def slugify(name):
    """Make a sensor name safe for an MQTT topic and an entity id."""
    slug = re.sub(r'[^a-z0-9]+', '_', str(name).lower()).strip('_')
    return slug or 'sensor'


def _is_number(value):
    # bool is an int subclass; True/False is not a temperature.
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _sensor_specs(ds18b20_readings, rf_readings, weather_info, diagnostics):
    """Everything worth publishing as (name, value, kind), numbers only.

    A failed wired read arrives as None and a missing wireless sensor is simply
    absent; neither is published, so Home Assistant sees "no update" and the
    expiry marks it unavailable rather than recording a bogus zero.
    """
    specs = []
    for name, temp in (ds18b20_readings or {}).items():
        if _is_number(temp):
            specs.append((name, temp, 'temperature'))
    for name, reading in (rf_readings or {}).items():
        temp = reading.get('temperature_c') if isinstance(reading, dict) else None
        if _is_number(temp):
            specs.append((name, temp, 'temperature'))

    weather = (weather_info or {}).get('weather') or {}
    if _is_number(weather.get('temp_c')):
        specs.append(('Outside temperature', weather['temp_c'], 'temperature'))
    if _is_number(weather.get('humidity')):
        specs.append(('Outside humidity', weather['humidity'], 'humidity'))

    diag = diagnostics or {}
    if _is_number(diag.get('rf_packets')):
        specs.append(('RF packets heard', diag['rf_packets'], 'diag_count'))
    if _is_number(diag.get('consecutive_empty')):
        specs.append(('Empty cycles in a row', diag['consecutive_empty'], 'diag_count'))
    return specs


def _discovery_payload(name, slug, kind, state_topic):
    payload = {
        'name': name,
        'unique_id': 'pool_monitor_' + slug,
        'state_topic': state_topic,
        'state_class': 'measurement',
        'expire_after': EXPIRE_AFTER_SECONDS,
        'has_entity_name': True,
        'device': DEVICE,
    }
    if kind == 'temperature':
        payload['device_class'] = 'temperature'
        payload['unit_of_measurement'] = '°C'
    elif kind == 'humidity':
        payload['device_class'] = 'humidity'
        payload['unit_of_measurement'] = '%'
    else:  # diagnostic counters: not a measurement of the pool, kept out of the main view
        payload['entity_category'] = 'diagnostic'
    return payload


def build_messages(cfg, ds18b20_readings, rf_readings, weather_info=None, diagnostics=None):
    """Return [(topic, payload_str, retain)] for one cycle.

    Discovery configs are retained and re-sent every cycle: they are tiny, and
    it means entities reappear after a Home Assistant or broker rebuild without
    anyone remembering to republish. State is *not* retained, so a stale value
    replayed to a freshly started Home Assistant can't masquerade as current.
    """
    base = cfg['base_topic']
    prefix = cfg['discovery_prefix']
    messages = []
    used = {}
    for name, value, kind in _sensor_specs(ds18b20_readings, rf_readings, weather_info, diagnostics):
        slug = slugify(name)
        # Two names that slug identically would silently overwrite each other.
        n = used.get(slug, 0)
        used[slug] = n + 1
        if n:
            slug = '%s_%d' % (slug, n + 1)
        state_topic = '%s/%s' % (base, slug)
        discovery_topic = '%s/sensor/%s/%s/config' % (prefix, base, slug)
        messages.append((discovery_topic,
                         json.dumps(_discovery_payload(name, slug, kind, state_topic)),
                         True))
        text = str(int(value)) if kind == 'diag_count' else repr(round(float(value), 2))
        messages.append((state_topic, text, False))
    return messages


# --- A minimal MQTT 3.1.1 client (just CONNECT / PUBLISH / DISCONNECT) ----------

def _encode_length(n):
    out = bytearray()
    while True:
        byte = n % 128
        n //= 128
        if n:
            byte |= 0x80
        out.append(byte)
        if not n:
            return bytes(out)


def _utf8(s):
    b = s.encode('utf-8')
    return len(b).to_bytes(2, 'big') + b


def encode_connect(client_id, username=None, password=None, keepalive=30):
    flags = 0x02  # clean session
    payload = _utf8(client_id)
    if username is not None:
        flags |= 0x80
        payload += _utf8(username)
        if password is not None:
            flags |= 0x40
            payload += _utf8(password)
    variable = _utf8('MQTT') + bytes([4, flags]) + keepalive.to_bytes(2, 'big')
    body = variable + payload
    return bytes([0x10]) + _encode_length(len(body)) + body


def encode_publish(topic, payload, retain=False, packet_id=None):
    """A PUBLISH packet; QoS 1 when a packet_id is given, QoS 0 otherwise."""
    body = _utf8(topic)
    flags = 0x30 | (1 if retain else 0)
    if packet_id is not None:
        flags |= 0x02
        body += packet_id.to_bytes(2, 'big')
    body += payload.encode('utf-8')
    return bytes([flags]) + _encode_length(len(body)) + body


DISCONNECT = bytes([0xE0, 0x00])


def _recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('broker closed the connection')
        buf += chunk
    return buf


def publish(cfg, messages, client_id='pool-heater-monitor'):
    """Send messages over one short connection. Returns (ok, reason)."""
    sock = None
    try:
        sock = socket.create_connection((cfg['host'], cfg['port']), timeout=CONNECT_TIMEOUT)
        sock.settimeout(CONNECT_TIMEOUT)
        if cfg.get('tls'):
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=cfg['host'])
        sock.sendall(encode_connect(client_id, cfg.get('username'), cfg.get('password')))
        connack = _recv_exact(sock, 4)
        if connack[0] != 0x20 or connack[3] != 0:
            codes = {1: 'bad protocol', 2: 'client id rejected', 3: 'broker unavailable',
                     4: 'bad username or password', 5: 'not authorised'}
            return False, 'broker refused the connection (%s)' % codes.get(connack[3], connack[3])
        # QoS 1, one message at a time, waiting for each acknowledgement before
        # sending the next. With QoS 0 the broker is never obliged to tell us
        # anything, and a broker that handles a DISCONNECT ahead of messages
        # still queued behind it would drop them with no sign on our side;
        # pipelining all the messages at once also made one broker we tried
        # stop forwarding to subscribers part-way through. A dozen local round
        # trips is nothing next to a five-minute cycle.
        deadline = time.time() + PUBLISH_DEADLINE
        for i, (topic, payload, retain) in enumerate(messages):
            if time.time() > deadline:
                return False, 'broker too slow: gave up after %ds' % PUBLISH_DEADLINE
            packet_id = i + 1
            sock.sendall(encode_publish(topic, payload, retain, packet_id=packet_id))
            ack = _recv_exact(sock, 4)
            if ack[0] != 0x40 or ack[1] != 0x02 or int.from_bytes(ack[2:4], 'big') != packet_id:
                return False, 'unexpected reply from broker (%s)' % ack.hex()
        sock.sendall(DISCONNECT)
        return True, ''
    except Exception as e:
        return False, '%s: %s' % (type(e).__name__, e)
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass


# --- What the monitor uses ---------------------------------------------------

class HomeAssistantMirror(object):
    """Publishes one cycle at a time and never lets a failure escape."""

    FAILURE_REPEAT_SECONDS = 3600

    def __init__(self, cfg):
        self.cfg = cfg
        self._failing = False
        self._last_failure_print = 0

    def publish_cycle(self, ds18b20_readings, rf_readings, weather_info=None, diagnostics=None):
        try:
            messages = build_messages(self.cfg, ds18b20_readings, rf_readings,
                                      weather_info, diagnostics)
            if not messages:
                return True
            ok, reason = publish(self.cfg, messages)
        except Exception as e:  # a bug here must not take the sensor loop down
            ok, reason = False, 'unexpected %s: %s' % (type(e).__name__, e)

        if ok:
            if self._failing:
                print('[INFO] Home Assistant mirror: broker reachable again')
            self._failing = False
            print('[INFO] Home Assistant mirror: published %d sensor(s)' % (len(messages) // 2))
            return True

        # Console only, throttled. The Firebase logs are what the dashboard
        # shows, and Home Assistant being down or not built yet is not a
        # monitor fault worth putting there.
        now = time.time()
        if not self._failing or now - self._last_failure_print >= self.FAILURE_REPEAT_SECONDS:
            print('[WARNING] Home Assistant mirror: publish failed (%s)' % reason)
            self._last_failure_print = now
        self._failing = True
        return False


def from_config(path=None):
    """The mirror if one is configured, otherwise None."""
    cfg = load_config(path)
    if cfg is None:
        return None
    print('[INFO] Home Assistant mirror enabled -> %s:%d (%s/...)'
          % (cfg['host'], cfg['port'], cfg['base_topic']))
    return HomeAssistantMirror(cfg)


if __name__ == '__main__':
    config = load_config(sys.argv[1] if len(sys.argv) > 1 else None)
    if config is None:
        sys.exit('No usable config. Create %s (see the top of this file).' % DEFAULT_CONFIG_PATH)
    test = build_messages(config, {'Test sensor': 21.5}, {})
    done, why = publish(config, test)
    print('published %d messages' % len(test) if done else 'FAILED: ' + why)
    sys.exit(0 if done else 1)
