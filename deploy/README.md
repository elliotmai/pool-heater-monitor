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
| `pool-deploy.sudoers` | `/etc/sudoers.d/pool-deploy` | lets `pi` restart the monitor without a password |

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
