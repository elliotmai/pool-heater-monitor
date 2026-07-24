import React, { useState, useMemo, useEffect } from 'react';
import { Box, Card, CardContent, Typography, ToggleButtonGroup, ToggleButton, Chip, IconButton } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ArrowBack, ArrowForward, Visibility, VisibilityOff } from '@mui/icons-material';
import { getSensorConfig } from '../config/settingsUtils';

// Each selectable window maps to (a) which tier/range App should fetch and
// (b) an optional fixed sub-window (in hours) that we page through client-side.
// 1H-24H page through the 7-day raw tier; 7D/30D/6M/1Y show a whole tier.
const WINDOWS = {
  '1h': { label: '1H', fetch: '7d', hours: 1 },
  '6h': { label: '6H', fetch: '7d', hours: 6 },
  '12h': { label: '12H', fetch: '7d', hours: 12 },
  '24h': { label: '24H', fetch: '7d', hours: 24 },
  '7d': { label: '7D', fetch: '7d', hours: null },
  '30d': { label: '30D', fetch: '30d', hours: null },
  '6mo': { label: '6M', fetch: '6mo', hours: null },
  '1y': { label: '1Y', fetch: '1y', hours: null },
};

const RANGE_NOTE = {
  '7d': 'all readings, last 7 days',
  '30d': 'hourly averages',
  '6mo': 'daily averages',
  '1y': 'daily averages',
};

