#!/usr/bin/env python3
"""Bring a wedged RTL-SDR back without walking out to the Pi.

Restarting the monitor process - or even rebooting the Pi - does not clear
this failure, and that is the whole reason this file exists. The Pi keeps its
USB ports powered through a soft reboot, so a dongle whose firmware or USB
endpoints have locked up comes back locked up. Only re-enumerating the device
or dropping its VBUS clears it, which is exactly what unplugging and
replugging does and what nothing in software was doing.

The ladder, cheapest and least disruptive first:

  1. reset      USBDEVFS_RESET ioctl - port reset, the driver keeps the device
  2. rebind     unbind/bind through sysfs - full re-enumeration, power stays on
  3. authorize  authorized 0 -> 1 - deauthorize/reauthorize, a harder re-enumerate
  4. power      uhubctl port power cycle - actually drops VBUS: "unplug and replug"

After each rung we listen briefly with rtl_433 and stop at the first one that
gets packets flowing again, so a half-healthy dongle is disturbed as little as
possible.

Every rung needs root. Install this file root-owned and let the monitor reach
the privileged half through a narrow sudoers rule (see deploy/README.md); it is
a module and a CLI at once:

    sudo /usr/local/sbin/sdr_recovery.py            # run the whole ladder
    sudo /usr/local/sbin/sdr_recovery.py --probe    # report what it can see
    sudo /usr/local/sbin/sdr_recovery.py --step reset --port 1-1.4

Nothing here imports Firebase or the monitor, so it can be run by hand over SSH
while diagnosing, and `--probe` is safe to run at any time.
"""
import argparse
import fcntl
import glob
import json
import os
import re
import subprocess
import sys
import time

# RTL-SDR dongles as they identify themselves on the bus. The Realtek IDs cover
# almost everything sold as an "RTL-SDR"; the rest are rebadges that ship their
# own VID/PID and would otherwise be invisible to us.
RTL_SDR_IDS = {
    ('0bda', '2832'),  # Realtek RTL2832U
    ('0bda', '2838'),  # Realtek RTL2838 - the common generic dongle
    ('0bda', '2831'),  # Realtek RTL2831U
    ('0413', '6680'),  # DigitalNow QuickTV
    ('0ccd', '00a9'),  # Terratec Cinergy T
    ('1554', '5020'),  # PixelView
    ('1f4d', 'a803'),  # GTek T803
    ('185b', '0620'),  # Compro Videomate
}

# _IO('U', 20) - the ioctl the kernel exposes for "reset this port".
USBDEVFS_RESET = (ord('U') << 8) | 20

# Where we remember the dongle's bus address. A fully wedged dongle sometimes
# drops off the bus entirely, and then the only rung that can help is the power
# cycle - which still needs to know which port to cut.
STATE_DIR = '/var/lib/pool-monitor'
STATE_FILE = os.path.join(STATE_DIR, 'last-sdr-port')

# A sysfs USB port id: bus-port, optionally through hub ports ("1-1.4.2").
# Validated before it ever reaches a sysfs write or a subprocess argument,
# because this script runs as root on behalf of an unprivileged caller.
PORT_RE = re.compile(r'^\d+-\d+(\.\d+)*$')

RTL433_PATHS = (
    '/home/pi/rtl_433/build/src/rtl_433',
    '/usr/local/bin/rtl_433',
    '/usr/bin/rtl_433',
    'rtl_433',
)


def _read_sysfs(path):
    try:
        with open(path) as handle:
            return handle.read().strip()
    except OSError:
        return None


def find_sdr():
    """Locate the RTL-SDR on the USB bus by walking sysfs.

    Read-only, so the monitor can call this as the `pi` user. Returns None when
    no known dongle is present - which is itself a finding: a dongle that has
    fallen off the bus needs the power rung, not a reset.
    """
    for device in sorted(glob.glob('/sys/bus/usb/devices/*')):
        port = os.path.basename(device)
        if ':' in port or not PORT_RE.match(port):
            continue  # interfaces (1-1.4:1.0) and root hubs (usb1) aren't devices

        vid = _read_sysfs(os.path.join(device, 'idVendor'))
        pid = _read_sysfs(os.path.join(device, 'idProduct'))
        if not vid or (vid.lower(), (pid or '').lower()) not in RTL_SDR_IDS:
            continue

        busnum = _read_sysfs(os.path.join(device, 'busnum'))
        devnum = _read_sysfs(os.path.join(device, 'devnum'))
        return {
            'port': port,
            'vid': vid.lower(),
            'pid': (pid or '').lower(),
            'busnum': int(busnum) if busnum and busnum.isdigit() else None,
            'devnum': int(devnum) if devnum and devnum.isdigit() else None,
            'product': _read_sysfs(os.path.join(device, 'product')) or 'RTL-SDR',
            'serial': _read_sysfs(os.path.join(device, 'serial')),
        }
    return None


