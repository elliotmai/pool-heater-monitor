#!/usr/bin/env python3
"""
Offline regression tests for pool_monitor.py's dashboard-command handling.

No Pi, no Firebase, no hardware — run it anywhere:

    python3 pi-files/test_commands.py

These cover the part of the protocol the dashboard reads back as a diagnosis.
A restart request that the monitor never stamps is indistinguishable, from the
outside, from a monitor that has stopped looping — the dashboard said "it isn't
looping" for both. So what gets stamped, and when, is the contract under test:

  * a fresh request is claimed exactly once,
  * a request older than this process is marked superseded, not left pending,
  * a request already handled is never touched again (no restart loop),
  * reset_sdr has no start-time gate, which is what makes an unclaimed one
    real evidence that the loop has stopped,
  * a database that refuses command reads says so where the dashboard shows it.
"""
import os
import sys
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
MONITOR = os.path.join(HERE, 'pool_monitor.py')


class FakeRef:
    """Stands in for a firebase_admin db reference to one command node."""

    def __init__(self, value=None, raises=None):
        self.value = value
        self.raises = raises
        self.updates = []

    def get(self):
        if self.raises:
            raise self.raises
        return self.value

    def update(self, fields):
        self.updates.append(fields)
        self.value = dict(self.value or {}, **fields)

    @property
    def status(self):
        return (self.value or {}).get('status')


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
    claim_command = ns['claim_command']

    logged = []
    ns['log_to_db'] = lambda level, message: logged.append((level, message))

    def with_node(ref):
        ns['db'].reference = lambda path: ref

    failures = 0

    def check(label, ok):
        nonlocal failures
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {label}")

    # Real clock: the contract is that the Pi stamps handled_at no earlier than
    # the moment the dashboard asked, so a fabricated future NOW would test a
    # state that cannot occur (and mask the skew case checked further down).
    NOW = int(time.time())

    # --- a fresh request is claimed, exactly once ---
    ref = FakeRef({'requested_at': NOW, 'status': 'requested'})
    with_node(ref)
    claimed = claim_command('restart', 'restarting', newer_than=NOW - 600)
    check('a request newer than the process is claimed', claimed is not None)
    check('claiming marks it restarting', ref.status == 'restarting')
    check('claiming stamps handled_at', (ref.value.get('handled_at') or 0) >= NOW)

    again = claim_command('restart', 'restarting', newer_than=NOW - 600)
    check('re-reading the claimed node finds nothing (no restart loop)', again is None)
    check('and writes nothing the second time', len(ref.updates) == 1)

    # --- the orphan case: a request from before this process started ---
    # The monitor restarted for its own reasons (the SDR watchdog exits, and
    # systemd brings it back) after the request was written. Nothing will ever
    # act on it, so it must not be left looking pending forever.
    ref = FakeRef({'requested_at': NOW - 3600, 'status': 'requested'})
    with_node(ref)
    claimed = claim_command('restart', 'restarting', newer_than=NOW)
    check('a request predating the process is not acted on', claimed is None)
    check('but it is stamped superseded, not left pending', ref.status == 'superseded')
    check('superseded carries handled_at so the dashboard can date it',
          (ref.value.get('handled_at') or 0) > 0)

    settled = claim_command('restart', 'restarting', newer_than=NOW)
    check('a superseded request is then left alone', settled is None and len(ref.updates) == 1)

    # --- reset_sdr has no start-time gate (newer_than defaults to 0) ---
    # This is what makes an unclaimed reset_sdr trustworthy evidence: one
    # completed cycle claims it no matter when the process started.
    ref = FakeRef({'requested_at': NOW - 86400, 'status': 'requested'})
    with_node(ref)
    claimed = claim_command('reset_sdr', 'running')
    check('an old reset_sdr request is still claimed', claimed is not None)
    check('reset_sdr is never marked superseded', ref.status == 'running')

    # --- a node that was never written ---
    with_node(FakeRef(None))
    check('a missing command node is not a command', claim_command('restart', 'restarting') is None)

    # --- a database that refuses command reads must be visible in the app ---
    ns['_last_logged'].clear()
    logged.clear()
    with_node(FakeRef({'requested_at': NOW}, raises=RuntimeError('permission denied')))
    check('a failed command read returns None', claim_command('restart', 'restarting') is None)
    check('a failed command read reaches the dashboard log', len(logged) == 1)
    check('logged at a level the app surfaces', logged and logged[0][0] == 'WARNING')
    check('the log names the consequence, not just the error',
          logged and 'will not be picked up' in logged[0][1])

    first = logged[0][1]
    with_node(FakeRef({'requested_at': NOW}, raises=RuntimeError('permission denied (attempt 2)')))
    claim_command('restart', 'restarting')
    check('the message is stable across repeats, so the throttle dedupes it',
          len(logged) == 1 and first == logged[0][1])

    # --- a browser clock running ahead of the Pi must not cause a loop ---
    # requested_at comes from the browser. If it is stamped later than the Pi's
    # own clock, handled_at has to catch up to it anyway; otherwise the request
    # never counts as handled and the monitor restarts every single cycle.
    ref = FakeRef({'requested_at': NOW + 3600, 'status': 'requested'})
    with_node(ref)
    check('a request from a fast browser clock is claimed once',
          claim_command('restart', 'restarting', newer_than=NOW) is not None)
    check('handled_at is never left behind requested_at',
          ref.value['handled_at'] >= ref.value['requested_at'])
    check('so the next cycle does not claim it again (no restart loop)',
          claim_command('restart', 'restarting', newer_than=NOW) is None)

    print('\n' + ('All checks passed.' if not failures else f'{failures} check(s) FAILED.'))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
