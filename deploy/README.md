# Pi auto-deploy (pull-based)

The Raspberry Pi (`astraPi`, 32-bit Debian) can't run a GitHub Actions
self-hosted runner — the runner bundles Node 20, which needs a newer
`libstdc++` than this OS provides. Instead, the Pi **polls** the repo on a
1-minute systemd timer and deploys changes itself. No Node, no OS upgrade.

**Flow:** push to `main` → within ~60s the Pi's timer fires → `deploy.sh`
fetches, and if any `pi-files/` changed, `rsync`s them into `~/Desktop/` and
restarts `pool-monitor.service`.

The Firebase service-account key is never synced or committed — it lives only
on the Pi (`~/Desktop/water-heater-...-adminsdk-...json`).

## Files here

| File | Installed to | Purpose |
|------|--------------|---------|
| `deploy.sh` | runs from the checkout | fetch + rsync + restart |
| `pool-monitor.service` | `/etc/systemd/system/` | runs `pool_monitor.py` (fixed path) |
| `pi-deploy.service` | `/etc/systemd/system/` | oneshot that runs `deploy.sh` |
| `pi-deploy.timer` | `/etc/systemd/system/` | triggers the deploy every minute |
| `pool-deploy.sudoers` | `/etc/sudoers.d/pool-deploy` | lets `pi` restart the monitor and run USB recovery without a password |
| `../pi-files/sdr_recovery.py` | `/usr/local/sbin/sdr_recovery.py` | resets/power-cycles a wedged RTL-SDR (root-owned; installed by hand) |

## One-time setup on the Pi

Run these on the Pi (as user `pi`). See the chat/commit for the full annotated
walkthrough; summary below.

```bash
# 0. Prereqs
sudo apt-get update && sudo apt-get install -y git rsync

# 1. Read-only deploy key for the PRIVATE repo
ssh-keygen -t ed25519 -C "astraPi-deploy" -f ~/.ssh/pool_deploy_key -N ""
cat >> ~/.ssh/config <<'EOF'

Host github-pool
  HostName github.com
  User git
  IdentityFile ~/.ssh/pool_deploy_key
  IdentitiesOnly yes
EOF
cat ~/.ssh/pool_deploy_key.pub
# -> add this key at: repo Settings > Deploy keys > Add deploy key
#    (leave "Allow write access" UNCHECKED)

# 2. Clone the repo (deploy-only checkout, separate from ~/Desktop)
git clone git@github-pool:elliotmai/pool-heater-monitor.git ~/pool-heater-monitor

# 3. Retire the old/duplicate autostarts (cron @reboot + rc.local) and the
#    still-running cron instance, so we don't end up with two monitors.
crontab -l | grep -v 'pool_monitor.py' | crontab -
sudo sed -i '/pool_monitor.py/d' /etc/rc.local
pkill -f pool_monitor.py || true

# 4. Remove the dead GitHub Actions runner service
if [ -d ~/Desktop/actions-runner ]; then
  ( cd ~/Desktop/actions-runner && sudo ./svc.sh stop; sudo ./svc.sh uninstall ) || true
fi
#    Also delete the runner in: repo Settings > Actions > Runners > Remove

# 5. Install systemd units + sudoers
chmod +x ~/pool-heater-monitor/deploy/deploy.sh
sudo cp ~/pool-heater-monitor/deploy/pool-monitor.service /etc/systemd/system/
sudo cp ~/pool-heater-monitor/deploy/pi-deploy.service    /etc/systemd/system/
sudo cp ~/pool-heater-monitor/deploy/pi-deploy.timer      /etc/systemd/system/
sudo install -m 0440 -o root -g root \
  ~/pool-heater-monitor/deploy/pool-deploy.sudoers /etc/sudoers.d/pool-deploy
sudo visudo -cf /etc/sudoers.d/pool-deploy   # validate

# 5b. USB recovery helper (see "When the receiver wedges" below).
#     uhubctl is what actually cuts power to the port; without it the helper
#     still works, just without its last and strongest step.
sudo apt-get install -y uhubctl || echo "uhubctl unavailable — power cycling will be skipped"
sudo install -m 0755 -o root -g root \
  ~/pool-heater-monitor/pi-files/sdr_recovery.py /usr/local/sbin/sdr_recovery.py
sudo /usr/local/sbin/sdr_recovery.py --probe    # says whether power cycling is possible here

# 6. First deploy + enable everything
sudo systemctl daemon-reload
~/pool-heater-monitor/deploy/deploy.sh --force     # initial sync to ~/Desktop
sudo systemctl enable --now pool-monitor.service   # start the monitor (single source of truth)
sudo systemctl enable --now pi-deploy.timer        # start the poll loop
```

## Verify

```bash
systemctl status pool-monitor.service --no-pager
systemctl list-timers pi-deploy.timer --no-pager
journalctl -u pi-deploy.service -n 20 --no-pager   # deploy history
```

## Day-to-day

Edit files in `pi-files/`, commit, push. Within a minute the Pi updates itself.
Force an immediate run: `sudo systemctl start pi-deploy.service`.

## When readings stop (but the Pi still looks online)

The Pi writes a reading row every cycle even when no sensor reported, so a
heartbeat and fresh weather do **not** mean the sensors are working. Start with
`/water-heater-user/diagnostics` in the Realtime Database — the Pi overwrites it
every cycle:

