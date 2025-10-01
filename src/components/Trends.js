import React, { useState, useMemo } from 'react';
import { Box, Card, CardContent, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ComposedChart, Bar } from 'recharts';
import { SENSOR_CONFIG } from '../config/config';

const Trends = ({ latest, historical, weather }) => {
  const [chartView, setChartView] = useState('all');
  const [timeFilter, setTimeFilter] = useState('24h');

  const handleViewChange = (event, newView) => {
    if (newView !== null) {
      setChartView(newView);
    }
  };

  const handleTimeFilterChange = (event, newFilter) => {
    if (newFilter !== null) {
      setTimeFilter(newFilter);
    }
  };

  // Filter data based on time selection
  const filteredHistorical = useMemo(() => {
    if (!historical || historical.length === 0) return [];
    
    const now = new Date();
    let hoursToShow;
    
    switch (timeFilter) {
      case '1h':
        hoursToShow = 1;
        break;
      case '6h':
        hoursToShow = 6;
        break;
      case '12h':
        hoursToShow = 12;
        break;
      case '24h':
        hoursToShow = 24;
        break;
      case 'all':
        return historical;
      default:
        hoursToShow = 24;
    }
    
    const cutoffTime = now.getTime() - (hoursToShow * 60 * 60 * 1000);
    
    return historical.filter(reading => {
      if (!reading.unix_timestamp) return true;
      return reading.unix_timestamp * 1000 >= cutoffTime;
    });
  }, [historical, timeFilter]);

  // Calculate temperature differentials
  const dataWithDifferentials = filteredHistorical?.map(reading => ({
    ...reading,
    heater_differential: reading.Red && reading.Blue ? reading.Red - reading.Blue : null,
    avg_temp: reading.Blue && reading.Red && reading.Yellow && reading.Green 
      ? (reading.Blue + reading.Red + reading.Yellow + reading.Green) / 4 
      : null,
    outdoor_temp: weather?.current.temp_f || null
  })) || [];

  return (
    <Box sx={{ p: 2 }}>
      {/* Controls */}
      <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
        {/* View Toggle */}
        <ToggleButtonGroup
          value={chartView}
          exclusive
          onChange={handleViewChange}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: '11px',
              px: 2,
              py: 0.5,
              textTransform: 'none',
              color: '#8e8e93',
              borderColor: 'rgba(0, 0, 0, 0.12)',
              '&.Mui-selected': {
                backgroundColor: '#007aff',
                color: 'white',
                '&:hover': {
                  backgroundColor: '#0051d5'
                }
              }
            }
          }}
        >
          <ToggleButton value="all">All Sensors</ToggleButton>
          <ToggleButton value="heater">Heater Performance</ToggleButton>
          <ToggleButton value="comparison">Indoor vs Outdoor</ToggleButton>
        </ToggleButtonGroup>

        {/* Time Filter */}
        <ToggleButtonGroup
          value={timeFilter}
          exclusive
          onChange={handleTimeFilterChange}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: '10px',
              px: 1.5,
              py: 0.5,
              textTransform: 'none',
              color: '#8e8e93',
              borderColor: 'rgba(0, 0, 0, 0.12)',
              '&.Mui-selected': {
                backgroundColor: '#34c759',
                color: 'white',
                '&:hover': {
                  backgroundColor: '#2da045'
                }
              }
            }
          }}
        >
          <ToggleButton value="1h">1 Hour</ToggleButton>
          <ToggleButton value="6h">6 Hours</ToggleButton>
          <ToggleButton value="12h">12 Hours</ToggleButton>
          <ToggleButton value="24h">24 Hours</ToggleButton>
          <ToggleButton value="all">All Data</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* All Sensors Chart */}
      {chartView === 'all' && (
        <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', mb: 2 }}>
          <CardContent>
            <Typography 
              variant="overline" 
              sx={{ 
                fontSize: '13px',
                fontWeight: 600,
                color: '#8e8e93',
                letterSpacing: '0.5px',
                display: 'block',
                textAlign: 'center',
                mb: 1
              }}
            >
              All Temperature Sensors + Outdoor
            </Typography>
            
            <Box sx={{ mt: 2, height: 350 }}>
              {dataWithDifferentials && dataWithDifferentials.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={dataWithDifferentials}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 10 }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      tick={{ fontSize: 11 }}
                      label={{ 
                        value: 'Temperature (°F)', 
                        angle: -90, 
                        position: 'insideLeft',
                        style: { fontSize: 11 }
                      }}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '11px'
                      }}
                      formatter={(value) => [`${value?.toFixed(1)}°F`]}
                    />
                    <Legend 
                      wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                    />
                    
                    {Object.entries(SENSOR_CONFIG).map(([sensorName, config]) => (
                      <Line
                        key={sensorName}
                        type="monotone"
                        dataKey={sensorName}
                        stroke={config.color}
                        strokeWidth={2}
                        name={config.displayName}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                    
                    {weather && (
                      <Line
                        type="monotone"
                        dataKey={"outdoor_temp"}
                        stroke="black"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        name="Outdoor Temp"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Box 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    height: '100%',
                    color: '#8e8e93'
                  }}
                >
                  <Typography variant="body2">No historical data available</Typography>
                </Box>
              )}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Heater Performance Chart */}
      {chartView === 'heater' && (
        <>
          <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', mb: 2 }}>
            <CardContent>
              <Typography 
                variant="overline" 
                sx={{ 
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#8e8e93',
                  letterSpacing: '0.5px',
                  display: 'block',
                  textAlign: 'center',
                  mb: 1
                }}
              >
                Heater Input vs Output
              </Typography>
              
              <Box sx={{ mt: 2, height: 300 }}>
                {filteredHistorical && filteredHistorical.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart 
                      data={filteredHistorical}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient id="colorBlue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={SENSOR_CONFIG.Blue.color} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={SENSOR_CONFIG.Blue.color} stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorRed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={SENSOR_CONFIG.Red.color} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={SENSOR_CONFIG.Red.color} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        label={{ 
                          value: 'Temperature (°F)', 
                          angle: -90, 
                          position: 'insideLeft',
                          style: { fontSize: 11 }
                        }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '11px'
                        }}
                        formatter={(value) => [`${value?.toFixed(1)}°F`]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Area
                        type="monotone"
                        dataKey="Blue"
                        stroke={SENSOR_CONFIG.Blue.color}
                        fillOpacity={1}
                        fill="url(#colorBlue)"
                        name={SENSOR_CONFIG.Blue.displayName}
                      />
                      <Area
                        type="monotone"
                        dataKey="Red"
                        stroke={SENSOR_CONFIG.Red.color}
                        fillOpacity={1}
                        fill="url(#colorRed)"
                        name={SENSOR_CONFIG.Red.displayName}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      height: '100%',
                      color: '#8e8e93'
                    }}
                  >
                    <Typography variant="body2">No historical data available</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>

          <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
            <CardContent>
              <Typography 
                variant="overline" 
                sx={{ 
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#8e8e93',
                  letterSpacing: '0.5px',
                  display: 'block',
                  textAlign: 'center',
                  mb: 1
                }}
              >
                Temperature Gain Through Heater
              </Typography>
              
              <Box sx={{ mt: 2, height: 250 }}>
                {dataWithDifferentials && dataWithDifferentials.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart 
                      data={dataWithDifferentials}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        label={{ 
                          value: 'Temperature Gain (°F)', 
                          angle: -90, 
                          position: 'insideLeft',
                          style: { fontSize: 11 }
                        }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '11px'
                        }}
                        formatter={(value) => [`${value?.toFixed(1)}°F`]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar
                        dataKey="heater_differential"
                        fill="#ff9500"
                        name="Heater Temperature Gain"
                        radius={[4, 4, 0, 0]}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      height: '100%',
                      color: '#8e8e93'
                    }}
                  >
                    <Typography variant="body2">No data available</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </>
      )}

      {/* Indoor vs Outdoor Comparison */}
      {chartView === 'comparison' && (
        <>
          <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', mb: 2 }}>
            <CardContent>
              <Typography 
                variant="overline" 
                sx={{ 
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#8e8e93',
                  letterSpacing: '0.5px',
                  display: 'block',
                  textAlign: 'center',
                  mb: 1
                }}
              >
                Pool Temperature vs Outdoor Temperature
              </Typography>
              
              <Box sx={{ mt: 2, height: 300 }}>
                {dataWithDifferentials && dataWithDifferentials.length > 0 && weather ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart 
                      data={dataWithDifferentials}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        label={{ 
                          value: 'Temperature (°F)', 
                          angle: -90, 
                          position: 'insideLeft',
                          style: { fontSize: 11 }
                        }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '11px'
                        }}
                        formatter={(value) => [`${value?.toFixed(1)}°F`]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Line
                        type="monotone"
                        dataKey="avg_temp"
                        stroke="#5856d6"
                        strokeWidth={3}
                        name="Average Pool Temp"
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="outdoor_temp"
                        stroke="#34c759"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        name="Outdoor Temp"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      height: '100%',
                      color: '#8e8e93'
                    }}
                  >
                    <Typography variant="body2">Weather data unavailable</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>

          <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
            <CardContent>
              <Typography 
                variant="overline" 
                sx={{ 
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#8e8e93',
                  letterSpacing: '0.5px',
                  display: 'block',
                  textAlign: 'center',
                  mb: 1
                }}
              >
                System Temperature Distribution
              </Typography>
              
              <Box sx={{ mt: 2, height: 250 }}>
                {filteredHistorical && filteredHistorical.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart 
                      data={filteredHistorical}
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                      stackOffset="expand"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '11px'
                        }}
                        formatter={(value, name) => [`${(value * 100).toFixed(1)}%`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      {Object.entries(SENSOR_CONFIG).map(([sensorName, config]) => (
                        <Area
                          key={sensorName}
                          type="monotone"
                          dataKey={sensorName}
                          stackId="1"
                          stroke={config.color}
                          fill={config.color}
                          name={config.displayName}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      height: '100%',
                      color: '#8e8e93'
                    }}
                  >
                    <Typography variant="body2">No data available</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </>
      )}

      <Typography 
              variant="caption" 
              sx={{ 
                textAlign: 'center',
                fontSize: '11px',
                color: '#8e8e93',
                display: 'block',
                py: 1.5
              }}
            >
              Last updated: {latest?.timestamp ? new Date(latest.timestamp).toLocaleString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
              }) : 'Never'}
            </Typography>

    </Box>
    
  );
};

export default Trends;