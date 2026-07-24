import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, Divider, CircularProgress, Avatar } from '@mui/material';
import { ArrowUpward, ArrowDownward, DriveFileRenameOutline, PlaceOutlined, WifiOff, Wifi, ToggleOn, ToggleOff, AddCircleOutline, History } from '@mui/icons-material';
import { fetchRecords, fetchSensorEvents } from '../services/api';

const c2f = (c) => (c == null ? null : (c * 9 / 5) + 32);
const fmtDate = (unix) => unix ? new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDateTime = (unix) => unix ? new Date(unix * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

const EVENT_META = {
  renamed: { label: 'Renamed', color: '#007aff', icon: <DriveFileRenameOutline sx={{ fontSize: 16 }} /> },
  moved: { label: 'Moved', color: '#5856d6', icon: <PlaceOutlined sx={{ fontSize: 16 }} /> },
  enabled: { label: 'Enabled', color: '#34c759', icon: <ToggleOn sx={{ fontSize: 16 }} /> },
  disabled: { label: 'Disabled', color: '#8e8e93', icon: <ToggleOff sx={{ fontSize: 16 }} /> },
  offline: { label: 'Went offline', color: '#ff3b30', icon: <WifiOff sx={{ fontSize: 16 }} /> },
  online: { label: 'Back online', color: '#34c759', icon: <Wifi sx={{ fontSize: 16 }} /> },
  added: { label: 'Added', color: '#34c759', icon: <AddCircleOutline sx={{ fontSize: 16 }} /> },
};

const RecordStat = ({ kind, value, unix }) => {
  const high = kind === 'high';
  if (value == null) return null;
  return (
    <Box sx={{ flex: 1, textAlign: 'center' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, color: high ? '#ff3b30' : '#007aff' }}>
        {high ? <ArrowUpward sx={{ fontSize: 14 }} /> : <ArrowDownward sx={{ fontSize: 14 }} />}
        <Typography sx={{ fontSize: '22px', fontWeight: 700, color: '#1c1c1e' }}>
          {value.toFixed(1)}<Typography component="span" sx={{ fontSize: '13px', color: '#8e8e93', ml: 0.25 }}>°F</Typography>
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '10px', color: '#8e8e93' }}>{high ? 'High' : 'Low'} · {fmtDate(unix)}</Typography>
    </Box>
  );
};

const Stats = ({ sensorConfig }) => {
  const [records, setRecords] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [r, e] = await Promise.all([fetchRecords(), fetchSensorEvents()]);
      if (!active) return;
      setRecords(r);
      setEvents(e);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const nameOf = (id) => sensorConfig?.[id]?.displayName || id;
  const colorOf = (id) => sensorConfig?.[id]?.color || '#007aff';

  const sensorRecords = records?.sensors ? Object.entries(records.sensors) : [];
  const outdoor = records?.outside?.temp_f;

  const describe = (e) => {
    if (e.event === 'renamed' || e.event === 'moved') return `${e.from || '—'} → ${e.to || '—'}`;
    if (e.event === 'offline') return e.note || '';
    return '';
  };

  return (
    <Box sx={{ p: 2, maxWidth: '800px', mx: 'auto' }}>
      {/* All-time records */}
      <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <Typography variant="overline" sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px', display: 'block', textAlign: 'center', mb: 1.5 }}>
            All-Time Records
          </Typography>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : sensorRecords.length === 0 && !outdoor ? (
            <Typography variant="body2" sx={{ textAlign: 'center', color: '#8e8e93', py: 2 }}>
              No records yet — they build from the daily rollups.
            </Typography>
          ) : (
            <>
              {sensorRecords.map(([id, rec], i) => (
                <Box key={id}>
                  {i > 0 && <Divider sx={{ my: 1.5 }} />}
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: colorOf(id), mb: 1 }}>{nameOf(id)}</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <RecordStat kind="high" value={c2f(rec.max?.value)} unix={rec.max?.unix_timestamp} />
                    <RecordStat kind="low" value={c2f(rec.min?.value)} unix={rec.min?.unix_timestamp} />
                  </Box>
                </Box>
              ))}
              {outdoor && (
                <Box>
                  {sensorRecords.length > 0 && <Divider sx={{ my: 1.5 }} />}
                  <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'grey', mb: 1 }}>Outdoor</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <RecordStat kind="high" value={outdoor.max?.value} unix={outdoor.max?.unix_timestamp} />
                    <RecordStat kind="low" value={outdoor.min?.value} unix={outdoor.min?.unix_timestamp} />
                  </Box>
                </Box>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Sensor event timeline */}
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 1.5 }}>
            <History sx={{ fontSize: 16, color: '#8e8e93' }} />
            <Typography variant="overline" sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px' }}>
              Sensor Timeline
            </Typography>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : events.length === 0 ? (
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
                    <Typography sx={{ fontSize: '13px', color: '#1c1c1e' }}>
                      <b>{nameOf(e.sensorId)}</b> · {meta.label}
                    </Typography>
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