const Trends = ({ latest, historical, onRangeChange }) => {
  const [windowKey, setWindowKey] = useState('24h');
  const [offset, setOffset] = useState(0); // how many windows back from now

  const win = WINDOWS[windowKey];

  // Tell App which tier to fetch; only refetches when the tier actually changes.
  const fetchKey = win.fetch;
  useEffect(() => {
    onRangeChange(fetchKey);
  }, [fetchKey, onRangeChange]);

  const SENSOR_CONFIG = getSensorConfig();
  const aliveSensors = Object.fromEntries(
    Object.entries(SENSOR_CONFIG).filter(([_, config]) => config.enabled !== false)
  );

  const [visibleLines, setVisibleLines] = useState(() => {
    const initial = { outdoor_temp: true };
    Object.keys(aliveSensors).forEach(key => { initial[key] = true; });
    return initial;
  });
  useEffect(() => {
    setVisibleLines(prev => {
      const updated = { ...prev };
      Object.keys(aliveSensors).forEach(key => { if (!(key in updated)) updated[key] = true; });
      return Object.keys(updated).length !== Object.keys(prev).length ? updated : prev;
    });
  }, [aliveSensors]);

  const toggleLine = (lineKey) => setVisibleLines(prev => ({ ...prev, [lineKey]: !prev[lineKey] }));

  const handleWindowChange = (event, newKey) => {
    if (newKey !== null) {
      setWindowKey(newKey);
      setOffset(0); // reset paging when switching window
    }
  };

  const rows = useMemo(() => historical || [], [historical]);

  // The sub-window [start, end] currently in view (only for 1H-24H).
  const viewWindow = useMemo(() => {
    if (!win.hours) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const span = win.hours * 3600;
    const end = nowSec - offset * span;
    return { start: end - span, end };
  }, [win.hours, offset]);

  // Rows actually plotted.
  const shown = useMemo(() => {
    if (!viewWindow) return rows;
    return rows.filter(r => r.unix_timestamp > viewWindow.start && r.unix_timestamp <= viewWindow.end);
  }, [rows, viewWindow]);

  // Paging bounds: can we go further back (older raw exists) / forward (not at now)?
  const earliestTs = rows.length ? rows[0].unix_timestamp : null;
  const canBack = viewWindow && earliestTs != null && viewWindow.start > earliestTs;
  const canForward = viewWindow && offset > 0;

  const temperatureDomain = useMemo(() => {
    const temps = [];
    shown.forEach(r => {
      Object.keys(aliveSensors).forEach(name => {
        if (typeof r[name] === 'number') temps.push(r[name]);
      });
      if (typeof r.outdoor_temp === 'number') temps.push(r.outdoor_temp);
    });
    if (!temps.length) return ['auto', 'auto'];
    return [Math.floor(Math.min(...temps) - 2), Math.ceil(Math.max(...temps) + 2)];
  }, [shown, aliveSensors]);

  const hasOutdoorData = useMemo(
    () => shown.some(r => r.outdoor_temp !== null && r.outdoor_temp !== undefined),
    [shown]
  );

  const fmt = (unixSec) => new Date(unixSec * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const windowLabel = viewWindow ? `${fmt(viewWindow.start)} – ${fmt(viewWindow.end)}` : (RANGE_NOTE[windowKey] || '');

  return (
    <Box sx={{ p: 2 }}>
      {/* Window / range selector */}
      <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
        <ToggleButtonGroup
          value={windowKey}
          exclusive
          onChange={handleWindowChange}
          size="small"
          sx={{
            flexWrap: 'wrap', justifyContent: 'center',
            '& .MuiToggleButton-root': {
              fontSize: '11px', px: 1.5, py: 0.5, textTransform: 'none',
              color: '#8e8e93', borderColor: 'rgba(0, 0, 0, 0.12)',
              '&.Mui-selected': { backgroundColor: '#34c759', color: 'white', '&:hover': { backgroundColor: '#2da045' } },
            },
          }}
        >
          {Object.entries(WINDOWS).map(([key, cfg]) => (
            <ToggleButton key={key} value={key}>{cfg.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* Back/forward paging — only for the fixed sub-windows */}
        {win.hours ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <IconButton onClick={() => setOffset(o => o + 1)} disabled={!canBack} size="small" sx={{ color: '#007aff', '&.Mui-disabled': { color: '#c7c7cc' } }}>
              <ArrowBack fontSize="small" />
            </IconButton>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 220 }}>
              <Typography variant="caption" sx={{ fontSize: '11px', color: '#1c1c1e', fontWeight: 500, textAlign: 'center' }}>
                {windowLabel}
              </Typography>
              {offset > 0 && (
                <Typography variant="caption" onClick={() => setOffset(0)} sx={{ fontSize: '10px', color: '#007aff', cursor: 'pointer', textDecoration: 'underline' }}>
                  Jump to now
                </Typography>
              )}
            </Box>
            <IconButton onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={!canForward} size="small" sx={{ color: '#007aff', '&.Mui-disabled': { color: '#c7c7cc' } }}>
              <ArrowForward fontSize="small" />
            </IconButton>
          </Box>
        ) : (
          <Typography variant="caption" sx={{ fontSize: '11px', color: '#8e8e93' }}>{windowLabel}</Typography>
        )}

        <Typography variant="caption" sx={{ fontSize: '10px', color: shown.length ? '#8e8e93' : '#ff3b30' }}>
          {shown.length ? `${shown.length} reading${shown.length !== 1 ? 's' : ''}` : 'No data for this window'}
        </Typography>
      </Box>

      {/* Line visibility toggles */}
      <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
        {Object.entries(aliveSensors).map(([sensorName, config]) => (
          <Chip
            key={sensorName}
            label={config.displayName}
            onClick={() => toggleLine(sensorName)}
            icon={visibleLines[sensorName] ? <Visibility sx={{ fontSize: 16 }} /> : <VisibilityOff sx={{ fontSize: 16 }} />}
            sx={{
              backgroundColor: visibleLines[sensorName] ? config.color : '#e0e0e0',
              color: visibleLines[sensorName] ? 'white' : '#8e8e93',
              fontWeight: 600, fontSize: '11px', height: '28px',
              '& .MuiChip-icon': { color: visibleLines[sensorName] ? 'white' : '#8e8e93' },
            }}
          />
        ))}
        {hasOutdoorData && (
          <Chip
            label="Outdoor Temp"
            onClick={() => toggleLine('outdoor_temp')}
            icon={visibleLines['outdoor_temp'] ? <Visibility sx={{ fontSize: 16 }} /> : <VisibilityOff sx={{ fontSize: 16 }} />}
            sx={{
              backgroundColor: visibleLines['outdoor_temp'] ? 'grey' : '#e0e0e0',
              color: visibleLines['outdoor_temp'] ? 'white' : '#8e8e93',
              fontWeight: 600, fontSize: '11px', height: '28px',
              '& .MuiChip-icon': { color: visibleLines['outdoor_temp'] ? 'white' : '#8e8e93' },
            }}
          />
        )}
      </Box>

      {/* Temperature chart */}
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <Box sx={{ mt: 1, height: 320 }}>
            {shown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={shown} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis
                    domain={temperatureDomain}
                    tick={{ fontSize: 11 }}
                    label={{ value: 'Temperature (°F)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', border: 'none', borderRadius: '8px', fontSize: '11px', color: 'white' }}
                    formatter={(value) => (value != null && typeof value === 'number') ? [`${value.toFixed(1)}°F`] : ['N/A']}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  {Object.entries(aliveSensors).map(([sensorName, config]) =>
                    visibleLines[sensorName] && (
                      <Line key={sensorName} type="monotone" dataKey={sensorName} stroke={config.color} strokeWidth={2} name={config.displayName} dot={false} activeDot={{ r: 4 }} connectNulls />
                    )
                  )}
                  {visibleLines['outdoor_temp'] && hasOutdoorData && (
                    <Line type="monotone" dataKey="outdoor_temp" stroke="grey" strokeWidth={2} strokeDasharray="5 5" name="Outdoor Temp" dot={false} connectNulls />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8e8e93' }}>
                <Typography variant="body2">No data available for this window</Typography>
              </Box>
            )}
          </Box>
        </CardContent>
      </Card>

      <Typography variant="caption" sx={{ textAlign: 'center', fontSize: '11px', color: '#8e8e93', display: 'block', py: 1.5 }}>
        Last updated: {latest?.timestamp ? new Date(latest.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'}
      </Typography>
    </Box>
  );
};

export default Trends;