def remember_port(port):
    """Persist the dongle's bus address so we can still power-cycle it later.

    Best-effort: if we can't write state (not root, read-only filesystem) the
    power rung falls back to cycling every switchable port instead.
    """
    if not port or not PORT_RE.match(port):
        return
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(STATE_FILE, 'w') as handle:
            handle.write(port + '\n')
    except OSError:
        pass


def recall_port():
    port = _read_sysfs(STATE_FILE)
    return port if port and PORT_RE.match(port) else None


def find_rtl433():
    """First rtl_433 binary that answers - mirrors the monitor's own search."""
    for path in RTL433_PATHS:
        try:
            subprocess.run([path, '-h'], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=3)
            return path
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
    return None


# rtl_433/librtlsdr's vocabulary for "I could not talk to the dongle". Matching
# on these is what separates a deaf-but-open receiver (sensors are the problem)
# from a device that won't open at all (the dongle is the problem).
OPEN_FAILURE_MARKERS = (
    'no supported devices found',
    'failed to open rtlsdr device',
    'usb_open error',
    'usb_claim_interface error',
    'unable to open',
    'no supported devices',
)


def probe(seconds=30, rtl433_path=None):
    """Listen briefly and report what the receiver is actually doing.

    Returns (state, detail) where state is one of:
      'packets'   - decoded real 433MHz traffic, the dongle is working
      'silent'    - opened fine but heard nothing; inconclusive on its own
      'no_device' - could not open the dongle at all, it is still wedged
      'no_tool'   - rtl_433 isn't installed, so we can't judge either way
    """
    rtl433_path = rtl433_path or find_rtl433()
    if not rtl433_path:
        return 'no_tool', 'rtl_433 not found; cannot verify the receiver'

    cmd = [rtl433_path, '-F', 'json', '-T', str(seconds),
           '-M', 'time:iso', '-f', '433.92M', '-s', '250k']
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, timeout=seconds + 20)
    except subprocess.TimeoutExpired:
        # rtl_433 ignoring its own -T deadline means it is stuck in a USB read,
        # which is the wedge itself rather than a quiet band.
        return 'no_device', f'rtl_433 did not exit after {seconds}s (stuck reading the dongle)'
    except OSError as exc:
        return 'no_tool', f'could not run rtl_433: {exc}'

    packets = sum(1 for line in (result.stdout or '').splitlines()
                  if line.strip().startswith('{'))
    if packets:
        return 'packets', f'decoded {packets} packet(s) in {seconds}s'

    stderr = (result.stderr or '').lower()
    for marker in OPEN_FAILURE_MARKERS:
        if marker in stderr:
            return 'no_device', f'rtl_433 could not open the dongle ({marker})'

    return 'silent', f'dongle opened but decoded nothing in {seconds}s'


# --------------------------------------------------------------------------
# The rungs. Each returns (ok, detail) and each needs root.
# --------------------------------------------------------------------------

def step_reset(port):
    """USBDEVFS_RESET: ask the kernel to reset the port under the device.

    The cheapest rung - the driver keeps its claim and nothing re-enumerates -
    so it clears a stalled endpoint but not a dongle whose firmware is gone.
    """
    device = find_sdr()
    if not device or device['busnum'] is None or device['devnum'] is None:
        return False, 'device not on the bus, nothing to reset'

    node = '/dev/bus/usb/%03d/%03d' % (device['busnum'], device['devnum'])
    try:
        fd = os.open(node, os.O_WRONLY)
    except OSError as exc:
        return False, f'could not open {node}: {exc}'
    try:
        fcntl.ioctl(fd, USBDEVFS_RESET, 0)
    except OSError as exc:
        return False, f'reset ioctl on {node} failed: {exc}'
    finally:
        os.close(fd)
    return True, f'reset {node}'


