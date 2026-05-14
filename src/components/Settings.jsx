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
  InputAdornment,
  Switch,
  FormControlLabel,
  // Chip,
  CircularProgress
} from '@mui/material';
import { 
  Save, 
  Refresh, 
  // CloudSync 
} from '@mui/icons-material';
import { updateSensorConfig } from '../services/api';

const Settings = ({ sensorConfig, onRefresh }) => {
  const [settings, setSettings] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load sensor config when it changes
  useEffect(() => {
    if (sensorConfig) {
      setSettings(sensorConfig);
      setHasChanges(false);
    }
  }, [sensorConfig]);

  const handleSensorChange = (sensorKey, field, value) => {
    setSettings(prev => ({
      ...prev,
      [sensorKey]: {
        ...prev[sensorKey],
        [field]: value
      }
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update each sensor's configuration in Firebase
      const updatePromises = Object.entries(settings).map(([sensorId, config]) => 
        updateSensorConfig(sensorId, config)
      );
      
      await Promise.all(updatePromises);
      
      setSnackbar({
        open: true,
        message: 'Settings saved to Firebase successfully!',
        severity: 'success'
      });
      setHasChanges(false);
      
      // Refresh data to get updated sensor config
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: 'Error saving settings: ' + error.message,
        severity: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (onRefresh) {
      await onRefresh();
      setSnackbar({
        open: true,
        message: 'Data refreshed from Firebase',
        severity: 'info'
      });
    }
  };

  const sensorEntries = Object.entries(settings);
  const enabledSensors = sensorEntries.filter(([_, config]) => config.enabled !== false);
  const disabledSensors = sensorEntries.filter(([_, config]) => config.enabled === false);

  return (
    <Box sx={{ p: 2 }}>
      {/* Info Card
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', mb: 2, bgcolor: '#f8f9fa' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'start', gap: 1.5, mb: 1 }}>
            <CloudSync sx={{ color: '#007aff', mt: 0.5 }} />
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  fontSize: '13px',
                  color: '#1c1c1e',
                  mb: 1,
                  fontWeight: 600
                }}
              >
                Firebase-Synced Configuration
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontSize: '12px',
                  color: '#8e8e93',
                  mb: 1
                }}
              >
                Sensor configuration is stored in Firebase at <code>/water-heater-user/sensors</code>. 
                Changes are synced across all devices. Your backend can add new sensors automatically.
              </Typography>
              <Chip 
                label={`${sensorEntries.length} sensor${sensorEntries.length !== 1 ? 's' : ''} in database`}
                size="small"
                color="primary"
                sx={{ mt: 0.5 }}
              />
            </Box>
          </Box>
        </CardContent>
      </Card> */}

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

          {sensorEntries.length === 0 ? (
            <Alert severity="info">
              No sensors in database. Add sensors to Firebase at <code>/water-heater-user/sensors</code> 
              or wait for them to be auto-discovered from sensor readings.
            </Alert>
          ) : (
            <>
              {/* Enabled Sensors */}
              {enabledSensors.length > 0 && (
                <>
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#8e8e93',
                      mb: 1.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    Active Sensors ({enabledSensors.length})
                  </Typography>
                  {enabledSensors.map(([key, sensor], index) => (
                    <Box key={key}>
                      {index > 0 && <Divider sx={{ my: 2 }} />}
                      
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                        <Typography
                          variant="subtitle2"
                          sx={{
                            fontSize: '15px',
                            fontWeight: 600,
                            color: '#1c1c1e'
                          }}
                        >
                          {key}
                        </Typography>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={sensor.enabled !== false}
                              onChange={(e) => handleSensorChange(key, 'enabled', e.target.checked)}
                              size="small"
                            />
                          }
                          label={
                            <Typography variant="caption" sx={{ fontSize: '12px', color: '#8e8e93' }}>
                              {sensor.enabled !== false ? 'Enabled' : 'Disabled'}
                            </Typography>
                          }
                        />
                      </Box>

                      <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                        <TextField
                          label="Display Name"
                          value={sensor.displayName || key}
                          onChange={(e) => handleSensorChange(key, 'displayName', e.target.value)}
                          fullWidth
                          size="small"
                          variant="outlined"
                        />

                        <TextField
                          label="Color"
                          type="color"
                          value={sensor.color || '#007aff'}
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
                                    bgcolor: sensor.color || '#007aff',
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
                </>
              )}

              {/* Disabled Sensors */}
              {disabledSensors.length > 0 && (
                <>
                  {enabledSensors.length > 0 && <Divider sx={{ my: 3 }} />}
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#8e8e93',
                      mb: 1.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    Disabled Sensors ({disabledSensors.length})
                  </Typography>
                  {disabledSensors.map(([key, sensor], index) => (
                    <Box key={key}>
                      {index > 0 && <Divider sx={{ my: 2 }} />}
                      
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, opacity: 0.6 }}>
                        <Typography
                          variant="subtitle2"
                          sx={{
                            fontSize: '15px',
                            fontWeight: 600,
                            color: '#1c1c1e'
                          }}
                        >
                          {key}
                        </Typography>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={sensor.enabled !== false}
                              onChange={(e) => handleSensorChange(key, 'enabled', e.target.checked)}
                              size="small"
                            />
                          }
                          label={
                            <Typography variant="caption" sx={{ fontSize: '12px', color: '#8e8e93' }}>
                              {sensor.enabled !== false ? 'Enabled' : 'Disabled'}
                            </Typography>
                          }
                        />
                      </Box>

                      <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                        <TextField
                          label="Display Name"
                          value={sensor.displayName || key}
                          onChange={(e) => handleSensorChange(key, 'displayName', e.target.value)}
                          fullWidth
                          size="small"
                          variant="outlined"
                          disabled
                        />

                        <TextField
                          label="Color"
                          type="color"
                          value={sensor.color || '#007aff'}
                          onChange={(e) => handleSensorChange(key, 'color', e.target.value)}
                          size="small"
                          variant="outlined"
                          sx={{ width: '120px' }}
                          disabled
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start">
                                <Box
                                  sx={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: '50%',
                                    bgcolor: sensor.color || '#007aff',
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
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save />}
          onClick={handleSave}
          disabled={!hasChanges || saving}
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
          {saving ? 'Saving...' : 'Save to Firebase'}
        </Button>

        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={handleRefresh}
          fullWidth
          sx={{
            borderColor: '#007aff',
            color: '#007aff',
            textTransform: 'none',
            fontWeight: 600,
            '&:hover': {
              borderColor: '#007aff',
              bgcolor: 'rgba(0, 122, 255, 0.05)'
            }
          }}
        >
          Refresh Data
        </Button>
      </Box>

      {hasChanges && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You have unsaved changes. Click "Save to Firebase" to sync your changes.
        </Alert>
      )}

      <Alert severity="info">
        Changes are saved directly to Firebase and will apply immediately after saving.
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