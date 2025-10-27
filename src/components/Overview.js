import React from 'react';
import { Box, Card, CardContent, Grid, Typography, Chip } from '@mui/material';
import { getLocation, getSensorConfig } from '../config/settingsUtils';

const SENSOR_CONFIG = getSensorConfig();
const LOCATION_CONFIG = getLocation();


// const getUVBadge = (uv) => {
//   if (uv < 3) return { label: 'Low', color: 'success' };
//   if (uv < 6) return { label: 'Moderate', color: 'warning' };
//   if (uv < 8) return { label: 'High', color: 'error' };
//   return { label: 'Very High', color: 'error' };
// };

const SensorCard = ({ name, value, config }) => (
  <Card 
    sx={{ 
      background: 'linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%)',
      border: '1px solid rgba(0, 0, 0, 0.05)',
      boxShadow: 'none'
    }}
  >
    <CardContent sx={{ textAlign: 'center', py: 2 }}>
      <Typography 
        variant="caption" 
        sx={{ 
          color: '#8e8e93',
          fontSize: '13px',
          fontWeight: 600,
          display: 'block',
          mb: 1
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
//   const uvBadge = weather ? getUVBadge(weather.current.uv) : null;

  return (
    <Box sx={{ p: 2, maxWidth: '800px', mx: 'auto' }}>
      {/* Temperature Sensors */}
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
          <Grid container spacing={0} justifyContent={"center"} justifyItems={"center"}>
            {Object.entries(SENSOR_CONFIG).map(([sensorName, config]) => (
              <Grid item xs={12} sm={12} m={2} key={sensorName}>
                <SensorCard 
                  name={sensorName}
                  value={latest?.[sensorName]}
                  config={config}
                />
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>

      {/* Weather Information */}
      {weather && (
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
              Weather - {LOCATION_CONFIG.name}
            </Typography>
            <Grid container spacing={2} justifyContent="center">
              <Grid item xs={12} sm={6}>
                <WeatherCard 
                  label="Temperature"
                  value={`${weather.current.temp_f.toFixed(1)}°F`}
                  subtitle={`Feels like ${weather.current.feelslike_f.toFixed(1)}°F`}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <WeatherCard 
                  label="Humidity"
                  value={`${weather.current.humidity}%`}
                  subtitle={weather.current.condition.text}
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
          hour: '2-digit', 
          minute: '2-digit' 
        }) : 'Never'}
      </Typography>
    </Box>
  );
};

export default Overview;