def step_rebind(port):
    """Unbind and rebind the usb driver: a full re-enumeration, power untouched.

    This is the software half of a replug - the device is torn down and probed
    again from scratch - and it is what usually rescues a dongle that a plain
    reset couldn't.
    """
    if not PORT_RE.match(port or ''):
        return False, f'refusing to rebind an unrecognized port id: {port!r}'

    driver = '/sys/bus/usb/drivers/usb'
    try:
        with open(os.path.join(driver, 'unbind'), 'w') as handle:
            handle.write(port)
    except OSError as exc:
        return False, f'unbind {port} failed: {exc}'

    time.sleep(2)

    try:
        with open(os.path.join(driver, 'bind'), 'w') as handle:
            handle.write(port)
    except OSError as exc:
        # An unbound device that won't rebind is worse than where we started,
        # so say so loudly - the power rung is the way back from here.
        return False, f'unbound {port} but rebind failed: {exc}'

    time.sleep(3)
    return True, f'unbound and rebound {port}'


def step_authorize(port):
    """Deauthorize then reauthorize: a harder re-enumeration than rebind.

    The kernel drops the device's configuration entirely and re-reads its
    descriptors, so a dongle that came back from rebind still confused gets a
    genuinely clean start - still without cutting power.
    """
    if not PORT_RE.match(port or ''):
        return False, f'refusing to deauthorize an unrecognized port id: {port!r}'

    attr = f'/sys/bus/usb/devices/{port}/authorized'
    if not os.path.exists(attr):
        return False, f'{attr} does not exist (device is off the bus)'

    try:
        with open(attr, 'w') as handle:
            handle.write('0')
        time.sleep(2)
        with open(attr, 'w') as handle:
            handle.write('1')
    except OSError as exc:
        return False, f'authorized toggle on {port} failed: {exc}'

    time.sleep(3)
    return True, f'deauthorized and reauthorized {port}'


HUB_LINE = re.compile(r'^Current status for hub ([\w.\-:]+)(?:\s|,|\[)(.*)$')
PORT_LINE = re.compile(r'^\s*Port (\d+):.*?\[([0-9a-fA-F]{4}):([0-9a-fA-F]{4})')


def uhubctl_survey():
    """Ask uhubctl what it sees, and where our dongle sits.

    Returns (hubs, error). Each hub is {'location', 'switchable', 'ports'},
    where `switchable` reflects the 'ppps' capability - per-port power
    switching. Without it the hub simply cannot cut VBUS, and saying that
    plainly beats issuing a command that silently does nothing.
    """
    try:
        result = subprocess.run(['uhubctl'], stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, timeout=20)
    except FileNotFoundError:
        return [], 'uhubctl is not installed (sudo apt-get install -y uhubctl)'
    except (subprocess.TimeoutExpired, OSError) as exc:
        return [], f'could not run uhubctl: {exc}'

    hubs = []
    current = None
    for line in (result.stdout or '').splitlines():
        hub_match = HUB_LINE.match(line.strip())
        if hub_match:
            current = {
                'location': hub_match.group(1),
                # uhubctl prints the hub's capabilities in the same bracket;
                # 'ppps' is the one that means "I can switch port power".
                'switchable': 'ppps' in line.lower(),
                'ports': [],
            }
            hubs.append(current)
            continue

        port_match = PORT_LINE.match(line)
        if port_match and current is not None:
            current['ports'].append({
                'port': int(port_match.group(1)),
                'vid': port_match.group(2).lower(),
                'pid': port_match.group(3).lower(),
            })

    if not hubs:
        return [], 'uhubctl reported no hubs (run it as root)'
    return hubs, None


def locate_in_hubs(hubs):
    """Find the (hub location, port number) our dongle is plugged into."""
    for hub in hubs:
        for entry in hub['ports']:
            if (entry['vid'], entry['pid']) in RTL_SDR_IDS:
                return hub, entry['port']
    return None, None


