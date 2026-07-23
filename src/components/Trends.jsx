import React, { useState, useMemo, useEffect } from 'react';
import { Box, Card, CardContent, Typography, ToggleButtonGroup, ToggleButton, Chip } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar } from 'recharts';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { getSensorConfig } from '../config/settingsUtils';

// Range options shown in the selector. The actual tier/query for each lives in
// api.js (RANGES) — changing one here just needs a matching key there.
const RANGE_OPTIONS = [
  ['24h', '24H'],
  ['7d', '7D'],
  ['30d', '30D'],
  ['6mo', '6M'],
  ['1y', '1Y'],
];

const RANGE_LABEL = {
  '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days',
  '6mo': 'last 6 months', '1y': 'last year',
};

const Trends = ({ latest, historical, range, onRangeChange }) => {
  // Sensor config from settings, filtered to alive sensors only.
  const SENSOR_CONFIG = getSensorConfig();
  const aliveSensors = Object.fromEntries(
    Object.entries(SENSOR_CONFIG).filter(([_, config]) => config.enabled !== false)
  );

  // Track which lines are visible (default: all visible).
  const [visibleLines, setVisibleLines] = useState(() => {
    const initial = {};
    Object.keys(aliveSensors).forEach(key => { initial[key] = true; });
    initial['outdoor_temp'] = true;
    return initial;
  });

  // Add any newly-discovered sensors to the visibility map.
  useEffect(() => {
    setVisibleLines(prev => {
      const updated = { ...prev };
      Object.keys(aliveSensors).forEach(key => {
        if (!(key in updated)) updated[key] = true;
      });
      if (Object.keys(updated).length !== Object.keys(prev).length) return updated;
      return prev;
    });
  }, [aliveSensors]);

  const toggleLine = (lineKey) => {
    setVisibleLines(prev => ({ ...prev, [lineKey]: !prev[lineKey] }));
  };

  const handleRangeChange = (event, newRange) => {
    if (newRange !== null) onRangeChange(newRange);
  };

  // App already fetches exactly the selected range from the right tier, so we
  // render it directly — no client-side time windowing needed.
  const rows = useMemo(() => historical || [], [historical]);

  // Derived per-row metrics (weather is already embedded on each row).
  const dataWithDifferentials = useMemo(() => rows.map(r => ({
    ...r,
    heater_differential: (r.Red != null && r.Blue != null) ? r.Red - r.Blue : null,
    avg_temp: [r.Blue, r.Red, r.Yellow, r.Green].every(v => v != null)
      ? (r.Blue + r.Red + r.Yellow + r.Green) / 4
      : null,
  })), [rows]);

  const hasOutdoorData = useMemo(
    () => rows.some(r => r.outdoor_temp !== null && r.outdoor_temp !== undefined),
    [rows]
  );

  // Y-axis domain for temperature charts (min/max ± 2°F).
  const temperatureDomain = useMemo(() => {
    if (!rows.length) return ['auto', 'auto'];
    const allTemps = [];
    rows.forEach(reading => {
      Object.keys(aliveSensors).forEach(sensorName => {
        const temp = reading[sensorName];
        if (typeof temp === 'number') allTemps.push(temp);
      });
      if (reading.outdoor_temp !== null && reading.outdoor_temp !== undefined) {
        allTemps.push(reading.outdoor_temp);
      }
    });
    if (!allTemps.length) return ['auto', 'auto'];
    return [Math.floor(Math.min(...allTemps) - 2), Math.ceil(Math.max(...allTemps) + 2)];
  }, [rows, aliveSensors]);

  return (
    <Box sx={{ p: 2 }}>
      {/* Range selector */}
      <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
        <ToggleButtonGroup
          value={range}
          exclusive
          onChange={handleRangeChange}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: '11px', px: 2, py: 0.5, textTransform: 'none',
              color: '#8e8e93', borderColor: 'rgba(0, 0, 0, 0.12)',
              '&.Mui-selected': {
                backgroundColor: '#34c759', color: 'white',
                '&:hover': { backgroundColor: '#2da045' },
              },
            },
          }}
        >
          {RANGE_OPTIONS.map(([value, label]) => (
            <ToggleButton key={value} value={value}>{label}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Typography variant="caption" sx={{ fontSize: '11px', color: '#8e8e93', textAlign: 'center' }}>
          {rows.length > 0
            ? `${rows.length} points · ${RANGE_LABEL[range] || range}`
            : `No data available for the ${RANGE_LABEL[range] || range}`}
        </Typography>
        {range !== '24h' && range !== '7d' && rows.length > 0 && (
          <Typography variant="caption" sx={{ fontSize: '10px', color: '#8e8e93', fontStyle: 'italic', textAlign: 'center' }}>
            Showing {range === '30d' ? 'hourly' : 'daily'} averages
          </Typography>
        )}
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
              '&:hover': { backgroundColor: visibleLines[sensorName] ? config.color : '#d0d0d0', opacity: 0.9 },
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
              '&:hover': { backgroundColor: visibleLines['outdoor_temp'] ? 'grey' : '#d0d0d0', opacity: 0.9 },
              '& .MuiChip-icon': { color: visibleLines['outdoor_temp'] ? 'white' : '#8e8e93' },
            }}
          />
        )}
      </Box>

      {/* All sensors chart */}
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', mb: 2 }}>
        <CardContent>
          <Box sx={{ mt: 1, height: 300 }}>
            {rows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
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
                      <Line
                        key={sensorName}
                        type="monotone"
                        dataKey={sensorName}
                        stroke={config.color}
                        strokeWidth={2}
                        name={config.displayName}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                    )
                  )}
                  {visibleLines['outdoor_temp'] && hasOutdoorData && (
                    <Line
                      type="monotone"
                      dataKey="outdoor_temp"
                      stroke="grey"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="Outdoor Temp"
                      dot={false}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8e8e93' }}>
                <Typography variant="body2">No data available for this range</Typography>
              </Box>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Heater differential (Output - Input) */}
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent>
          <Typography
            variant="overline"
            sx={{ fontSize: '13px', fontWeight: 600, color: '#8e8e93', letterSpacing: '0.5px', display: 'block', textAlign: 'center', mb: 1 }}
          >
            Temperature Differential (Output − Input)
          </Typography>
          <Box sx={{ mt: 1, height: 250 }}>
            {dataWithDifferentials.some(d => d.heater_differential != null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dataWithDifferentials} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    label={{ value: 'Δ Temperature (°F)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', border: 'none', borderRadius: '8px', fontSize: '11px', color: 'white' }}
                    formatter={(value) => (value != null && typeof value === 'number') ? [`${value.toFixed(1)}°F`] : ['N/A']}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="heater_differential" fill="#ff3b30" name="Heater Gain" radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8e8e93' }}>
                <Typography variant="body2">No differential data for this range</Typography>
              </Box>
            )}
          </Box>
        </CardContent>
      </Card>

      <Typography
        variant="caption"
        sx={{ textAlign: 'center', fontSize: '11px', color: '#8e8e93', display: 'block', py: 1.5 }}
      >
        Last updated: {latest?.timestamp ? new Date(latest.timestamp).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : 'Never'}
      </Typography>
    </Box>
  );
};

export default Trends;
