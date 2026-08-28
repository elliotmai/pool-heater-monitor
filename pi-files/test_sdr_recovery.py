#!/usr/bin/env python3
"""
Offline regression tests for sdr_recovery.py's escalation ladder.

No RTL-SDR, no root, no Pi hardware needed — run it anywhere:

    python3 pi-files/test_sdr_recovery.py

The ladder is code that, by definition, only runs when nobody is watching and
the hardware is already broken, so the parts that can be tested on a laptop are
tested here: which rung fires when, when we stop climbing, how uhubctl output is
read, and that a port id from the network can never reach a sysfs write.
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sdr_recovery


UHUBCTL_OUTPUT = """Current status for hub 1-1 [2109:3431 USB2.0 Hub, USB 2.10, 4 ports, ppps]
  Port 1: 0503 power highspeed enable connect [0bda:2838 Realtek RTL2838UHIDIR SN: 00000001]
  Port 2: 0100 power
Current status for hub 2 [1d6b:0003 Linux xhci-hcd xHCI Host Controller, USB 3.00, 4 ports]
  Port 1: 02a0 power 5gbps Rx.Detect
"""

# A build that DOES report capabilities, on a hub that cannot switch power.
UHUBCTL_NO_PPPS = """Current status for hub 1-1 [2109:3431 USB2.0 Hub, USB 2.10, 4 ports, nops]
  Port 1: 0503 power highspeed enable connect [0bda:2838 Realtek RTL2838UHIDIR SN: 00000001]
"""

# uhubctl 2.0.0 (what Raspbian Buster ships) prints no capability flags at all.
# Silence here must not be read as "this hardware cannot cut power".
UHUBCTL_OLD_NO_FLAGS = """Current status for hub 1 [1d6b:0002 Linux xhci-hcd xHCI Host Controller, USB 2.00, 1 ports]
  Port 1: 0503 power highspeed enable connect [0bda:2838 Realtek RTL2838UHIDIR SN: 00000001]
"""

# A real Raspberry Pi 4 (astraPi). Every external socket sits behind a built-in
# VIA hub that uhubctl will not control, so the dongle never appears in the
# listing — only the root hubs do. Cutting root hub 1 port 1 still power-cycles
# it, verified on the hardware: both the VIA hub and the dongle came back with
# new device numbers. Finding that path is what locate_in_hubs has to do.
UHUBCTL_PI4 = """Current status for hub 2 [1d6b:0003 Linux 5.10.17-v7l+ xhci-hcd xHCI Host Controller 0000:01:00.0, USB 3.00, 4 ports]
  Port 1: 02a0 power 5gbps Rx.Detect
  Port 2: 02a0 power 5gbps Rx.Detect
Current status for hub 1 [1d6b:0002 Linux 5.10.17-v7l+ xhci-hcd xHCI Host Controller 0000:01:00.0, USB 2.00, 1 ports]
  Port 1: 0503 power highspeed enable connect [2109:3431 USB2.0 Hub, USB 2.10, 4 ports]
