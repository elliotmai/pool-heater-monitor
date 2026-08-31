import React, { useState, useEffect, useRef } from 'react';
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
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Save,
  Refresh,
  RestartAlt,
  UsbOff,
  // CloudSync
} from '@mui/icons-material';
import ExportButton from './ExportButton';
import { CONFIG } from '../config/config';
import {
  updateSensorConfig,
  logSensorEvent,
  requestPiRestart,
  fetchRestartStatus,
  requestSdrReset,
  fetchSdrResetStatus,
} from '../services/api';

const SENSOR_CONFIG_COLUMNS = [
  { key: 'sensor_id', label: 'Sensor ID' },
  { key: 'display_name', label: 'Display Name' },
  { key: 'location', label: 'Location' },
  { key: 'color', label: 'Color' },
  { key: 'enabled', label: 'Enabled' },
  { key: 'status', label: 'Status' },
  { key: 'last_seen', label: 'Last Seen' },
];

const fmtTime = (unixSec) =>
  new Date(unixSec * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/** Is the Pi still writing readings? `lastReadingSec` is its newest heartbeat. */
const piIsWriting = (lastReadingSec) =>
  !!lastReadingSec && (Date.now() / 1000 - lastReadingSec) / 60 <= CONFIG.PI_SILENT_AFTER_MINS;

/**
 * What an unacknowledged command means — which is not one thing.
 *
 * "Nobody picked this up" used to be reported as "the monitor isn't looping",
 * but the heartbeat can say otherwise: if readings are still arriving, the loop
 * IS running and it's the command read that's failing (the Pi logs that now).
 * Those need different fixes, so don't state the one we haven't checked.
 */
const neverPickedUp = (requested, waitedMins, lastReadingSec) => {
  const mins = Math.round(waitedMins);
  if (piIsWriting(lastReadingSec)) {
    return {
      text: `${requested} — never picked up (${mins} min ago), but readings are still arriving, so the monitor is running. It's the command read that's failing — check Logs.`,
      severity: 'warning',
    };
  }
  const silence = lastReadingSec
    ? `no readings since ${fmtTime(lastReadingSec)}`
    : 'no readings at all';
  return {
    text: `${requested} — never picked up (${mins} min ago), and ${silence}. The monitor isn't running: check the Pi's power and internet.`,
    severity: 'warning',
  };
};

/**
 * Plain-language state of the last restart request.
 *
 * The awkward case is a request the monitor restarted out from under: it only
 * honors requests newer than its own start, so anything older is dropped — and
 * that used to leave the node reading 'requested' forever, which looked exactly
 * like a monitor that had died. The Pi now marks those superseded.
 */
const describeRestart = (cmd, lastReadingSec) => {
  if (!cmd || !cmd.requested_at) return null;
  const requested = `Requested ${fmtTime(cmd.requested_at)}`;
  if (cmd.completed_at && cmd.completed_at >= cmd.requested_at) {
    return { text: `${requested} — monitor restarted ${fmtTime(cmd.completed_at)}.`, severity: 'success' };
  }
  if (cmd.status === 'superseded' && cmd.handled_at >= cmd.requested_at) {
    return {
      text: `${requested} — the monitor had already restarted by ${fmtTime(cmd.handled_at)}, so this request was dropped. Nothing is pending.`,
      severity: 'info',
    };
  }
  if (cmd.handled_at && cmd.handled_at >= cmd.requested_at) {
    return { text: `${requested} — picked up by the Pi ${fmtTime(cmd.handled_at)}, restarting.`, severity: 'info' };
  }
  const waitedMins = (Date.now() / 1000 - cmd.requested_at) / 60;
  if (waitedMins > 12) return neverPickedUp(requested, waitedMins, lastReadingSec);
  return { text: `${requested} — waiting for the Pi to pick it up (checks once a cycle).`, severity: 'info' };
};

/**
 * Plain-language state of the last USB reset. The Pi reports which step in the
 * ladder worked, so this can say what actually fixed things rather than just
 * "done" — and, when nothing did, that the dongle really does need hands on it.
 */
const describeSdrReset = (cmd, lastReadingSec) => {
  if (!cmd || !cmd.requested_at) return null;
  const requested = `Requested ${fmtTime(cmd.requested_at)}`;
  const done = cmd.completed_at && cmd.completed_at >= cmd.requested_at;
  if (done) {
    return {
      text: `${requested} — ${cmd.summary || 'finished'}`,
      severity: cmd.status === 'completed' ? 'success' : 'error',
    };
  }
  if (cmd.handled_at && cmd.handled_at >= cmd.requested_at) {
    // The ladder takes a few minutes at most. Much longer than that and the
    // monitor died partway through, which is worth saying rather than leaving
    // "working on it" on screen indefinitely.
    const runningMins = (Date.now() / 1000 - cmd.handled_at) / 60;
    if (runningMins > 20) {
      return {
        text: `${requested} — the Pi started the reset but never reported back, so it stopped partway through. Try again.`,
        severity: 'warning',
      };
    }
    return { text: `${requested} — the Pi is working through the reset steps.`, severity: 'info' };
  }
  const waitedMins = (Date.now() / 1000 - cmd.requested_at) / 60;
  if (waitedMins > 12) return neverPickedUp(requested, waitedMins, lastReadingSec);
  return { text: `${requested} — waiting for the Pi to pick it up (checks once a cycle).`, severity: 'info' };
};

const Settings = ({ sensorConfig, latest, onRefresh }) => {
  const [settings, setSettings] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restartCmd, setRestartCmd] = useState(null);
  const restartPoll = useRef(null);
  const [sdrOpen, setSdrOpen] = useState(false);
  const [sdrCmd, setSdrCmd] = useState(null);
  const sdrPoll = useRef(null);

  // Show the outcome of the last restart request (if any) on open, and never
  // leave the follow-up poll running after this tab goes away.
  useEffect(() => {
    let cancelled = false;
    fetchRestartStatus().then(cmd => { if (!cancelled) setRestartCmd(cmd); });
    fetchSdrResetStatus().then(cmd => { if (!cancelled) setSdrCmd(cmd); });
    return () => {
      cancelled = true;
      if (restartPoll.current) clearInterval(restartPoll.current);
      if (sdrPoll.current) clearInterval(sdrPoll.current);
    };
  }, []);

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
      // Diff against the last-saved config to record what changed as a sensor
      // event (rename / move / enable / disable) — the audit trail.
      const events = [];
      Object.entries(settings).forEach(([id, cfg]) => {
        const orig = sensorConfig?.[id] || {};
        const oldName = orig.displayName || id;
        const newName = cfg.displayName || id;
        if (newName !== oldName) events.push([id, 'renamed', { from: oldName, to: newName }]);

        const oldLoc = orig.location || '';
        const newLoc = cfg.location || '';
        if (newLoc !== oldLoc) events.push([id, 'moved', { from: oldLoc || '—', to: newLoc || '—' }]);

        const oldEnabled = orig.enabled !== false;
        const newEnabled = cfg.enabled !== false;
        if (newEnabled !== oldEnabled) events.push([id, newEnabled ? 'enabled' : 'disabled', {}]);
      });

      // Update each sensor's configuration in Firebase
      await Promise.all(Object.entries(settings).map(([sensorId, config]) =>
        updateSensorConfig(sensorId, config)
      ));

      // Record the change events (best-effort; don't fail the save on these)
      await Promise.all(events.map(([id, ev, extra]) => logSensorEvent(id, ev, extra)));

      setSnackbar({
        open: true,
        message: events.length
          ? `Saved · logged ${events.length} change${events.length !== 1 ? 's' : ''}`
          : 'Settings saved to Firebase successfully!',
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

  const handleRestart = async () => {
    setRestartOpen(false);
    const ok = await requestPiRestart();
    setSnackbar({
      open: true,
      message: ok
        ? 'Restart requested — watch below to see whether the Pi picks it up.'
        : 'Failed to send restart request.',
      severity: ok ? 'info' : 'error',
    });
    if (!ok) return;

    // Follow the request through instead of assuming it landed: the Pi only
    // checks once per ~5-min cycle, so poll for a couple of cycles and stop.
    setRestartCmd(await fetchRestartStatus());
    const started = Date.now();
    if (restartPoll.current) clearInterval(restartPoll.current);
    restartPoll.current = setInterval(async () => {
      const cmd = await fetchRestartStatus();
      setRestartCmd(cmd);
      const done = cmd?.completed_at && cmd.completed_at >= cmd.requested_at;
      if (done || Date.now() - started > 12 * 60 * 1000) {
        clearInterval(restartPoll.current);
        restartPoll.current = null;
      }
    }, 15000);
  };

  const handleSdrReset = async () => {
    setSdrOpen(false);
    const ok = await requestSdrReset();
    setSnackbar({
      open: true,
      message: ok
        ? 'USB reset requested — the Pi will work through the reset steps and report back below.'
        : 'Failed to send the USB reset request.',
      severity: ok ? 'info' : 'error',
    });
    if (!ok) return;

    // The ladder itself takes a couple of minutes on top of the Pi's ~5-min
    // command check, so poll a little longer than the restart flow does.
    setSdrCmd(await fetchSdrResetStatus());
    const started = Date.now();
    if (sdrPoll.current) clearInterval(sdrPoll.current);
    sdrPoll.current = setInterval(async () => {
      const cmd = await fetchSdrResetStatus();
      setSdrCmd(cmd);
      const done = cmd?.completed_at && cmd.completed_at >= cmd.requested_at;
      if (done || Date.now() - started > 15 * 60 * 1000) {
        clearInterval(sdrPoll.current);
        sdrPoll.current = null;
      }
    }, 15000);
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

  // The heartbeat is what separates "the monitor is gone" from "the monitor is
  // fine and the command read is failing", so both messages get to see it.
  const lastReadingSec = latest?.unix_timestamp || null;
  const restartStatus = describeRestart(restartCmd, lastReadingSec);
  const sdrStatus = describeSdrReset(sdrCmd, lastReadingSec);
  const sensorEntries = Object.entries(settings);
  // Exports what's on screen, so it includes edits that haven't been saved yet.
  const sensorConfigRows = sensorEntries.map(([sensorId, config]) => ({
    sensor_id: sensorId,
    display_name: config.displayName || sensorId,
    location: config.location || '',
    color: config.color || '',
    enabled: config.enabled !== false,
    status: config.status || '',
    last_seen: config.lastSeen ? new Date(config.lastSeen * 1000).toISOString() : '',
  }));
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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography
              variant="h6"
              sx={{
                fontSize: '17px',
                fontWeight: 600,
                color: '#1c1c1e'
              }}
            >
              Sensor Configuration
            </Typography>
            <ExportButton
              filename="house-weather-sensors"
              columns={SENSOR_CONFIG_COLUMNS}
              rows={sensorConfigRows}
              disabled={sensorConfigRows.length === 0}
            />
          </Box>

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

                      <TextField
                        label="Location"
                        placeholder="e.g. Living Room, Garage, Outdoor"
                        value={sensor.location || ''}
                        onChange={(e) => handleSensorChange(key, 'location', e.target.value)}
                        fullWidth
                        size="small"
                        variant="outlined"
                        helperText="Changing this logs a 'moved' event in the sensor timeline"
                      />
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

      {/* Device Control */}
      <Card sx={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontSize: '17px', fontWeight: 600, color: '#1c1c1e', mb: 0.5 }}>
            Device
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '12px', color: '#8e8e93', mb: 1.5 }}>
            Remotely restart the monitor on the Pi (e.g. if the receiver seems stuck).
            Takes effect within a few minutes — only while the Pi is online.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<RestartAlt />}
            onClick={() => setRestartOpen(true)}
            sx={{
              borderColor: '#ff9500', color: '#ff9500', textTransform: 'none', fontWeight: 600,
              '&:hover': { borderColor: '#ff9500', bgcolor: 'rgba(255, 149, 0, 0.05)' },
            }}
          >
            Restart Monitor
          </Button>
          {restartStatus && (
            <Alert severity={restartStatus.severity} sx={{ mt: 1.5, fontSize: '12px', py: 0.5 }}>
              {restartStatus.text}
            </Alert>
          )}

          <Divider sx={{ my: 2 }} />

          <Typography variant="body2" sx={{ fontSize: '12px', color: '#8e8e93', mb: 1.5 }}>
            If no sensor is reporting and a restart doesn't help, reset the receiver itself.
            This is the software version of unplugging and replugging the USB dongle — which a
            restart, and even a reboot, can't do because the Pi keeps its USB ports powered.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<UsbOff />}
            onClick={() => setSdrOpen(true)}
            sx={{
              borderColor: '#af52de', color: '#af52de', textTransform: 'none', fontWeight: 600,
              '&:hover': { borderColor: '#af52de', bgcolor: 'rgba(175, 82, 222, 0.05)' },
            }}
          >
            Reset Receiver (USB)
          </Button>
          {sdrStatus && (
            <Alert severity={sdrStatus.severity} sx={{ mt: 1.5, fontSize: '12px', py: 0.5 }}>
              {sdrStatus.text}
            </Alert>
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

      {/* Restart confirmation */}
      <Dialog open={restartOpen} onClose={() => setRestartOpen(false)}>
        <DialogTitle sx={{ fontSize: '17px', fontWeight: 600 }}>Restart the monitor?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '14px' }}>
            The Pi will stop and restart its monitor service within a few minutes. Data collection
            pauses briefly during the restart. This only works while the Pi is online.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestartOpen(false)} sx={{ textTransform: 'none', color: '#8e8e93' }}>Cancel</Button>
          <Button onClick={handleRestart} sx={{ textTransform: 'none', fontWeight: 600, color: '#ff9500' }}>Restart</Button>
        </DialogActions>
      </Dialog>

      {/* USB reset confirmation */}
      <Dialog open={sdrOpen} onClose={() => setSdrOpen(false)}>
        <DialogTitle sx={{ fontSize: '17px', fontWeight: 600 }}>Reset the receiver?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '14px' }}>
            The Pi will try increasingly forceful ways to revive the USB dongle — a port reset
            first, then a full reconnect, and finally cutting power to the port — stopping as soon
            as the receiver starts hearing sensors again. It reports which step worked. Readings
            pause for a few minutes, and this only works while the Pi is online.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSdrOpen(false)} sx={{ textTransform: 'none', color: '#8e8e93' }}>Cancel</Button>
          <Button onClick={handleSdrReset} sx={{ textTransform: 'none', fontWeight: 600, color: '#af52de' }}>Reset</Button>
        </DialogActions>
      </Dialog>

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