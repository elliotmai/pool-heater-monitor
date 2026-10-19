# Home server plan

Living plan for the self-hosted home setup. Costs are rough USD estimates from
memory, not live prices: verify before buying.

## Goals

- One always-on, local-first home hub: cameras, sensors, weather, files, apps.
- No single point of failure; a loud, independent warning when something is down.
- Works for both an iPhone and an Android user, at home and away.
- Built incrementally; nothing is retired until its replacement has run cleanly
  for a few weeks.

## Architecture

| Piece | Role |
|---|---|
| **Node A** (mini PC, Intel iGPU) | Primary: Home Assistant, Frigate, Plex, Paperless, databases, apps |
| **Node B** (mini PC) | Warm standby for A: ZFS replication, Proxmox HA failover |
| **Node C** (lighter mini PC) | DNS, MQTT, monitoring, Postgres replica, backup server (Proxmox Backup Server) |
| **NAS** (TrueNAS, ZFS RAIDZ2) | Separate physical box. Irreplaceable pool (photos, documents, databases) is kept apart from the large media pool |
| **Camera drives** | Surveillance-rated, separate from the NAS pool; 24/7 recording |
| **Pis** (boot from SSD, never SD) | Secondary DNS, two Tailscale subnet routers, radio gateway, external watcher (Uptime Kuma) |
| **ESP32 + CC1101** | Replaces the USB RTL-SDR dongle (pilot first) |
| **PoE switch, UPS units** | PoE cameras; UPS on nodes, NAS, router and camera switch, shut down cleanly via NUT |

Host: **Proxmox** on all three nodes (3-node quorum, no tie-breaker needed).
Docker runs inside a Debian VM/container. Home Assistant OS is its own VM.
Ceph is skipped: ZFS replication plus database-level replication is enough.

## Services

- **Core:** Home Assistant, Mosquitto (MQTT), AdGuard Home or Pi-hole (two
  instances sharing a virtual IP), Tailscale, Caddy reverse proxy with real
  HTTPS via a cheap domain and DNS challenge.
- **Cameras:** Frigate (continuous recording, detection, alerts, live view via
  go2rtc). PoE IP cameras with RTSP/ONVIF replace Blink. 4 cameras now, plan
  for 8-16.
- **Files:** Plex (hardware transcoding needs Plex Pass), Paperless-ngx,
  Syncthing or Nextcloud, Immich.
- **Voice and AI:** Home Assistant Assist (Whisper, Piper), local LLM via
  Ollama and Open WebUI, optional Claude API fallback. GPU is a later add.
- **Automation:** Home Assistant automations, Node-RED or n8n.
- **Dev:** Forgejo, Docker Compose, Postgres with a replica on another node.

## Notifications (iPhone + Android)

- Home Assistant Companion app on both phones. Alerts go through Apple and
  Google push, so they arrive at home or away. Critical alerts can break
  through Do Not Disturb on both platforms.
- Remote access: Tailscale on both phones. Notification images and live video
  need to reach the server.
- Apps use standard web push. On iPhone, web push only works for a PWA
  installed to the Home Screen (iOS 16.4+).
- Property Maintenance: replace the unused SMS path with web push; remove the
  Express/Twilio server.

## Server-down warning

The alert must not depend on the thing that is down.

1. **External dead-man's switch.** The server pings an outside service
   (Healthchecks.io) every minute; missed pings alert both phones by email and
   push (ntfy or Pushover).
2. **Internal watcher.** Uptime Kuma on a Pi outside the cluster checks every
   node and service, alerting via ntfy or Pushover.
3. **Hardware events.** UPS on battery (NUT), degraded ZFS pools, SMART
   failures.
4. **Silence alarms.** Backups ping on success (a missed backup alerts); radio
   or ESP32 sensors alert when no readings arrive.
5. **Monthly pull-the-plug drill** to confirm alerts reach both phones.

## Storage

- Irreplaceable data (photos, documents, databases): ZFS with snapshots, a
  second copy on another device, and an encrypted off-site copy.
- Media (Plex, games): large separate pool with redundancy, no off-site copy.
  Size the case for growth (8+ bays); check current OpenZFS docs on RAIDZ
  expansion before relying on it.
- Cameras: about 40 GB per camera per day at 4 Mbps; 8 cameras for 30 days is
  about 10 TB.

## Apps

| App | Destination |
|---|---|
| Pool heater monitor | Folded into Home Assistant; Firebase history imported, then retired |
| Galaxy Farm | Local Postgres (already designed for this) |
| Cattle registry graph | Neo4j Community on the server, replacing Aura. Community cannot cluster: rely on VM failover plus scheduled dumps. Back up crawler state while crawlers are stopped |
| ZNT Cattle | Merged into Galaxy Farm |
| Let's Eat, Property Maintenance | Small apps moved to Postgres and new auth |
| MyKitchenManager | Last: heavy Firestore realtime use, auth, storage and a Claude vision function |

Everything private sits behind Tailscale; no public hosting.

## Build phases

**Phase 0 - this week, about $25.** Rotate any exposed credentials; fix or
remove the open SMS endpoint; export backups of every database; run
`rtl_433 -F json` for exact sensor models; order the ESP32 + CC1101.
*Done when:* credentials rotated and every database backed up.

**Phase 1 - foundation, about $800-1,100.** Node A, mirrored NVMe, one UPS.
Proxmox, Tailscale, Home Assistant, Mosquitto, DNS (existing Pi as secondary),
the server-down warning (layers 1 and 2), nightly backups. Fold in the pool
monitor; ESP32 pilot alongside the dongle.
*Done when:* pool temps show in Home Assistant, a restore works, and the ESP32
has run a week.

**Phase 2 - storage, about $1,200-1,800.** NAS box and first drives.
TrueNAS/ZFS, snapshots, off-site backup. Immich, Paperless, Syncthing; start
the Plex library.
*Done when:* a deleted photo restores from a snapshot and from off-site.

**Phase 3 - cameras, about $800-1,100.** PoE switch, 4 cameras, camera drives,
Frigate. Retire Blink after two weeks in parallel.
*Done when:* a person in the yard triggers a phone alert with a snapshot and
last week's footage plays back.

**Phase 4 - high availability, about $700-1,000.** Node B and a second UPS.
Cluster, ZFS replication, Proxmox HA, Postgres replica, DNS virtual IP.
*Done when:* unplugging Node A brings services back on B unaided.

**Phase 5 - app migration (time, not money).** Starts once Phase 2 is stable.
Galaxy Farm, then the cattle graph, then the small apps, MyKitchenManager
last. Keep each cloud service 2-4 weeks after cutover.

**Phase 6 - third node and Pi roles, about $300-600.** Node C, Proxmox Backup
Server, remaining Pis, Tailscale subnet routers, external watcher.
*Done when:* powering off any one device stops nothing important.

**Phase 7 - optional.** GPU for voice and local AI, media expansion, game
streaming, extras.

Every phase: test a backup before migrating, run a failure drill at the end,
write down the restore steps.

## Cost summary

| | Lean | Full |
|---|---|---|
| Hardware | about $4,000 | about $11,000 |
| Software | free/open source; Plex Pass optional (about $120/yr or lifetime); off-site backup a few dollars per TB per month | |
| Electricity | about $200-300/yr | |

Drives are the biggest swing; the Plex library size is the main unknown.

## Open questions

- Plex library size (assumed very large).
- Sensor model names from `rtl_433` (for the ESP32 pilot).
- Weather station brand.
- Total hardware budget.
