/**
 * End-user "What's New" entries — NEWEST FIRST.
 *
 * When you ship user-facing changes, bump `version` (use today's date as
 * YYYY.MM.DD) and add a new entry at the top with plain-language, benefit-focused
 * bullets. The next time each person opens the app, the popup shows every entry
 * newer than what their device last saw — so if several releases stacked up
 * between visits, they see them all at once (tracked per-device in localStorage).
 *
 * Skip adding an entry when a release has nothing a user would notice
 * (refactors, config, infra) — the popup only fires when a newer `version` appears.
 */
export const WHATS_NEW = [
  {
    version: '2026.09.03',
    date: 'September 2026',
    items: [
      '🚫 Sensors you switch off in Settings now disappear from the whole app, not just the Overview. The Stats page was still counting them in every figure it showed — highlights, room comparison, min/avg/max, all-time records, reliability and the sensor timeline — and they came along in exported files too. Turning a sensor off now really does mean “stop showing me this”, so a neighbour’s stray thermometer can no longer skew your hottest day or biggest swing.',
      '⚠️ The “no sensor has reported” warning is no longer silenced by a sensor you’ve disabled. A switched-off sensor that keeps transmitting used to count as “something is reporting” and hide a real outage of the sensors you actually watch — and it could make the “quiet for…” time look shorter than it was.',
      '⚙️ Settings still lists every sensor, enabled or not, with its full history intact — switch one back on and all of its readings and records return.',
    ],
  },
  {
    version: '2026.08.31.1',
    date: 'August 2026',
    items: [
      '✅ The Device screen no longer cries wolf. “Restart Monitor” used to warn that the monitor had stopped looping whenever a request went unanswered — including when the monitor simply restarted on its own first, which is the normal case. It now tells those apart, and says which one you’re looking at.',
      '🔎 When a command goes unanswered, the app now checks whether readings are still arriving before blaming the Pi — so it can point at the real problem: the Pi being off, or the monitor running but unable to read commands (which it now records in the logs instead of failing silently).',
    ],
  },
  {
    version: '2026.08.31',
    date: 'August 2026',
    items: [
      '⬇️ You can now export your data. Every screen has an “Export” button that saves what you’re looking at as a CSV (for spreadsheets) or JSON (for scripts) — the readings behind the chart window you’re viewing, the stats summary, your filtered logs, the current snapshot, or your sensor list.',
    ],
  },
  {
    version: '2026.08.26',
    date: 'August 2026',
    items: [
      '🔌 New “Reset Receiver (USB)” button — the software version of unplugging and replugging the sensor dongle, so a stuck receiver no longer means a trip to the Pi. It tells you which step fixed it.',
      '🩺 When the receiver goes deaf, the Pi now resets the dongle itself instead of just restarting — and if the dongle is fine but nothing is being heard, it says to check the antenna and sensors rather than sending you out to replug it.',
    ],
  },
  {
    version: '2026.08.21',
    date: 'August 2026',
    items: [
      '⚠️ The app now warns you when the Pi is online but no sensor has reported — previously that looked completely normal, because the Pi keeps sending weather and heartbeats either way.',
      '🛠️ Fixed a bug that could silently discard every wireless sensor reading, and the Pi now reports why readings stopped (receiver dead vs. sensors quiet).',
      '🔄 “Restart Monitor” now shows whether the Pi actually picked the request up — and warns you when it never did.',
    ],
  },
  {
    version: '2026.07.26',
    date: 'July 2026',
    items: [
      '🐛 Spot a bug or have an idea? There’s now a “Report a bug or request a feature” link in the footer.',
    ],
  },
];
