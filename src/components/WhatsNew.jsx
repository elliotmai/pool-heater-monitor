import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
} from '@mui/material';
import { WHATS_NEW } from '../config/whatsNew';

const STORAGE_KEY = 'pool-heater-monitor.whatsNewSeen';

/**
 * Accumulating "What's New" popup. The next time a person opens the app after one
 * or more updates, it shows EVERY changelog entry newer than what this device has
 * already seen — combined into a single popup — then remembers the latest version
 * locally so nothing repeats until the next update.
 *
 * First visit on a device shows only the newest entry (not the whole history);
 * a returning device that missed several releases sees them all stacked together.
 */
function WhatsNew() {
  const latest = WHATS_NEW[0];
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    if (!latest) return;
    let seen = null;
    try {
      seen = localStorage.getItem(STORAGE_KEY);
    } catch {
      seen = null;
    }
    // Versions are zero-padded YYYY.MM.DD, so string comparison orders them.
    const unseen = seen == null ? [latest] : WHATS_NEW.filter((e) => e.version > seen);
    if (unseen.length) setEntries(unseen);
  }, [latest]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, latest.version);
    } catch {
      /* ignore storage failures */
    }
    setEntries([]);
  };

  if (!entries.length || !latest) return null;

  const stacked = entries.length > 1;

  return (
    <Dialog
      open
      onClose={dismiss}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '20px',
          m: 2,
        },
      }}
    >
      <DialogContent sx={{ pt: 3, pb: 1 }}>
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Box sx={{ fontSize: '32px', lineHeight: 1 }}>🏠</Box>
          <Typography
            variant="h6"
            sx={{ mt: 1, fontWeight: 600, letterSpacing: '-0.4px' }}
          >
            What's new
          </Typography>
          {!stacked && latest.date && (
            <Typography variant="caption" sx={{ color: '#8e8e93' }}>
              {latest.date}
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            maxHeight: '52vh',
            overflowY: 'auto',
          }}
        >
          {entries.map((entry) => (
            <Box key={entry.version} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {stacked && entry.date && (
                <Typography
                  variant="caption"
                  sx={{ px: 0.5, fontWeight: 600, color: '#8e8e93' }}
                >
                  {entry.date}
                </Typography>
              )}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {entry.items.map((item, i) => (
                  <Box
                    key={i}
                    sx={{
                      borderRadius: '12px',
                      bgcolor: '#f8f9fa',
                      border: '0.5px solid rgba(0, 0, 0, 0.08)',
                      p: 1.5,
                      fontSize: '13px',
                      lineHeight: 1.4,
                    }}
                  >
                    {item}
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
        <Button
          onClick={dismiss}
          variant="contained"
          fullWidth
          disableElevation
          sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600, py: 1 }}
        >
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default WhatsNew;