"""


class Fake:
    """Swap module-level functions out for the duration of a test."""

    def __init__(self, **replacements):
        self.replacements = replacements
        self.saved = {}

    def __enter__(self):
        for name, value in self.replacements.items():
            self.saved[name] = getattr(sdr_recovery, name)
            setattr(sdr_recovery, name, value)
        return self

    def __exit__(self, *exc):
        for name, value in self.saved.items():
            setattr(sdr_recovery, name, value)
        return False


def fake_run(stdout='', returncode=0, stderr=''):
    def run(cmd, **kwargs):
        return types.SimpleNamespace(stdout=stdout, stderr=stderr, returncode=returncode)
    return run


def main():
    failures = 0

    def check(label, ok):
        nonlocal failures
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {label}")

    # --- uhubctl output parsing -------------------------------------------
    with Fake(subprocess=types.SimpleNamespace(
            run=fake_run(UHUBCTL_OUTPUT),
            PIPE=-1, STDOUT=-2, DEVNULL=-3,
            TimeoutExpired=Exception, CalledProcessError=Exception)):
        hubs, error = sdr_recovery.uhubctl_survey()
    check('uhubctl output parses without error', error is None and len(hubs) == 2)
    check('a hub advertising ppps is switchable', hubs[0]['switchable'] is True)
    check('a hub without ppps is not switchable', hubs[1]['switchable'] is False)
    hub, port = sdr_recovery.locate_in_hubs(hubs)
    check('the dongle is located by its USB id', hub['location'] == '1-1' and port == 1)

    with Fake(subprocess=types.SimpleNamespace(
            run=fake_run(UHUBCTL_NO_PPPS),
            PIPE=-1, STDOUT=-2, DEVNULL=-3,
            TimeoutExpired=Exception, CalledProcessError=Exception)):
        ok, detail = sdr_recovery.step_power('1-1.1')
    check('a hub that cannot switch power says so instead of pretending',
          not ok and 'cannot be cut in software' in detail)

    # An old uhubctl reports no capabilities at all. Listing a hub is uhubctl's
    # own statement that it can control it, so that must not be misread as "no".
    with Fake(subprocess=types.SimpleNamespace(
            run=fake_run(UHUBCTL_OLD_NO_FLAGS),
            PIPE=-1, STDOUT=-2, DEVNULL=-3,
            TimeoutExpired=Exception, CalledProcessError=Exception)):
        old_hubs, old_error = sdr_recovery.uhubctl_survey()
    check('a uhubctl too old to report capabilities is not read as "cannot switch"',
          old_error is None and old_hubs[0]['switchable'] is True)
    check('...and it is recorded that the capability was never actually reported',
          old_hubs[0]['capability_reported'] is False)

    # --- finding a power-cyclable hub on a Pi 4 ----------------------------
    with Fake(subprocess=types.SimpleNamespace(
            run=fake_run(UHUBCTL_PI4),
            PIPE=-1, STDOUT=-2, DEVNULL=-3,
            TimeoutExpired=Exception, CalledProcessError=Exception)):
        pi4_hubs, pi4_error = sdr_recovery.uhubctl_survey()
    check('the Pi 4 listing parses', pi4_error is None and len(pi4_hubs) == 2)
    check('a dongle uhubctl cannot see is not found by USB id alone',
          sdr_recovery.locate_in_hubs(pi4_hubs) == (None, None))
    pi4_hub, pi4_port = sdr_recovery.locate_in_hubs(pi4_hubs, '1-1.2')
    check('walking up the topology finds the root hub port that does cut power',
          pi4_hub is not None and pi4_hub['location'] == '1' and pi4_port == 1)

    # --- topology arithmetic ----------------------------------------------
    check("a hub port id splits into (hub, port)",
          sdr_recovery.parent_location_and_port('1-1.2') == ('1-1', '2'))
    check('a device straight off a root hub names the bus as its hub',
          sdr_recovery.parent_location_and_port('1-1') == ('1', '1'))
    check('deep chains split at the last hop',
          sdr_recovery.parent_location_and_port('1-1.4.2') == ('1-1.4', '2'))
    check('a root hub port names the subtree below it',
          sdr_recovery.subtree_root('1', 1) == '1-1')
    check('a downstream hub port names the subtree below it',
          sdr_recovery.subtree_root('1-1', 2) == '1-1.2')

    # Cutting upstream takes the whole subtree down. The dongle itself is not
    # "collateral"; anything else sharing the cut is, and must be named.
    with Fake(list_usb_devices=lambda: [
            {'port': '1-1', 'vid': '2109', 'pid': '3431', 'product': 'USB2.0 Hub',
             'manufacturer': '', 'known_sdr': False},
            {'port': '1-1.2', 'vid': '0bda', 'pid': '2838', 'product': 'RTL2838UHIDIR',
             'manufacturer': '', 'known_sdr': True},
            {'port': '2-1', 'vid': '1234', 'pid': '5678', 'product': 'Elsewhere',
             'manufacturer': '', 'known_sdr': False}]):
        also = sdr_recovery.collateral_devices('1', 1, '1-1.2')
    check('everything under the cut point is reported as collateral',
          [d['port'] for d in also] == ['1-1'])

    # --- probe classification ---------------------------------------------
    # Telling "opened but heard nothing" apart from "could not open the dongle"
    # is the whole basis for deciding whether to keep climbing the ladder.
    with Fake(find_rtl433=lambda: '/usr/bin/rtl_433',
              subprocess=types.SimpleNamespace(
                  run=fake_run('{"model":"Oria-TH","temperature_C":21.0}\n'),
                  PIPE=-1, STDOUT=-2, DEVNULL=-3,
                  TimeoutExpired=Exception, CalledProcessError=Exception)):
        state, _ = sdr_recovery.probe(1)
    check('decoded packets mean the receiver is working', state == 'packets')

    with Fake(find_rtl433=lambda: '/usr/bin/rtl_433',
              subprocess=types.SimpleNamespace(
                  run=fake_run('', stderr='Reading samples in async mode...\n'),
                  PIPE=-1, STDOUT=-2, DEVNULL=-3,
                  TimeoutExpired=Exception, CalledProcessError=Exception)):
        state, _ = sdr_recovery.probe(1)
    check('no packets but a clean open is "silent", not a dead dongle', state == 'silent')

    with Fake(find_rtl433=lambda: '/usr/bin/rtl_433',
              subprocess=types.SimpleNamespace(
                  run=fake_run('', stderr='No supported devices found.\n'),
                  PIPE=-1, STDOUT=-2, DEVNULL=-3,
                  TimeoutExpired=Exception, CalledProcessError=Exception)):
        state, _ = sdr_recovery.probe(1)
    check('a dongle that will not open is reported as no_device', state == 'no_device')

    with Fake(find_rtl433=lambda: None):
        state, _ = sdr_recovery.probe(1)
    check('a missing rtl_433 is not mistaken for a dead dongle', state == 'no_tool')

    # --- the ladder --------------------------------------------------------
    device = {'port': '1-1.4', 'vid': '0bda', 'pid': '2838', 'busnum': 1, 'devnum': 7,
              'product': 'RTL2838UHIDIR', 'serial': '00000001'}

    tried = []

    def step_recorder(result_by_step):
        def run_step(name, port):
            tried.append(name)
            return result_by_step.get(name, (False, 'failed'))
        return run_step

    # The cheapest rung works: nothing else should be disturbed.
    tried.clear()
    with Fake(find_sdr=lambda: device, remember_port=lambda port: None,
              run_privileged_step=step_recorder({'reset': (True, 'reset ok')}),
              probe=lambda seconds=30, rtl433_path=None: ('packets', 'decoded 3 packet(s)')):
        record = sdr_recovery.recover(probe_seconds=1)
    check('a working reset stops the ladder immediately', tried == ['reset'])
    check('a recovered dongle is reported as recovered', record['recovered'] is True)
    check('the summary names the step that worked', 'reset' in record['summary'])

    # The reset runs but the receiver is still dead: climb.
    tried.clear()
    probes = iter([('no_device', 'still dead'), ('packets', 'decoded 5 packet(s)')])
    with Fake(find_sdr=lambda: device, remember_port=lambda port: None,
              run_privileged_step=step_recorder({'reset': (True, 'reset ok'),
                                                 'rebind': (True, 'rebound')}),
              probe=lambda seconds=30, rtl433_path=None: next(probes)):
        record = sdr_recovery.recover(probe_seconds=1)
    check('a step that runs but does not revive the dongle escalates',
          tried == ['reset', 'rebind'])
    check('the escalated step is credited', 'rebind' in record['summary'])

    # A rung that cannot run at all must not be treated as a fix.
    tried.clear()
    with Fake(find_sdr=lambda: None, recall_port=lambda: '1-1.4', remember_port=lambda p: None,
              run_privileged_step=step_recorder({'power': (True, 'power cycled')}),
              probe=lambda seconds=30, rtl433_path=None: ('packets', 'decoded 2 packet(s)')):
        record = sdr_recovery.recover(probe_seconds=1)
    check('a dongle off the bus still climbs to the power rung',
          tried == ['reset', 'rebind', 'authorize', 'power'])
    check('the power cycle can recover a dongle that vanished', record['recovered'] is True)

    # "Opens but decodes nothing": whether that counts as recovered depends on
    # who asked. A person pressing the button may just have a quiet band; the
    # watchdog has already ruled that out by listening for minutes.
    tried.clear()
    with Fake(find_sdr=lambda: device, remember_port=lambda port: None,
              run_privileged_step=step_recorder({'reset': (True, 'reset ok'),
                                                 'rebind': (True, 'rebound'),
                                                 'authorize': (True, 'reauthorized'),
                                                 'power': (True, 'power cycled')}),
              probe=lambda seconds=30, rtl433_path=None: ('silent', 'opened but heard nothing')):
        record = sdr_recovery.recover(probe_seconds=1, accept_silent=True)
    check('an on-demand reset stops once the dongle opens again', tried == ['reset'])
    check('a re-opened dongle counts as recovered on demand', record['recovered'] is True)

    tried.clear()
    with Fake(find_sdr=lambda: device, remember_port=lambda port: None,
              run_privileged_step=step_recorder({'reset': (True, 'reset ok'),
                                                 'rebind': (True, 'rebound'),
                                                 'authorize': (True, 'reauthorized'),
                                                 'power': (True, 'power cycled')}),
              probe=lambda seconds=30, rtl433_path=None: ('silent', 'opened but heard nothing')):
        record = sdr_recovery.recover(probe_seconds=1, accept_silent=False)
    check('the watchdog keeps climbing through a silent probe',
          tried == ['reset', 'rebind', 'authorize', 'power'])
    check('a silent-but-open receiver points at the antenna, not a replug',
          not record['recovered'] and 'antenna' in record['summary'])

    # Everything fails: say plainly that hands are needed.
    tried.clear()
    with Fake(find_sdr=lambda: device, remember_port=lambda port: None,
              run_privileged_step=step_recorder({}),
              probe=lambda seconds=30, rtl433_path=None: ('no_device', 'still dead')):
        record = sdr_recovery.recover(probe_seconds=1)
    check('every rung is tried before giving up',
          tried == ['reset', 'rebind', 'authorize', 'power'])
    check('an exhausted ladder does not claim success', record['recovered'] is False)
    check('an exhausted ladder says a physical replug is needed',
          'physical replug' in record['summary'])

    # --- port ids are never trusted ----------------------------------------
    # `port` reaches sysfs writes and subprocess arguments, and the request to
    # recover can originate from the dashboard, so it is validated first.
    for bad in ('1-1.4; rm -rf /', '../../../etc/passwd', 'usb1', '', None, '1-1.4 4'):
        ok_rebind, _ = sdr_recovery.step_rebind(bad)
        ok_auth, _ = sdr_recovery.step_authorize(bad)
        check(f'a malformed port id is refused: {bad!r}', not ok_rebind and not ok_auth)
    check('a real port id passes validation', bool(sdr_recovery.PORT_RE.match('1-1.4.2')))

    print('\n' + ('All checks passed.' if not failures else f'{failures} check(s) FAILED.'))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
