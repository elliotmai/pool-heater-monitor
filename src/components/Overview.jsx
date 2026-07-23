import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Grid, Typography, Chip, IconButton } from '@mui/material';
import { DragIndicator } from '@mui/icons-material';
import { getSensorConfig } from '../config/settingsUtils';

const STORAGE_KEY = 'sensorCardOrder';

const SensorCard = ({ name, value, config, onDragStart, onDragEnd, onDragOver, onDrop, isDragging, onTouchStart, onTouchMove, onTouchEnd }) => (
  <Card
    draggable
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    onDragOver={onDragOver}
    onDrop={onDrop}
    onTouchStart={onTouchStart}
    onTouchMove={onTouchMove}
    onTouchEnd={onTouchEnd}
    sx={{
      background: 'linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%)',
      border: '1px solid rgba(0, 0, 0, 0.05)',
      boxShadow: 'none',
      cursor: 'grab',
      opacity: isDragging ? 0.5 : 1,
      transition: 'opacity 0.2s ease, transform 0.2s ease',
      position: 'relative',
      width: '150px',
      height: '100px',
      display: 'flex',
      flexDirection: 'column',
      touchAction: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      '&:active': {
        cursor: 'grabbing'
      },
      '&:hover': {
        transform: 'translateY(-2px)',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
        '& .drag-handle': {
          opacity: 1
        }
      }
    }}
  >
    <IconButton
      className="drag-handle"
      sx={{
        position: 'absolute',
        top: 4,
        right: 4,
        opacity: 0,
        transition: 'opacity 0.2s ease',
        padding: 0.5,
        pointerEvents: 'none'
      }}
      size="small"
    >
      <DragIndicator sx={{ fontSize: 16, color: '#8e8e93' }} />
    </IconButton>
    <CardContent sx={{
      textAlign: 'center',
      py: 2,
      px: 2,
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      width: '100%',
      boxSizing: 'border-box',
      '&:last-child': { pb: 2 }
    }}>
      <Typography
        variant="caption"
        sx={{
          color: '#8e8e93',
          fontSize: '13px',
          fontWeight: 600,
          display: 'block',
          mb: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {config.displayName}
      </Typography>
      <Typography
        variant="h3"
        sx={{
          fontSize: '32px',
          fontWeight: 700,
          color: '#1c1c1e',
          letterSpacing: '-1px'
        }}
      >
        {value?.toFixed(1) || '--'}
        <Typography
          component="span"
          sx={{
            fontSize: '18px',
            fontWeight: 500,
            color: '#8e8e93',
            ml: 0.5
          }}
        >
          °F
        </Typography>
      </Typography>
    </CardContent>
  </Card>
);

const WeatherCard = ({ label, value, subtitle, badge, icon }) => (
  <Card
    sx={{
      background: 'linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%)',
      border: '1px solid rgba(0, 0, 0, 0.05)',
      boxShadow: 'none',
      height: '100%',
      width: '100px',
    }}
  >
    <CardContent sx={{ textAlign: 'center', py: 1.5, px: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography
        variant="caption"
        sx={{
          color: '#8e8e93',
          fontSize: '11px',
          display: 'block',
          mb: 0.5
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="h5"
        sx={{
          fontSize: '20px',
          fontWeight: 600,
          color: '#1c1c1e'
        }}
      >
        {value}
      </Typography>
      {subtitle && (
        <Typography
          variant="caption"
          sx={{
            fontSize: '10px',
            color: '#8e8e93',
            display: 'block',
            mt: 0.5
          }}
        >
          {subtitle}
        </Typography>
      )}
      {badge && (
        <Chip
          label={badge.label}
          color={badge.color}
          size="small"
          sx={{ mt: 0.5, height: '20px', fontSize: '11px' }}
        />
      )}
    </CardContent>
  </Card>
);

const Overview = ({ latest, weather }) => {
  const SENSOR_CONFIG = getSensorConfig();
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [sensorOrder, setSensorOrder] = useState([]);
  const [touchState, setTouchState] = useState({
    isDragging: false,
    startIndex: null,
    currentY: null,
    offsetY: null
  });

  // Use weather from latest data. Sensors write -100 / 'None' as sentinels for
  // "no reading"; normalize those to null without mutating the source object
  // (which may be undefined when there's no data yet).
  const rawWeather = latest?.weather;
  const weatherData = rawWeather ? {
    ...rawWeather,
    temp_f: rawWeather.temp_f === -100 ? null : rawWeather.temp_f,
    temp_c: rawWeather.temp_c === -100 ? null : rawWeather.temp_c,
    humidity: rawWeather.humidity === -100 ? null : rawWeather.humidity,
    description: (!rawWeather.description || rawWeather.description === 'None') ? null : rawWeather.description,
  } : null;

  // Filter to only show alive sensors (enabled = alive from Firebase)
  const aliveSensors = Object.entries(SENSOR_CONFIG).filter(
    ([_, config]) => config.enabled !== false
  );

  // Load saved order from localStorage or use default order
  useEffect(() => {
    const savedOrder = localStorage.getItem(STORAGE_KEY);
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder);
        // Validate that saved order matches current sensors
        const currentSensorNames = aliveSensors.map(([name]) => name);
        const isValid = parsed.every(name => currentSensorNames.includes(name)) &&
          currentSensorNames.every(name => parsed.includes(name));

        if (isValid && parsed.length === currentSensorNames.length) {
          setSensorOrder(parsed);
        } else {
          // If saved order doesn't match, use default order
          setSensorOrder(currentSensorNames);
        }
      } catch (error) {
        console.error('Error parsing saved sensor order:', error);
        setSensorOrder(aliveSensors.map(([name]) => name));
      }
    } else {
      setSensorOrder(aliveSensors.map(([name]) => name));
    }
    // eslint-disable-next-line
  }, [SENSOR_CONFIG]);

  // Save order to localStorage whenever it changes
  useEffect(() => {
    if (sensorOrder.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sensorOrder));
    }
  }, [sensorOrder]);

  const handleDragStart = (index) => (e) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleDragOver = (index) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedIndex === null || draggedIndex === index) return;

    // Reorder the array
    const newOrder = [...sensorOrder];
    const draggedItem = newOrder[draggedIndex];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    setSensorOrder(newOrder);
    setDraggedIndex(index);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Touch event handlers for mobile
  const handleTouchStart = (index) => (e) => {
    const touch = e.touches[0];
    setTouchState({
      isDragging: true,
      startIndex: index,
      currentY: touch.clientY,
      offsetY: 0
    });
    setDraggedIndex(index);
  };

  const handleTouchMove = (e) => {
    if (!touchState.isDragging || touchState.startIndex === null) return;

    e.preventDefault(); // Prevent scrolling
    const touch = e.touches[0];
    // const deltaY = touch.clientY - touchState.currentY;

    // Find which card we're over based on Y position
    const cardElements = document.querySelectorAll('[data-sensor-card]');
    let newIndex = touchState.startIndex;

    cardElements.forEach((element, idx) => {
      const rect = element.getBoundingClientRect();
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        newIndex = idx;
      }
    });

    if (newIndex !== draggedIndex && newIndex !== touchState.startIndex) {
      // Reorder the array
      const newOrder = [...sensorOrder];
      const draggedItem = newOrder[touchState.startIndex];
      newOrder.splice(touchState.startIndex, 1);
      newOrder.splice(newIndex, 0, draggedItem);

      setSensorOrder(newOrder);
      setTouchState(prev => ({ ...prev, startIndex: newIndex }));
      setDraggedIndex(newIndex);
    }
  };

  const handleTouchEnd = () => {
    setTouchState({
      isDragging: false,
      startIndex: null,
      currentY: null,
      offsetY: null
    });
    setDraggedIndex(null);
  };

  // Get ordered sensor entries
  const orderedSensors = sensorOrder
    .map(name => {
      const config = SENSOR_CONFIG[name];
      return config ? [name, config] : null;
    })
    .filter(entry => entry !== null);

  return (
    <Box sx={{ p: 2, maxWidth: '800px', mx: 'auto' }}>
      {/* Temperature Sensors */}
      {orderedSensors.length > 0 ? (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <Typography
              variant="overline"
              sx={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#8e8e93',
                letterSpacing: '0.5px',
                mb: 1.5,
                display: 'block',
                textAlign: 'center'
              }}
            >
              Temperature Sensors
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontSize: '11px',
                color: '#8e8e93',
                mb: 2,
                display: 'block',
                textAlign: 'center',
                fontStyle: 'italic'
              }}
            >
              Drag cards to rearrange
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                justifyContent: 'center'
              }}
            >
              {orderedSensors.map(([sensorName, config], index) => (
                <Box key={sensorName} data-sensor-card>
                  <SensorCard
                    name={sensorName}
                    value={latest?.[sensorName]}
                    config={config}
                    onDragStart={handleDragStart(index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver(index)}
                    onDrop={handleDrop}
                    onTouchStart={handleTouchStart(index)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    isDragging={draggedIndex === index}
                  />
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <Typography
              variant="body2"
              sx={{
                textAlign: 'center',
                color: '#8e8e93',
                py: 2
              }}
            >
              No active sensors. Enable sensors in Settings or add them to Firebase.
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Weather Information */}
      {weatherData && (
        <Card sx={{ mb: 1.5, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
          <CardContent>
            <Typography
              variant="overline"
              sx={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#8e8e93',
                letterSpacing: '0.5px',
                mb: 1.5,
                display: 'block',
                textAlign: 'center'
              }}
            >
              Weather - {weatherData.location?.name || 'Unknown'}, {weatherData.location?.region || ''}
            </Typography>
            <Grid container spacing={2} justifyContent="center">
              <Grid item xs={12} sm={6}>
                <WeatherCard
                  label="Temperature"
                  value={weatherData.temp_f != null ? `${weatherData.temp_f.toFixed(1)}°F` : '--'}
                  subtitle={weatherData.humidity != null ? `Humidity: ${weatherData.humidity}%` : 'Humidity: --'}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <WeatherCard
                  label="Conditions"
                  value={weatherData.icon ? <img src={weatherData.icon} alt="weather" style={{ width: '40px', height: '40px' }} /> : 'N/A'}
                  subtitle={weatherData.description || '--'}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Last Update */}
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
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : 'Never'}
      </Typography>
    </Box>
  );
};

export default Overview;