def step_power(port, delay=4):
    """Cut and restore VBUS on the dongle's port - the real unplug/replug.

    This is the only rung that reproduces what you do by hand, and the only one
    that can recover a dongle that has dropped off the bus entirely. It depends
    on the hub supporting per-port power switching: many Pi models' built-in
    hubs do not, and when that's the case we say so instead of pretending.
    """
    hubs, error = uhubctl_survey()
    if error:
        return False, error

    hub, hub_port = locate_in_hubs(hubs)
    if hub is None:
        switchable = [h['location'] for h in hubs if h['switchable']]
        if not switchable:
            return False, ('the dongle is not visible to uhubctl and no hub here supports '
                           'per-port power switching, so its power cannot be cut in software')
        return False, (f'the dongle is not visible to uhubctl; switchable hubs are '
                       f'{", ".join(switchable)} - power it through one of those to make '
                       'this recoverable remotely')

    if not hub['switchable']:
        return False, (f'hub {hub["location"]} port {hub_port} holds the dongle but the hub '
                       'has no per-port power switching (no "ppps"), so its power cannot be '
                       'cut in software - see deploy/README.md for the hardware fix')

    cmd = ['uhubctl', '-l', hub['location'], '-p', str(hub_port), '-a', 'cycle', '-d', str(delay)]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, timeout=60)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        return False, f'uhubctl power cycle failed: {exc}'

    if result.returncode != 0:
        tail = (result.stdout or '').strip().splitlines()[-1:] or ['no output']
        return False, f'uhubctl exited {result.returncode}: {tail[0]}'

    # Re-enumeration after a power cut is slower than a rebind: the dongle has
    # to boot its own firmware again before the kernel sees it.
    time.sleep(delay + 4)
    return True, f'power-cycled hub {hub["location"]} port {hub_port} for {delay}s'


STEPS = {
    'reset': step_reset,
    'rebind': step_rebind,
    'authorize': step_authorize,
    'power': step_power,
}

# Order matters: least disruptive first, and `power` last because it is the
# only one that survives a dongle vanishing from the bus.
LADDER = ('reset', 'rebind', 'authorize', 'power')


def run_privileged_step(name, port):
    """Execute one rung, directly if we're root, otherwise via the sudo helper.

    The monitor runs as `pi` and must not be root, so it re-enters this same
    script through the one narrow sudoers rule (deploy/pool-deploy.sudoers).
    """
    if name not in STEPS:
        return False, f'unknown step {name!r}'

    if os.geteuid() == 0:
        return STEPS[name](port)

    cmd = ['sudo', '-n', '/usr/local/sbin/sdr_recovery.py', '--step', name]
    if port:
        cmd += ['--port', port]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, timeout=180)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        return False, (f'could not run the privileged helper ({exc}); install it per '
                       'deploy/README.md so USB recovery can run without a person present')

    detail = (result.stdout or '').strip().splitlines()[-1:] or ['no output']
    return result.returncode == 0, detail[0]


def recover(probe_seconds=30, accept_silent=True, steps=LADDER):
    """Walk the ladder until the receiver is heard from again.

    `accept_silent` decides what to do with a rung after which the dongle opens
    cleanly but decodes nothing, and the right answer depends on who is asking.
    A person pressing the button may well have a working receiver and a quiet
    band, so stopping there avoids power-cycling healthy hardware. The watchdog
    is different: it only calls us after many minutes of listening that heard
    literally nothing, so a quiet band is already ruled out and a silent probe
    is not evidence of recovery - it keeps climbing.

    Returns a JSON-serializable record of what was tried and what happened -
    the monitor publishes it verbatim so the dashboard can say which rung fixed
    things, or that every rung was exhausted and the dongle really does need
    hands on it.
    """
    device = find_sdr()
    port = device['port'] if device else recall_port()
    if device:
        remember_port(device['port'])

    record = {
        'started_at': int(time.time()),
        'device': device,
        'port': port,
        'attempts': [],
        'recovered': False,
        'summary': '',
    }

    if not device and not port:
        record['summary'] = ('No RTL-SDR on the USB bus and no remembered port, so there is '
                             'nothing to reset - the dongle has dropped off entirely.')

    for name in steps:
        ok, detail = run_privileged_step(name, port)
        attempt = {'step': name, 'ok': ok, 'detail': detail}

        if ok:
            # Re-locate first: a rebind or power cycle gives the dongle a new
            # devnum, and the next rung must not aim at the stale one.
            found = find_sdr()
            if found:
                port = record['port'] = found['port']
                record['device'] = found
            state, probe_detail = probe(probe_seconds)
            attempt['probe'] = state
            attempt['probe_detail'] = probe_detail
            if state == 'silent':
                record['opens_but_silent'] = True
            if state == 'packets':
                record['attempts'].append(attempt)
                record['recovered'] = True
                record['summary'] = f'Recovered by "{name}": {probe_detail}.'
                break
            if state == 'silent' and accept_silent:
                record['attempts'].append(attempt)
                record['recovered'] = True
                record['summary'] = (f'"{name}" brought the dongle back (it opens and runs), '
                                     'but no 433MHz traffic was heard during the check.')
                break

        record['attempts'].append(attempt)

    record['finished_at'] = int(time.time())
    if not record['summary']:
        tried = ', '.join(f'{a["step"]}={"ok" if a["ok"] else "failed"}'
                          for a in record['attempts'])
        if record.get('opens_but_silent'):
            # Worth separating out: the dongle is answering, so the ladder did
            # its job and the fault has moved downstream - antenna, sensors, or
            # a band that really is empty. Replugging that fixes nothing.
            record['summary'] = (f'USB recovery ran every step ({tried}) and the dongle now opens '
                                 'normally, but still decoded nothing - the receiver is alive, so '
                                 'check the antenna connection and the sensors themselves.')
        else:
            record['summary'] = (f'USB recovery exhausted every step ({tried}) and the receiver is '
                                 'still not decoding - the dongle likely needs a physical replug.')
    return record


