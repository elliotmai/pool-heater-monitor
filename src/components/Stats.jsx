import React, { useState, useEffect, useMemo } from 'react';
import { Box, Card, CardContent, Typography, Divider, CircularProgress, Avatar } from '@mui/material';
import {
  ArrowUpward, ArrowDownward, DriveFileRenameOutline, PlaceOutlined, WifiOff, Wifi,
  ToggleOn, ToggleOff, AddCircleOutline, History, LocalFireDepartment, AcUnit, SwapVert, Sensors,
} from '@mui/icons-material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchStatsBundle } from '../services/api';
import { enabledSensorKeys, isSensorEnabled } from '../config/settingsUtils';
import ExportButton from './ExportButton';
import { round1 } from '../services/exportData';

const STATS_COLUMNS = [
  { key: 'sensor', label: 'Sensor' },
  { key: 'display_name', label: 'Display Name' },
  { key: 'enabled', label: 'Enabled' },
  { key: 'current_f', label: 'Current (°F)' },
  { key: 'vs_outside_f', label: 'vs Outside (°F)' },
  { key: 'min_24h', label: '24h Min (°F)' },
  { key: 'avg_24h', label: '24h Avg (°F)' },
  { key: 'max_24h', label: '24h Max (°F)' },
  { key: 'min_7d', label: '7d Min (°F)' },
  { key: 'avg_7d', label: '7d Avg (°F)' },
  { key: 'max_7d', label: '7d Max (°F)' },
  { key: 'min_30d', label: '30d Min (°F)' },
  { key: 'avg_30d', label: '30d Avg (°F)' },
  { key: 'max_30d', label: '30d Max (°F)' },
  { key: 'reporting_rate_pct', label: 'Reporting Rate (%)' },
  { key: 'last_reported', label: 'Last Reported' },
];

