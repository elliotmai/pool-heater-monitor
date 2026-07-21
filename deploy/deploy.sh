#!/usr/bin/env bash
#
# Pull-based deploy for the pool-heater-monitor Pi.
#
# Run on a systemd timer (see pi-deploy.timer). Each run:
#   1. fetches the latest commit on `main`
#   2. if there's nothing new, exits immediately (cheap)
#   3. otherwise fast-forwards the local checkout to the remote
#   4. if any pi-files/ changed, rsyncs them into ~/Desktop and restarts
#      the pool-monitor service so the new code takes effect
#
# The Firebase service-account key is never touched (it lives only on the Pi).
#
# Usage:
#   deploy.sh            # normal timer run (deploy only when pi-files change)
#   deploy.sh --force    # sync + restart even if nothing changed (initial setup)

set -euo pipefail

REPO_DIR="/home/pi/pool-heater-monitor"
DEST="/home/pi/Desktop"
BRANCH="main"
FORCE="${1:-}"

cd "$REPO_DIR"
git fetch --quiet origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

# Up to date and not forced -> nothing to do.
if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" != "--force" ]; then
    exit 0
fi

# Determine whether pi-files/ changed BEFORE we move HEAD.
PI_CHANGED="$(git diff --name-only "$LOCAL" "$REMOTE" -- pi-files/ || true)"

# Fast-forward the working copy to match the remote exactly.
if [ "$LOCAL" != "$REMOTE" ]; then
    echo "$(date '+%F %T') Updating ${LOCAL:0:7} -> ${REMOTE:0:7}"
    git reset --hard "origin/$BRANCH"
fi

# Deploy only if pi-files changed, or if forced.
if [ -z "$PI_CHANGED" ] && [ "$FORCE" != "--force" ]; then
    echo "Repo updated; no pi-files changes to deploy."
    exit 0
fi

echo "Syncing pi-files/ -> $DEST"
# --exclude keeps the Firebase key on the Pi untouched; no --delete so other
# files already on the Desktop (including that key) are left in place.
rsync -av --exclude='*firebase-adminsdk*.json' "$REPO_DIR/pi-files/" "$DEST/"

echo "Restarting pool-monitor.service"
sudo systemctl restart pool-monitor.service

echo "$(date '+%F %T') Deploy complete."