| Field | Meaning |
| --- | --- |
| `rf_packets` | 433MHz packets the receiver decoded this scan (any device) |
| `rf_temp_packets` | how many of those carried a temperature |
| `rf_sensors` | how many sensors ended up in the reading |
| `rf_models` | which device models were heard (up to 10) |
| `ds18b20_ok` / `ds18b20_total` | wired sensors that read successfully / present |
| `diagnosis` | `ok`, or a one-line reason there was no data |
| `last_data_unix` | when a real reading last landed |

Read it like this:

- **`rf_packets` is 0** — the receiver is deaf: SDR wedged, unplugged, or the
  antenna is disconnected. The watchdog now resets the USB device itself after
  ~30 min of this (see below), so it should recover without anyone touching it.
- **`rf_packets` > 0 but `rf_temp_packets` is 0** — the SDR is fine and hearing
  the neighborhood, but nothing is transmitting temperatures. Check the sensors'
  batteries and range, and compare `rf_models` against what `rtl_433` calls your
  sensors (`python3 ~/Desktop/test_rtl_sdr.py`). If a decoder renamed a model,
  the `Oria-` filter in `read_rtl433_sensors` needs updating to match.
- **`ds18b20_ok` < `ds18b20_total`** — wired probe wiring/power, not the SDR.

The parsing itself is covered by `python3 pi-files/test_sensor_parsing.py`,
which runs anywhere (no Pi hardware or Firebase needed).

## When the receiver wedges (and restarting doesn't fix it)

The RTL-SDR occasionally locks up after hours of use: it stays plugged in and
visible, but decodes nothing. The confusing part is that the obvious remedies
don't work. Restarting the monitor reopens the same wedged device, and even
rebooting the Pi leaves it wedged — **a soft reboot never removes power from the
USB ports**, so the dongle is never actually reset. Only unplugging it is, which
is why that was the one thing that worked.

`pi-files/sdr_recovery.py` does the same thing in software, climbing an
escalating ladder and stopping at the first rung that gets packets flowing:

| Rung | What it does | Clears |
| --- | --- | --- |
| `reset` | `USBDEVFS_RESET` ioctl | a stalled USB endpoint |
| `rebind` | unbind/bind the usb driver in sysfs | a confused driver state; full re-enumeration |
| `authorize` | `authorized` 0 → 1 | descriptors are re-read from scratch |
| `power` | `uhubctl` port power cycle | everything — this is the real unplug/replug |

It runs from two places:

- **automatically**, when the watchdog sees no sensor data and no 433MHz traffic
  at all for ~30 minutes. Only if the whole ladder fails does it fall back to the
  old behaviour of exiting so systemd restarts the service.
- **on demand**, from **Settings → Device → Reset Receiver (USB)** in the app.
  The Pi picks the request up once per cycle and writes back which rung worked;
  the dashboard shows that text.

Either way the attempt is published to `/water-heater-user/sdr_recovery` in the
Realtime Database — `summary` plus a per-step breakdown of what was tried.

By hand over SSH:

```bash
sudo /usr/local/sbin/sdr_recovery.py --probe   # what's on the bus; can power be cut?
sudo /usr/local/sbin/sdr_recovery.py           # run the ladder now
sudo /usr/local/sbin/sdr_recovery.py --step power --port 1-1.4   # one rung
python3 pi-files/test_sdr_recovery.py          # offline tests, runs anywhere
```

### Can this Pi actually cut USB power?

The `power` rung is the only one equivalent to a physical replug, and it needs a
hub that supports per-port power switching (`ppps` in `uhubctl`'s output). Plenty
of Raspberry Pi models' built-in hubs don't. Run `--probe` once after install: it
says `power cycling: available` or `NOT available` outright.

If it isn't available, the first three rungs still run and usually suffice. To
make the last one real, put a **uhubctl-capable powered USB hub** between the Pi
and the dongle and plug the SDR into that. A smart plug on the Pi's own power
supply is the blunt alternative — it power-cycles the Pi *and* the dongle, which
does clear the wedge, at the cost of rebooting everything.

### Making it wedge less often

Worth doing regardless of recovery:

- **USB autosuspend** is a common cause of exactly this lockup. Check with
  `cat /sys/module/usbcore/parameters/autosuspend`; disable it by adding
  `usbcore.autosuspend=-1` to `/boot/cmdline.txt` (single line) and rebooting.
- **Undervoltage** wedges USB devices too. `vcgencmd get_throttled` should return
  `0x0`; anything else means the power supply or cable needs replacing. A powered
  hub also takes the dongle's draw off the Pi.
- **Heat** — RTL-SDR dongles run hot and get flaky when they cook. A short
  extension cable moving it away from the Pi, and airflow, both help.

### Updating the helper

The privileged copy lives at `/usr/local/sbin/sdr_recovery.py`, root-owned, and
is deliberately *not* what the deploy syncs — pointing sudo at a file the `pi`
user can rewrite would hand `pi` a root shell. So when `pi-files/sdr_recovery.py`
changes, `deploy.sh` prints a warning and the reinstall command; run it:

```bash
sudo install -m 0755 -o root -g root \
  ~/pool-heater-monitor/pi-files/sdr_recovery.py /usr/local/sbin/sdr_recovery.py
```
