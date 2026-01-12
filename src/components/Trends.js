import React, { useState, useMemo } from 'react';
import { Box, Card, CardContent, Typography, ToggleButtonGroup, ToggleButton, IconButton } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ComposedChart, Bar } from 'recharts';
import { ArrowBack, ArrowForward } from '@mui/icons-material';
import { getSensorConfig } from '../config/settingsUtils';

const Trends = ({ latest, historical, weatherHistory, onDateChange }) => {
  const [chartView, setChartView] = useState('all');
  const [timeFilter, setTimeFilter] = useState('24h');
  // Store the end time of the current view window
  const [viewEndTime, setViewEndTime] = useState(() => new Date());

  // Get sensor config from settings and filter to alive sensors only
  const SENSOR_CONFIG = getSensorConfig();
  const aliveSensors = Object.fromEntries(
    Object.entries(SENSOR_CONFIG).filter(([_, config]) => config.enabled !== false)
  );

  const handleViewChange = (event, newView) => {
    if (newView !== null) {
      setChartView(newView);
    }
  };

  const handleTimeFilterChange = (event, newFilter) => {
    if (newFilter !== null) {
      setTimeFilter(newFilter);
      // Reset to current time when changing filter
      setViewEndTime(new Date());
    }
  };

  // Calculate the hours to show based on the time filter
  const hoursToShow = useMemo(() => {
    switch (timeFilter) {
      case '1h': return 1;
      case '6h': return 6;
      case '12h': return 12;
      case '24h': return 24;
      default: return 24;
    }
  }, [timeFilter]);

  // Calculate the time range being displayed
  const displayTimeRange = useMemo(() => {
    const endTime = new Date(viewEndTime);
    const startTime = new Date(endTime.getTime() - (hoursToShow * 60 * 60 * 1000));
    
    return { startTime, endTime };
  }, [viewEndTime, hoursToShow]);

  // Filter data based on time range
  const filteredHistorical = useMemo(() => {
    if (!historical || historical.length === 0) return [];
    
    const { startTime, endTime } = displayTimeRange;
    const startTimestamp = startTime.getTime();
    const endTimestamp = endTime.getTime();

    // Filter readings within the time window
    return historical.filter(reading => {
      if (!reading.unix_timestamp) return false;
      const readingTime = reading.unix_timestamp * 1000;
      return readingTime >= startTimestamp && readingTime <= endTimestamp;
    });
  }, [historical, displayTimeRange]);

  // Navigate backward by the hoursToShow amount
  const goBackward = () => {
    const newEndTime = new Date(viewEndTime.getTime() - (hoursToShow * 60 * 60 * 1000));
    setViewEndTime(newEndTime);
  };

  // Navigate forward by the hoursToShow amount
  const goForward = () => {
    const newEndTime = new Date(viewEndTime.getTime() + (hoursToShow * 60 * 60 * 1000));
    // Don't go beyond current time
    const now = new Date();
    if (newEndTime > now) {
      setViewEndTime(now);
    } else {
      setViewEndTime(newEndTime);
    }
  };

  // Navigate to current time
  const goToNow = () => {
    setViewEndTime(new Date());
  };

  // Check if we can go forward (not already at current time)
  const canGoForward = useMemo(() => {
    const now = new Date();
    // Allow forward if we're more than 1 minute behind current time
    return viewEndTime.getTime() < (now.getTime() - 60000);
  }, [viewEndTime]);

  const isAtCurrentTime = useMemo(() => {
    const now = new Date();
    // Consider "at current time" if within 1 minute
    return Math.abs(now.getTime() - viewEndTime.getTime()) < 60000;
  }, [viewEndTime]);

  // Calculate temperature differentials and merge with weather history
  const dataWithDifferentials = useMemo(() => {
    // Create a map of weather data by timestamp for quick lookup
    const weatherMap = {};
    if (weatherHistory && weatherHistory.length > 0) {
      weatherHistory.forEach(weather => {
        if (weather.unix_timestamp) {
          weatherMap[weather.unix_timestamp] = weather;
        }
      });
    }
    
    const result = filteredHistorical.map(reading => {
      // Find matching weather data (within 5 minutes = 300 seconds)
      let matchingWeather = weatherMap[reading.unix_timestamp];
      if (!matchingWeather && reading.unix_timestamp) {
        // Try to find weather within 5 minutes
        const timestamps = Object.keys(weatherMap).map(Number);
        const closest = timestamps.find(t => 
          Math.abs(t - reading.unix_timestamp) <= 300
        );
        if (closest) {
          matchingWeather = weatherMap[closest];
        }
      }
      
      return {
        ...reading,
        heater_differential: reading.Red && reading.Blue ? reading.Red - reading.Blue : null,
        avg_temp: reading.Blue && reading.Red && reading.Yellow && reading.Green 
          ? (reading.Blue + reading.Red + reading.Yellow + reading.Green) / 4 
          : null,
        outdoor_temp: matchingWeather?.temp_f || reading.outdoor_temp || null,
        outdoor_humidity: matchingWeather?.humidity || reading.outdoor_humidity || null,
        weather_description: matchingWeather?.description || reading.weather_description || null
      };
    });
    
    return result;
  }, [filteredHistorical, weatherHistory]);

  // Check if we have outdoor temperature data
  const hasOutdoorData = useMemo(() => {
    const hasData = dataWithDifferentials.some(reading => 
      reading.outdoor_temp !== null && reading.outdoor_temp !== undefined
    );
    return hasData;
  }, [dataWithDifferentials]);

  // Calculate Y-axis domain for temperature charts (min/max ± 20°F)
  const temperatureDomain = useMemo(() => {
    if (!filteredHistorical || filteredHistorical.length === 0) {
      return ['auto', 'auto'];
    }

    const allTemps = [];
    
    // Collect all temperature values from alive sensors only
    filteredHistorical.forEach(reading => {
      Object.keys(aliveSensors).forEach(sensorName => {
        const temp = reading[sensorName];
        if (temp !== null && temp !== undefined && typeof temp === 'number') {
          allTemps.push(temp);
        }
      });
      
      // Include outdoor temp if available
      if (reading.outdoor_temp !== null && reading.outdoor_temp !== undefined) {
        allTemps.push(reading.outdoor_temp);
      }
    });

    if (allTemps.length === 0) {
      return ['auto', 'auto'];
    }

    const minTemp = Math.min(...allTemps);
    const maxTemp = Math.max(...allTemps);

    // Add ±5°F padding
    return [Math.floor(minTemp - 2), Math.ceil(maxTemp + 2)];
  }, [filteredHistorical, aliveSensors]);


  // Format time range for display
  const formatTimeRange = () => {
    const { startTime, endTime } = displayTimeRange;
    
    const formatTime = (date) => date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true
    });
    
    const formatDate = (date) => date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
    
    // If times span different days
    if (startTime.toDateString() !== endTime.toDateString()) {
      return `${formatDate(startTime)} ${formatTime(startTime)} - ${formatDate(endTime)} ${formatTime(endTime)}`;
    } else {
      return `${formatDate(startTime)}, ${formatTime(startTime)} - ${formatTime(endTime)}`;
    }
  };

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
          {/* <ToggleButton value="heater">Heater Performance</ToggleButton>
          <ToggleButton value="comparison">Indoor vs Outdoor</ToggleButton> */}
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
        </ToggleButtonGroup>

        {/* Time Navigation */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton 
            onClick={goBackward}
            size="small"
            sx={{ 
              color: '#007aff',
            }}
          >
            <ArrowBack fontSize="small" />
          </IconButton>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <Typography 
              variant="caption" 
              sx={{ 
                fontSize: '11px',
                color: '#1c1c1e',
                fontWeight: 500,
                minWidth: '200px',
                textAlign: 'center'
              }}
            >
              {formatTimeRange()}
            </Typography>
            {!isAtCurrentTime && (
              <Typography
                variant="caption"
                onClick={goToNow}
                sx={{
                  fontSize: '10px',
                  color: '#007aff',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  '&:hover': {
                    color: '#0051d5'
                  }
                }}
              >
                Jump to now
              </Typography>
            )}
          </Box>
          <IconButton 
            onClick={goForward}
            disabled={!canGoForward}
            size="small"
            sx={{ 
              color: '#007aff',
              '&.Mui-disabled': {
                color: '#c7c7cc'
              }
            }}
          >
            <ArrowForward fontSize="small" />
          </IconButton>
        </Box>

        {/* Data availability info */}
        {filteredHistorical.length === 0 && (
          <Typography 
            variant="caption" 
            sx={{ 
              fontSize: '10px',
              color: '#ff3b30',
              textAlign: 'center',
            }}
          >
            No data available for this time period
          </Typography>
        )}
        {filteredHistorical.length > 0 && (
          <Typography 
            variant="caption" 
            sx={{ 
              fontSize: '10px',
              color: '#8e8e93',
              textAlign: 'center',
            }}
          >
            {filteredHistorical.length} readings
          </Typography>
        )}
      </Box>

      {/* All Sensors Chart */}
      {chartView === 'all' && (
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
              All Temperature Sensors
            </Typography>
            
            <Box sx={{ mt: 2, height: 300 }}>
              {filteredHistorical && filteredHistorical.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={filteredHistorical}
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
                      domain={temperatureDomain}
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
                        fontSize: '11px',
                        color: 'white'
                      }}
                      formatter={(value) => (value != null && typeof value === 'number') ? [`${value.toFixed(1)}°F`] : ['N/A']}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    {Object.entries(aliveSensors).map(([sensorName, config]) => (
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
                    <Line
                        type="monotone"
                        dataKey="outdoor_temp"
                        stroke="grey"
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
                  <Typography variant="body2">No data available for this time period</Typography>
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
                Heater Input/Output
              </Typography>
              
              <Box sx={{ mt: 2, height: 300 }}>
                {filteredHistorical && filteredHistorical.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart 
                      data={filteredHistorical}
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
                          fontSize: '11px',
                          color: 'white'
                        }}
                        formatter={(value) => (value != null && typeof value === 'number') ? [`${value.toFixed(1)}°F`] : ['N/A']}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Line
                        type="monotone"
                        dataKey="Blue"
                        stroke={aliveSensors.Blue?.color || SENSOR_CONFIG.Blue?.color || '#007aff'}
                        strokeWidth={2}
                        name={aliveSensors.Blue?.displayName || SENSOR_CONFIG.Blue?.displayName || 'Blue'}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Red"
                        stroke={aliveSensors.Red?.color || SENSOR_CONFIG.Red?.color || '#ff3b30'}
                        strokeWidth={2}
                        name={aliveSensors.Red?.displayName || SENSOR_CONFIG.Red?.displayName || 'Red'}
                        dot={false}
                        activeDot={{ r: 5 }}
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
                    <Typography variant="body2">No data available for this time period</Typography>
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
                Temperature Differential (Output - Input)
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
                          value: 'Δ Temperature (°F)', 
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
                          fontSize: '11px',
                          color: 'white'
                        }}
                        formatter={(value) => (value != null && typeof value === 'number') ? [`${value.toFixed(1)}°F`] : ['N/A']}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar
                        dataKey="heater_differential"
                        fill="#ff3b30"
                        name="Heater Gain"
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
                    <Typography variant="body2">No data available for this time period</Typography>
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
                {dataWithDifferentials && dataWithDifferentials.length > 0 && hasOutdoorData ? (
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
                          fontSize: '11px',
                          color: 'white'
                        }}
                        formatter={(value, name) => {
                          return (value != null && typeof value === 'number') ? [`${value.toFixed(1)}°F`, name] : ['N/A', name];
                        }}
                        labelFormatter={(label) => {
                          // Find the data point for this label to get weather description
                          const dataPoint = dataWithDifferentials.find(d => d.time === label);
                          if (dataPoint?.weather_description) {
                            return `${label} - ${dataPoint.weather_description}`;
                          }
                          return label;
                        }}
                        labelStyle={{ color: 'white', marginBottom: '4px' }}
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
                        stroke="grey"
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
                    <Typography variant="body2">
                      {!hasOutdoorData ? 'Weather data unavailable' : 'No data available for this time period'}
                    </Typography>
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
                        tickFormatter={(value) => {
                          return (value != null && typeof value === 'number') ? `${(value * 100).toFixed(1)}%` : 'N/A';
                        }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '11px',
                          color: 'white'
                        }}
                        formatter={(value, name) => {
                          return (value != null && typeof value === 'number') ? [`${(value * 100).toFixed(1)}%`, name] : ['N/A', name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      {Object.entries(aliveSensors).map(([sensorName, config]) => (
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
                    <Typography variant="body2">No data available for this time period</Typography>
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