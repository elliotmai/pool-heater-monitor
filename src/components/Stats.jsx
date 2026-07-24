import React, { useState, useEffect, useMemo } from 'react';
import { Box, Card, CardContent, Typography, Divider, CircularProgress, Avatar } from '@mui/material';
import {
  ArrowUpward, ArrowDownward, DriveFileRenameOutline, PlaceOutlined, WifiOff, Wifi,
  ToggleOn, ToggleOff, AddCircleOutline, History, LocalFireDepartment, AcUnit, SwapVert, Sensors,
} from '@mui/icons-material';
import { fetchStatsBundle } from '../services/api';

const fmtDate = (u) => u ? new Date(u * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDateTime = (u) => u ? new Date(u * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const f1 = (n) => (n == null ? '—' : `${n.toFixed(1)}°`);

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

const Stats = ({ sensorConfig }) => {
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

  // Every sensor seen in the last 30 days (keeps random RTL pickups visible).
  const sensorNames = useMemo(() => {
    if (!bundle) return [];
    const keys = new Set([...sensorKeysIn(bundle.raw7d), ...sensorKeysIn(bundle.hourly30d)]);
    return [...keys].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  const nowSec = Math.floor(Date.now() / 1000);

  const perSensor = useMemo(() => {
    if (!bundle) return [];
    const raw24 = bundle.raw7d.filter(r => r.unix_timestamp >= nowSec - 86400);
    return sensorNames.map(name => ({
      name,
      s24: periodStats(raw24, name),
      s7: periodStats(bundle.raw7d, name),
      s30: periodStats(bundle.hourly30d, name),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, sensorNames]);

  const fun = useMemo(() => {
    if (!bundle) return null;
    // Biggest 24h swing across sensors.
    const raw24 = bundle.raw7d.filter(r => r.unix_timestamp >= nowSec - 86400);
    let swing = null;
    sensorNames.forEach(name => {
      const s = periodStats(raw24, name);
      if (s && (!swing || (s.max - s.min) > swing.range)) swing = { name, range: s.max - s.min };
    });
    // Hottest / coldest day across all sensors (from daily buckets).
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

  const events = bundle?.events || [];
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
      {/* Fun highlights */}
      {fun && (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <Typography variant="overline" sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px', display: 'block', textAlign: 'center', mb: 1.5 }}>
              Highlights
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
              <FunFact icon={<LocalFireDepartment />} color="#ff3b30" label="Hottest day" value={fun.hot ? f1(fun.hot.temp) : '—'} sub={fun.hot ? fmtDate(fun.hot.unix) : ''} />
              <FunFact icon={<AcUnit />} color="#007aff" label="Coldest day" value={fun.cold ? f1(fun.cold.temp) : '—'} sub={fun.cold ? fmtDate(fun.cold.unix) : ''} />
              <FunFact icon={<SwapVert />} color="#5856d6" label="Biggest 24h swing" value={fun.swing ? `${fun.swing.range.toFixed(1)}°` : '—'} sub={fun.swing ? nameOf(fun.swing.name) : ''} />
              <FunFact icon={<Sensors />} color="#34c759" label="Devices seen" value={fun.devices} sub={`${fun.readings7d} readings / 7d`} />
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Per-sensor stats over periods */}
      <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <Typography variant="overline" sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px', display: 'block', textAlign: 'center', mb: 1 }}>
            Min · Avg · Max by Period
          </Typography>
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
                {/* header */}
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
          <Typography variant="overline" sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px', display: 'block', textAlign: 'center', mb: 1.5 }}>
            All-Time Records
          </Typography>
          {(() => {
            const recs = bundle?.records?.sensors ? Object.entries(bundle.records.sensors) : [];
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
