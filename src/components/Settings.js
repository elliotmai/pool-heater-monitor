import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  TextField,
  Button,
  Alert,
  Snackbar,
  Divider,
  InputAdornment
} from '@mui/material';
import { Save } from '@mui/icons-material';

const Settings = () => {
  const [settings, setSettings] = useState({
    sensors: {
      Blue: { displayName: 'Heater Input', color: '#007aff' },
      Red: { displayName: 'Heater Output', color: '#ff3b30' },
      Yellow: { displayName: 'Pool Return', color: '#ffcc00' },
      Green: { displayName: 'Pool Supply', color: '#34c759' }
    }
  });
  
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('poolHeaterSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        setSettings(parsed);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }, []);

  const handleSensorChange = (sensorKey, field, value) => {
    setSettings(prev => ({
      ...prev,
      sensors: {
        ...prev.sensors,
        [sensorKey]: {
          ...prev.sensors[sensorKey],
          [field]: value
        }
      }
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    try {
      localStorage.setItem('poolHeaterSettings', JSON.stringify(settings));
      setSnackbar({ 
        open: true, 
        message: 'Settings saved successfully! Please refresh the page to see changes.', 
        severity: 'success' 
      });
      setHasChanges(false);
    } catch (error) {
      setSnackbar({ 
        open: true, 
        message: 'Error saving settings: ' + error.message, 
        severity: 'error' 
      });
    }
  };

  const handleReset = () => {
    const defaultSettings = {
      sensors: {
        Blue: { displayName: 'Heater Input', color: '#007aff' },
        Red: { displayName: 'Heater Output', color: '#ff3b30' },
        Yellow: { displayName: 'Pool Return', color: '#ffcc00' },
        Green: { displayName: 'Pool Supply', color: '#34c759' }
      }
    };
    setSettings(defaultSettings);
    localStorage.setItem('poolHeaterSettings', JSON.stringify(defaultSettings));
    setSnackbar({ 
      open: true, 
      message: 'Settings reset to defaults. Please refresh the page.', 
      severity: 'info' 
    });
    setHasChanges(false);
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* Sensor Settings */}
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', mb: 2 }}>
        <CardContent>
          <Typography 
            variant="h6" 
            sx={{ 
              fontSize: '17px',
              fontWeight: 600,
              color: '#1c1c1e',
              mb: 2
            }}
          >
            Sensor Configuration
          </Typography>
          
          <Typography 
            variant="body2" 
            sx={{ 
              fontSize: '13px',
              color: '#8e8e93',
              mb: 2
            }}
          >
            Customize sensor names and colors for the dashboard
          </Typography>

          {Object.entries(settings.sensors).map(([key, sensor], index) => (
            <Box key={key}>
              {index > 0 && <Divider sx={{ my: 2 }} />}
              <Typography 
                variant="subtitle2" 
                sx={{ 
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#1c1c1e',
                  mb: 1.5
                }}
              >
                {key} Sensor
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                <TextField
                  label="Display Name"
                  value={sensor.displayName}
                  onChange={(e) => handleSensorChange(key, 'displayName', e.target.value)}
                  fullWidth
                  size="small"
                  variant="outlined"
                />
                
                <TextField
                  label="Color"
                  type="color"
                  value={sensor.color}
                  onChange={(e) => handleSensorChange(key, 'color', e.target.value)}
                  size="small"
                  variant="outlined"
                  sx={{ width: '120px' }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Box 
                          sx={{ 
                            width: 16, 
                            height: 16, 
                            borderRadius: '50%', 
                            bgcolor: sensor.color,
                            border: '1px solid rgba(0,0,0,0.1)'
                          }} 
                        />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
            </Box>
          ))}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={handleSave}
          disabled={!hasChanges}
          fullWidth
          sx={{
            bgcolor: '#007aff',
            color: 'white',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': {
              bgcolor: '#0051d5'
            },
            '&.Mui-disabled': {
              bgcolor: '#c7c7cc',
              color: 'white'
            }
          }}
        >
          Save Settings
        </Button>
        
        <Button
          variant="outlined"
          onClick={handleReset}
          fullWidth
          sx={{
            borderColor: '#ff3b30',
            color: '#ff3b30',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': {
              borderColor: '#ff3b30',
              bgcolor: 'rgba(255, 59, 48, 0.05)'
            }
          }}
        >
          Reset to Defaults
        </Button>
      </Box>

      {hasChanges && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You have unsaved changes. Click "Save Settings" to apply them.
        </Alert>
      )}

      <Alert severity="info">
        After saving settings, please refresh the page to see your changes applied throughout the app.
      </Alert>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Settings;