const fmtDate = (u) => u ? new Date(u * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDateTime = (u) => u ? new Date(u * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const f1 = (n) => (n == null ? '—' : `${n.toFixed(1)}°`);
const signed = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}°`);
const hourLabel = (h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

const META = new Set(['time', 'timestamp', 'unix_timestamp', 'outdoor_temp', 'outdoor_humidity', 'weather_description']);

// Rows are already °F. For bucket rows use ${name}_min/_max; for raw points the
// value itself is the min/max.
const periodStats = (rows, name) => {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const r of rows) {
    const v = r[name];
    if (typeof v !== 'number') continue;
    const lo = typeof r[`${name}_min`] === 'number' ? r[`${name}_min`] : v;
    const hi = typeof r[`${name}_max`] === 'number' ? r[`${name}_max`] : v;
    if (lo < min) min = lo;
    if (hi > max) max = hi;
    sum += v; n += 1;
  }
  return n ? { min, max, avg: sum / n, count: n } : null;
};

const sensorKeysIn = (rows) => {
  const s = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (!META.has(k) && !k.endsWith('_min') && !k.endsWith('_max') && typeof r[k] === 'number') s.add(k);
  }));
  return s;
};

const EVENT_META = {
  renamed: { label: 'Renamed', color: '#007aff', icon: <DriveFileRenameOutline sx={{ fontSize: 16 }} /> },
  moved: { label: 'Moved', color: '#5856d6', icon: <PlaceOutlined sx={{ fontSize: 16 }} /> },
  enabled: { label: 'Enabled', color: '#34c759', icon: <ToggleOn sx={{ fontSize: 16 }} /> },
  disabled: { label: 'Disabled', color: '#8e8e93', icon: <ToggleOff sx={{ fontSize: 16 }} /> },
  offline: { label: 'Went offline', color: '#ff3b30', icon: <WifiOff sx={{ fontSize: 16 }} /> },
  online: { label: 'Back online', color: '#34c759', icon: <Wifi sx={{ fontSize: 16 }} /> },
  added: { label: 'Added', color: '#34c759', icon: <AddCircleOutline sx={{ fontSize: 16 }} /> },
};

const SectionTitle = ({ children }) => (
  <Typography variant="overline" sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px', display: 'block', textAlign: 'center', mb: 1.5 }}>
    {children}
  </Typography>
);

const FunFact = ({ icon, label, value, sub, color }) => (
  <Box sx={{ flex: '1 1 140px', minWidth: 130, bgcolor: '#f8f9fa', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 2, p: 1.5, textAlign: 'center' }}>
    <Box sx={{ color: color || '#8e8e93', mb: 0.5 }}>{icon}</Box>
    <Typography sx={{ fontSize: '18px', fontWeight: 700, color: '#1c1c1e', lineHeight: 1.1 }}>{value}</Typography>
    <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#1c1c1e' }}>{label}</Typography>
    {sub && <Typography sx={{ fontSize: '10px', color: '#8e8e93' }}>{sub}</Typography>}
  </Box>
);

const PeriodRow = ({ label, stat }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', py: 0.5 }}>
    <Typography sx={{ width: 42, fontSize: '11px', fontWeight: 600, color: '#8e8e93' }}>{label}</Typography>
    <Box sx={{ flex: 1, display: 'flex', justifyContent: 'space-around' }}>
      <Typography sx={{ fontSize: '13px', color: '#007aff' }}>{stat ? f1(stat.min) : '—'}</Typography>
      <Typography sx={{ fontSize: '13px', color: '#1c1c1e', fontWeight: 600 }}>{stat ? f1(stat.avg) : '—'}</Typography>
      <Typography sx={{ fontSize: '13px', color: '#ff3b30' }}>{stat ? f1(stat.max) : '—'}</Typography>
    </Box>
  </Box>
);

const relColor = (u) => (u >= 0.8 ? '#34c759' : u >= 0.4 ? '#ff9500' : '#ff3b30');

const RelRow = ({ label, color, uptime, sub, emphasize, topBorder }) => (
  <Box sx={{ py: 0.75, borderTop: topBorder ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: emphasize ? 1 : '50%', bgcolor: color, mr: 1 }} />
      <Typography sx={{ flex: 1, fontSize: emphasize ? '14px' : '13px', fontWeight: emphasize ? 700 : 600, color: '#1c1c1e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
      <Typography sx={{ fontSize: '13px', fontWeight: 700, color: relColor(uptime) }}>{Math.round(uptime * 100)}%</Typography>
    </Box>
    <Box sx={{ height: 5, borderRadius: 3, bgcolor: '#eee', overflow: 'hidden' }}>
      <Box sx={{ width: `${Math.min(100, Math.round(uptime * 100))}%`, height: '100%', bgcolor: relColor(uptime) }} />
    </Box>
    {sub && <Typography sx={{ fontSize: '10px', color: '#8e8e93', mt: 0.25 }}>{sub}</Typography>}
  </Box>
);

const Stats = ({ sensorConfig, latest }) => {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const b = await fetchStatsBundle();
      if (!active) return;
      setBundle(b);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const nameOf = (id) => sensorConfig?.[id]?.displayName || id;
  const colorOf = (id) => sensorConfig?.[id]?.color || '#007aff';

  // `sensorConfig` is a fresh object on every poll (~1 min), so the stats below
  // key off *which* sensors are disabled rather than off the config's identity.
  // Depending on the object directly would rebuild the charts — and replay
  // their animations — once a minute for no change in what's shown.
  const disabledKey = useMemo(
    () => Object.keys(sensorConfig || {}).filter(id => !isSensorEnabled(id, sensorConfig)).sort().join(','),
    [sensorConfig],
  );

  // Every sensor seen in the last 30 days, enabled or not (keeps random RTL
  // pickups visible). Keys come from the readings rather than the config,
  // because the Pi records what it hears whether or not a sensor is enabled.
  const allSensorNames = useMemo(() => {
    if (!bundle) return [];
    const keys = new Set([...sensorKeysIn(bundle.raw7d), ...sensorKeysIn(bundle.hourly30d)]);
    return [...keys].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  // The enabled subset — every figure *shown* on this page derives from this,
  // so a disabled sensor never lands in a shared total. The exports go the
  // other way and use the full list, tagging each row with `enabled`.
  const sensorNames = useMemo(
    () => enabledSensorKeys(allSensorNames, sensorConfig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allSensorNames, disabledKey],
  );

  const nowSec = Math.floor(Date.now() / 1000);

  // Reliability. The Pi now writes a heartbeat row every cycle (~5 min), so:
  //  - Pi/gateway rating = actual cycles / expected cycles over the data span.
  //    A drop here means the Pi itself was down (power/internet).
  //  - Sensor rating = of the cycles the Pi WAS up, how often it reported. This
  //    isolates a flaky sensor from Pi downtime (all sensors missing = Pi's
  //    fault, which shows up in the Pi rating instead).
  const EXPECTED_INTERVAL = 300;
  const reliabilityAll = useMemo(() => {
    if (!bundle) return { pi: null, sensors: [] };
    const rows = bundle.raw7d;
    const actualCycles = rows.length;
    const firstTs = rows.length ? rows[0].unix_timestamp : null;
    const spanSec = firstTs ? Math.min(7 * 86400, nowSec - firstTs) : 7 * 86400;
    const expectedCycles = Math.max(1, Math.round(spanSec / EXPECTED_INTERVAL));
    const lastTs = rows.length ? rows[rows.length - 1].unix_timestamp : null;
    const pi = { uptime: Math.min(1, actualCycles / expectedCycles), actualCycles, expectedCycles, lastTs };

    const sensors = allSensorNames.map(name => {
      let present = 0, sLast = null;
      rows.forEach(r => { if (typeof r[name] === 'number') { present += 1; sLast = r.unix_timestamp; } });
      return { name, uptime: actualCycles ? present / actualCycles : 0, present, lastTs: sLast };
    }).sort((a, b) => b.uptime - a.uptime);

    return { pi, sensors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, allSensorNames]);

  // What the Reliability card shows: the Pi's own rating, plus the enabled
  // sensors only. `reliabilityAll` keeps the disabled ones for the export.
  const reliability = useMemo(
    () => ({
      pi: reliabilityAll.pi,
      sensors: reliabilityAll.sensors.filter(r => isSensorEnabled(r.name, sensorConfig)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reliabilityAll, disabledKey],
  );

  // "Primary" = well-covered sensors (real rooms), used for charts/comparison so
  // one-off RTL pickups don't clutter them.
  const primary = useMemo(() => reliability.sensors.filter(r => r.uptime >= 0.3).map(r => r.name), [reliability]);

  const currentOf = (name) => {
    if (latest && typeof latest[name] === 'number') return latest[name];
    if (!bundle) return null;
    for (let i = bundle.raw7d.length - 1; i >= 0; i--) {
      if (typeof bundle.raw7d[i][name] === 'number') return bundle.raw7d[i][name];
    }
    return null;
  };
  const outdoorNow = useMemo(() => {
    const w = latest?.weather?.temp_f;
    if (typeof w === 'number' && w !== -100) return w;
    if (!bundle) return null;
    for (let i = bundle.raw7d.length - 1; i >= 0; i--) {
      if (typeof bundle.raw7d[i].outdoor_temp === 'number') return bundle.raw7d[i].outdoor_temp;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, latest]);

  const avg7Of = useMemo(() => {
    const m = {};
    if (bundle) sensorNames.forEach(n => { const s = periodStats(bundle.raw7d, n); if (s) m[n] = s.avg; });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, sensorNames]);

  // Room comparison (current temp, delta vs outside, 7d avg), warmest first.
  const rooms = useMemo(() => primary
    .map(name => {
      const current = currentOf(name);
      return { name, current, delta: (current != null && outdoorNow != null) ? current - outdoorNow : null, avg7: avg7Of[name] ?? null };
    })
    .filter(r => r.current != null)
    .sort((a, b) => b.current - a.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primary, outdoorNow, avg7Of]);

  // Average temperature by hour of day (local), from 30d hourly buckets.
  const hourOfDay = useMemo(() => {
    if (!bundle) return [];
    const acc = Array.from({ length: 24 }, () => ({}));
    bundle.hourly30d.forEach(row => {
      const h = new Date(row.unix_timestamp * 1000).getHours();
      primary.forEach(name => {
        const v = row[name];
        if (typeof v === 'number') { const a = acc[h][name] || (acc[h][name] = { sum: 0, n: 0 }); a.sum += v; a.n += 1; }
      });
    });
    return acc.map((slot, h) => {
      const point = { hour: h };
      primary.forEach(name => { const a = slot[name]; if (a && a.n) point[name] = Math.round((a.sum / a.n) * 10) / 10; });
      return point;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, primary]);

  const perSensorAll = useMemo(() => {
    if (!bundle) return [];
    const raw24 = bundle.raw7d.filter(r => r.unix_timestamp >= nowSec - 86400);
    return allSensorNames.map(name => ({
      name, s24: periodStats(raw24, name), s7: periodStats(bundle.raw7d, name), s30: periodStats(bundle.hourly30d, name),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, allSensorNames]);

  // Shown in "Min · Avg · Max by Period"; the export uses perSensorAll instead.
  const perSensor = useMemo(
    () => perSensorAll.filter(p => isSensorEnabled(p.name, sensorConfig)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perSensorAll, disabledKey],
  );

  const fun = useMemo(() => {
    if (!bundle) return null;
    const raw24 = bundle.raw7d.filter(r => r.unix_timestamp >= nowSec - 86400);
    let swing = null;
    sensorNames.forEach(name => {
      const s = periodStats(raw24, name);
      if (s && (!swing || (s.max - s.min) > swing.range)) swing = { name, range: s.max - s.min };
    });
    let hot = null, cold = null;
    bundle.dailyYear.forEach(row => {
      let dMax = -Infinity, dMin = Infinity;
      sensorNames.forEach(name => {
        if (typeof row[`${name}_max`] === 'number') dMax = Math.max(dMax, row[`${name}_max`]);
        if (typeof row[`${name}_min`] === 'number') dMin = Math.min(dMin, row[`${name}_min`]);
      });
      if (dMax > -Infinity && (!hot || dMax > hot.temp)) hot = { temp: dMax, unix: row.unix_timestamp };
      if (dMin < Infinity && (!cold || dMin < cold.temp)) cold = { temp: dMin, unix: row.unix_timestamp };
    });
    return { swing, hot, cold, devices: sensorNames.length, readings7d: bundle.raw7d.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, sensorNames]);

  // Export the numbers this page computed — one row per sensor for CSV, plus
  // the all-time records and the event log in the JSON payload (neither fits a
  // per-sensor table).
  //
  // Unlike everything above, the export covers EVERY sensor, disabled ones
  // included, and carries an `enabled` column so the two never get averaged
  // together by accident. Nothing you can see on screen is lost by switching a
  // sensor off — it just stops being mixed into the shared figures.
  //
  // Built on click rather than on every render (ExportButton resolves a
  // function), so the disabled sensors' stats cost nothing until you ask.
  const buildExportRows = () => {
    const uptimeOf = Object.fromEntries(reliabilityAll.sensors.map(r => [r.name, r]));
    const spread = (stat, suffix) => ({
      [`min_${suffix}`]: stat ? round1(stat.min) : '',
      [`avg_${suffix}`]: stat ? round1(stat.avg) : '',
      [`max_${suffix}`]: stat ? round1(stat.max) : '',
    });
    return perSensorAll.map(({ name, s24, s7, s30 }) => {
      const current = currentOf(name);
      const rel = uptimeOf[name];
      return {
        sensor: name,
        display_name: nameOf(name),
        enabled: isSensorEnabled(name, sensorConfig),
        current_f: round1(current) ?? '',
        vs_outside_f: (current != null && outdoorNow != null) ? round1(current - outdoorNow) : '',
        ...spread(s24, '24h'),
        ...spread(s7, '7d'),
        ...spread(s30, '30d'),
        reporting_rate_pct: rel ? Math.round(rel.uptime * 100) : '',
        last_reported: rel?.lastTs ? new Date(rel.lastTs * 1000).toISOString() : '',
      };
    });
  };

  // `all_time_records` and `events` are the raw nodes, so they already cover
  // the disabled sensors; `sensors` carries the `enabled` flag to tell them
  // apart.
  const exportJson = () => ({
    exported_at: new Date().toISOString(),
    outdoor_now_f: round1(outdoorNow) ?? null,
    pi_reliability: reliabilityAll.pi,
    sensors: buildExportRows(),
    all_time_records: bundle?.records ?? null,
    events: bundle?.events ?? [],
  });

  // The timeline is per-sensor, so a disabled sensor's renames and offline
  // churn stay out of it as well.
  const events = useMemo(
    () => (bundle?.events || []).filter(e => isSensorEnabled(e.sensorId, sensorConfig)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundle, disabledKey],
  );
  const describe = (e) => {
    if (e.event === 'renamed' || e.event === 'moved') return `${e.from || '—'} → ${e.to || '—'}`;
    if (e.event === 'offline') return e.note || '';
    return '';
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress size={28} /></Box>;
  }

  return (
    <Box sx={{ p: 2, maxWidth: '800px', mx: 'auto' }}>
      {/* Export the whole summary */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
        <ExportButton
          filename="house-weather-stats"
          label="Export stats"
          columns={STATS_COLUMNS}
          rows={buildExportRows}
          json={exportJson}
          disabled={allSensorNames.length === 0}
        />
      </Box>

      {/* Highlights */}
      {fun && (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <SectionTitle>Highlights</SectionTitle>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
              <FunFact icon={<LocalFireDepartment />} color="#ff3b30" label="Hottest day" value={fun.hot ? f1(fun.hot.temp) : '—'} sub={fun.hot ? fmtDate(fun.hot.unix) : ''} />
              <FunFact icon={<AcUnit />} color="#007aff" label="Coldest day" value={fun.cold ? f1(fun.cold.temp) : '—'} sub={fun.cold ? fmtDate(fun.cold.unix) : ''} />
              <FunFact icon={<SwapVert />} color="#5856d6" label="Biggest 24h swing" value={fun.swing ? `${fun.swing.range.toFixed(1)}°` : '—'} sub={fun.swing ? nameOf(fun.swing.name) : ''} />
              <FunFact icon={<Sensors />} color="#34c759" label="Devices seen" value={fun.devices} sub={`${fun.readings7d} readings / 7d`} />
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Room comparison — right now, vs outside */}
      {rooms.length > 0 && (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <SectionTitle>Rooms Right Now</SectionTitle>
            {outdoorNow != null && (
              <Typography sx={{ fontSize: '11px', color: '#8e8e93', textAlign: 'center', mb: 1 }}>
                Outside: <b>{f1(outdoorNow)}</b> · "vs out" is each room minus outside
              </Typography>
            )}
            {rooms.map((r, i) => (
              <Box key={r.name} sx={{ display: 'flex', alignItems: 'center', py: 0.75, borderTop: i > 0 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colorOf(r.name), mr: 1 }} />
                <Typography sx={{ flex: 1, fontSize: '14px', fontWeight: 600, color: '#1c1c1e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(r.name)}</Typography>
                <Typography sx={{ width: 70, textAlign: 'right', fontSize: '15px', fontWeight: 700, color: '#1c1c1e' }}>{f1(r.current)}</Typography>
                <Typography sx={{ width: 64, textAlign: 'right', fontSize: '12px', color: r.delta == null ? '#8e8e93' : r.delta >= 0 ? '#ff3b30' : '#007aff' }}>
                  {r.delta == null ? '' : `${signed(r.delta)}`}
                </Typography>
                <Typography sx={{ width: 74, textAlign: 'right', fontSize: '11px', color: '#8e8e93' }}>{r.avg7 != null ? `7d ${f1(r.avg7)}` : ''}</Typography>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Average temperature by hour of day */}
      {primary.length > 0 && hourOfDay.some(p => primary.some(n => p[n] != null)) && (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <SectionTitle>Average by Hour of Day (30d)</SectionTitle>
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hourOfDay} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                  <XAxis dataKey="hour" tickFormatter={hourLabel} interval={2} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} width={40} domain={['auto', 'auto']} label={{ value: '°F', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px', fontSize: '11px', color: 'white' }}
                    labelFormatter={(h) => `${hourLabel(h)}`}
                    formatter={(v, n) => [`${v.toFixed(1)}°F`, nameOf(n)]}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} formatter={(n) => nameOf(n)} />
                  {primary.map(name => (
                    <Line key={name} type="monotone" dataKey={name} stroke={colorOf(name)} strokeWidth={2} dot={false} connectNulls name={name} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Per-sensor stats over periods */}
      <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <SectionTitle>Min · Avg · Max by Period</SectionTitle>
          {perSensor.length === 0 ? (
            <Typography variant="body2" sx={{ textAlign: 'center', color: '#8e8e93', py: 2 }}>No sensor data yet.</Typography>
          ) : (
            perSensor.map(({ name, s24, s7, s30 }, i) => (
              <Box key={name}>
                {i > 0 && <Divider sx={{ my: 1 }} />}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colorOf(name) }} />
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: '#1c1c1e' }}>{nameOf(name)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', pb: 0.25 }}>
                  <Box sx={{ width: 42 }} />
                  <Box sx={{ flex: 1, display: 'flex', justifyContent: 'space-around' }}>
                    <Typography sx={{ fontSize: '9px', color: '#8e8e93' }}>LOW</Typography>
                    <Typography sx={{ fontSize: '9px', color: '#8e8e93' }}>AVG</Typography>
                    <Typography sx={{ fontSize: '9px', color: '#8e8e93' }}>HIGH</Typography>
                  </Box>
                </Box>
                <PeriodRow label="24H" stat={s24} />
                <PeriodRow label="7D" stat={s7} />
                <PeriodRow label="30D" stat={s30} />
              </Box>
            ))
          )}
        </CardContent>
      </Card>

      {/* All-time records */}
      <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <SectionTitle>All-Time Records</SectionTitle>
          {(() => {
            // Records are kept for every sensor ever rolled up, so a disabled
            // one still has an entry — filter it out rather than clearing it,
            // since re-enabling should bring its history back intact.
            const recs = bundle?.records?.sensors
              ? Object.entries(bundle.records.sensors).filter(([id]) => isSensorEnabled(id, sensorConfig))
              : [];
            const outdoor = bundle?.records?.outside?.temp_f;
            if (recs.length === 0 && !outdoor) {
              return <Typography variant="body2" sx={{ textAlign: 'center', color: '#8e8e93', py: 2 }}>No records yet — they build from the daily rollups.</Typography>;
            }
            const c2f = (c) => (c == null ? null : (c * 9 / 5) + 32);
            const Rec = ({ label, color, hi, lo }) => (
              <Box>
                <Typography sx={{ fontSize: '14px', fontWeight: 600, color, mb: 0.5 }}>{label}</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Box sx={{ flex: 1, textAlign: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, color: '#ff3b30' }}>
                      <ArrowUpward sx={{ fontSize: 14 }} />
                      <Typography sx={{ fontSize: '20px', fontWeight: 700, color: '#1c1c1e' }}>{hi?.value != null ? `${hi.value.toFixed(1)}°` : '—'}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '10px', color: '#8e8e93' }}>High · {fmtDate(hi?.unix_timestamp)}</Typography>
                  </Box>
                  <Box sx={{ flex: 1, textAlign: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, color: '#007aff' }}>
                      <ArrowDownward sx={{ fontSize: 14 }} />
                      <Typography sx={{ fontSize: '20px', fontWeight: 700, color: '#1c1c1e' }}>{lo?.value != null ? `${lo.value.toFixed(1)}°` : '—'}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '10px', color: '#8e8e93' }}>Low · {fmtDate(lo?.unix_timestamp)}</Typography>
                  </Box>
                </Box>
              </Box>
            );
            return (
              <>
                {recs.map(([id, rec], i) => (
                  <Box key={id}>
                    {i > 0 && <Divider sx={{ my: 1.5 }} />}
                    <Rec label={nameOf(id)} color={colorOf(id)}
                      hi={rec.max ? { value: c2f(rec.max.value), unix_timestamp: rec.max.unix_timestamp } : null}
                      lo={rec.min ? { value: c2f(rec.min.value), unix_timestamp: rec.min.unix_timestamp } : null} />
                  </Box>
                ))}
                {outdoor && (
                  <Box>
                    {recs.length > 0 && <Divider sx={{ my: 1.5 }} />}
                    <Rec label="Outdoor" color="grey" hi={outdoor.max} lo={outdoor.min} />
                  </Box>
                )}
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* Reliability — Pi gateway + per-sensor */}
      {reliability.sensors.length > 0 && (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <SectionTitle>Reliability (7d)</SectionTitle>
            {reliability.pi && (
              <RelRow
                label="Pi Gateway"
                color="#1c1c1e"
                uptime={reliability.pi.uptime}
                sub={`${reliability.pi.actualCycles} of ~${reliability.pi.expectedCycles} expected cycles · last ${fmtDateTime(reliability.pi.lastTs)}`}
                emphasize
              />
            )}
            <Divider sx={{ my: 1 }} />
            <Typography sx={{ fontSize: '10px', color: '#8e8e93', mb: 0.5 }}>Per sensor — share of cycles the Pi was up</Typography>
            {reliability.sensors.map((r, i) => (
              <RelRow key={r.name} label={nameOf(r.name)} color={colorOf(r.name)} uptime={r.uptime}
                sub={`${r.present} readings · last ${fmtDateTime(r.lastTs)}`} topBorder={i > 0} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Sensor event timeline */}
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 1.5 }}>
            <History sx={{ fontSize: 16, color: '#8e8e93' }} />
            <Typography variant="overline" sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px' }}>Sensor Timeline</Typography>
          </Box>
          {events.length === 0 ? (
            <Typography variant="body2" sx={{ textAlign: 'center', color: '#8e8e93', py: 2 }}>
              No events yet. Renaming, moving, enabling/disabling a sensor — or a sensor going offline — shows up here.
            </Typography>
          ) : (
            events.map((e, i) => {
              const meta = EVENT_META[e.event] || { label: e.event, color: '#8e8e93', icon: <History sx={{ fontSize: 16 }} /> };
              const detail = describe(e);
              return (
                <Box key={i} sx={{ display: 'flex', gap: 1.5, py: 1, borderTop: i > 0 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                  <Avatar sx={{ width: 30, height: 30, bgcolor: meta.color, borderRadius: 1 }}>{meta.icon}</Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '13px', color: '#1c1c1e' }}><b>{nameOf(e.sensorId)}</b> · {meta.label}</Typography>
                    {detail && <Typography sx={{ fontSize: '12px', color: '#8e8e93', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</Typography>}
                    <Typography sx={{ fontSize: '10px', color: '#8e8e93' }}>{fmtDateTime(e.unix_timestamp)}</Typography>
                  </Box>
                </Box>
              );
            })
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default Stats;
