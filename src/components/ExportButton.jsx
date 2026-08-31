import React, { useState } from 'react';
import { Button, Menu, MenuItem, ListItemIcon, ListItemText, Snackbar, Alert } from '@mui/material';
import { FileDownloadOutlined, TableChartOutlined, DataObjectOutlined } from '@mui/icons-material';
import { exportData } from '../services/exportData';

/**
 * "Export" control shared by every data view: a small button that offers CSV
 * or JSON and downloads whatever the view is currently showing.
 *
 * `rows` and `json` may be functions — a view that computes an expensive
 * payload (Stats) can then build it on click instead of on every render.
 */
const resolve = (value) => (typeof value === 'function' ? value() : value);

const ExportButton = ({
  filename,
  columns = [],
  rows = [],
  json,
  label = 'Export',
  disabled = false,
  size = 'small',
  sx = {},
}) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [toast, setToast] = useState(null);

  const handleExport = (format) => {
    setAnchorEl(null);
    try {
      const resolvedRows = resolve(rows) || [];
      const count = exportData({
        format,
        filename,
        rows: resolvedRows,
        columns,
        json: resolve(json),
      });
      setToast({
        severity: 'success',
        message: `Exported ${count} row${count === 1 ? '' : 's'} as ${format.toUpperCase()}`,
      });
    } catch (error) {
      // A failed export must not look like a successful one — the browser gives
      // no feedback of its own when the download never starts.
      console.error('Export failed:', error);
      setToast({ severity: 'error', message: 'Export failed — nothing was downloaded.' });
    }
  };

  return (
    <>
      <Button
        size={size}
        startIcon={<FileDownloadOutlined sx={{ fontSize: 16 }} />}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        disabled={disabled}
        sx={{
          textTransform: 'none',
          fontSize: '12px',
          fontWeight: 600,
          color: '#007aff',
          minWidth: 'auto',
          px: 1,
          '&:hover': { bgcolor: 'rgba(0, 122, 255, 0.05)' },
          '&.Mui-disabled': { color: '#c7c7cc' },
          ...sx,
        }}
      >
        {label}
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => handleExport('csv')} sx={{ fontSize: '13px' }}>
          <ListItemIcon><TableChartOutlined sx={{ fontSize: 18, color: '#34c759' }} /></ListItemIcon>
          <ListItemText
            primary="CSV"
            secondary="Spreadsheet"
            primaryTypographyProps={{ fontSize: '13px', fontWeight: 600 }}
            secondaryTypographyProps={{ fontSize: '11px' }}
          />
        </MenuItem>
        <MenuItem onClick={() => handleExport('json')} sx={{ fontSize: '13px' }}>
          <ListItemIcon><DataObjectOutlined sx={{ fontSize: 18, color: '#007aff' }} /></ListItemIcon>
          <ListItemText
            primary="JSON"
            secondary="Raw data"
            primaryTypographyProps={{ fontSize: '13px', fontWeight: 600 }}
            secondaryTypographyProps={{ fontSize: '11px' }}
          />
        </MenuItem>
      </Menu>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 80 } }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ fontSize: '12px' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
};

export default ExportButton;