def describe_environment():
    """Everything a person needs to judge remote recovery, without a shell.

    Printed by --probe, and worth reading once after install: it says up front
    whether this Pi can cut USB power at all, which decides whether the last
    rung is real or theoretical here.
    """
    device = find_sdr()
    hubs, hub_error = uhubctl_survey()
    hub, hub_port = locate_in_hubs(hubs)
    return {
        'device': device,
        'remembered_port': recall_port(),
        'rtl433': find_rtl433(),
        'uhubctl_error': hub_error,
        'hubs': [{'location': h['location'], 'switchable': h['switchable'],
                  'devices': len(h['ports'])} for h in hubs],
        'dongle_hub': hub['location'] if hub else None,
        'dongle_hub_port': hub_port,
        'power_cycle_available': bool(hub and hub['switchable']),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--step', choices=sorted(STEPS),
                        help='run a single rung (this is how the monitor calls us via sudo)')
    parser.add_argument('--port', help='sysfs USB port id the step applies to, e.g. 1-1.4')
    parser.add_argument('--probe', action='store_true',
                        help='report what is on the bus and whether power cycling is possible')
    parser.add_argument('--probe-seconds', type=int, default=30,
                        help='how long to listen when verifying a rung (default 30)')
    parser.add_argument('--json', action='store_true', help='machine-readable output')
    args = parser.parse_args()

    if args.probe:
        info = describe_environment()
        state, detail = probe(args.probe_seconds)
        info['receiver'] = state
        info['receiver_detail'] = detail
        print(json.dumps(info, indent=2) if args.json else _format_probe(info))
        return 0

    if args.step:
        if os.geteuid() != 0:
            print('a single step must run as root (this is the sudo entry point)',
                  file=sys.stderr)
            return 2
        port = args.port or (find_sdr() or {}).get('port') or recall_port()
        remember_port(port)
        ok, detail = STEPS[args.step](port)
        print(detail)
        return 0 if ok else 1

    record = recover(probe_seconds=args.probe_seconds)
    if args.json:
        print(json.dumps(record, indent=2))
    else:
        for attempt in record['attempts']:
            mark = 'ok  ' if attempt['ok'] else 'fail'
            print(f'[{mark}] {attempt["step"]}: {attempt["detail"]}')
            if attempt.get('probe_detail'):
                print(f'         probe: {attempt["probe_detail"]}')
        print(record['summary'])
    return 0 if record['recovered'] else 1


def _format_probe(info):
    lines = []
    device = info['device']
    if device:
        lines.append(f'RTL-SDR: {device["product"]} at {device["port"]} '
                     f'({device["vid"]}:{device["pid"]})')
    else:
        lines.append('RTL-SDR: NOT on the USB bus'
                     + (f' (last seen at {info["remembered_port"]})' if info['remembered_port'] else ''))
    lines.append(f'rtl_433: {info["rtl433"] or "not found"}')
    lines.append(f'receiver: {info["receiver"]} - {info["receiver_detail"]}')
    if info['uhubctl_error']:
        lines.append(f'power cycling: unavailable - {info["uhubctl_error"]}')
    elif info['power_cycle_available']:
        lines.append(f'power cycling: available on hub {info["dongle_hub"]} '
                     f'port {info["dongle_hub_port"]}')
    else:
        lines.append('power cycling: NOT available - no hub here can switch this port\'s power')
    for hub in info['hubs']:
        lines.append(f'  hub {hub["location"]}: '
                     f'{"switchable" if hub["switchable"] else "power always on"}, '
                     f'{hub["devices"]} device(s)')
    return '\n'.join(lines)


if __name__ == '__main__':
    sys.exit(main())
