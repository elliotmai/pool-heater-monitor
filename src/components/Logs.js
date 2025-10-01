import React, { useState, useMemo } from 'react';
import { Box, Card, CardContent, Typography, Avatar, TextField, ToggleButtonGroup, ToggleButton, InputAdornment } from '@mui/material';
import { Info, Warning, Error as ErrorIcon, Inbox, Search as SearchIcon } from '@mui/icons-material';

const getLogIcon = (level) => {
  switch (level.toUpperCase()) {
    case 'ERROR':
      return <ErrorIcon sx={{ fontSize: 16 }} />;
    case 'WARNING':
      return <Warning sx={{ fontSize: 16 }} />;
    default:
      return <Info sx={{ fontSize: 16 }} />;
  }
};

const getLogColor = (level) => {
  switch (level.toUpperCase()) {
    case 'ERROR':
      return '#ff3b30';
    case 'WARNING':
      return '#ff9500';
    default:
      return '#007aff';
  }
};

const LogItem = ({ log }) => {
  const time = new Date(log.timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <Card 
      sx={{ 
        mb: 1,
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
        border: '1px solid rgba(0, 0, 0, 0.05)'
      }}
    >
      <CardContent sx={{ display: 'flex', gap: 1.5, p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Avatar 
          sx={{ 
            width: 32, 
            height: 32,
            bgcolor: getLogColor(log.level),
            borderRadius: 1
          }}
        >
          {getLogIcon(log.level)}
        </Avatar>
        <Box sx={{ flex: 1 }}>
          <Typography 
            variant="caption" 
            sx={{ 
              fontSize: '11px',
              color: '#8e8e93',
              display: 'block',
              mb: 0.5
            }}
          >
            {time}
          </Typography>
          <Typography 
            variant="body2" 
            sx={{ 
              fontSize: '14px',
              color: '#1c1c1e',
              lineHeight: 1.4
            }}
          >
            {log.message}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

const Logs = ({ logs }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('all');

  const handleLevelFilterChange = (event, newFilter) => {
    if (newFilter !== null) {
      setLevelFilter(newFilter);
    }
  };

  const handleTimeFilterChange = (event, newFilter) => {
    if (newFilter !== null) {
      setTimeFilter(newFilter);
    }
  };

  // Filter logs based on search, level, and time
  const filteredLogs = useMemo(() => {
    if (!logs || logs.length === 0) return [];

    let filtered = [...logs];

    // Filter by search query
    if (searchQuery.trim()) {
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by level
    if (levelFilter !== 'all') {
      filtered = filtered.filter(log => 
        log.level.toUpperCase() === levelFilter.toUpperCase()
      );
    }

    // Filter by time
    if (timeFilter !== 'all') {
      const now = new Date();
      let hoursAgo;

      switch (timeFilter) {
        case '1h':
          hoursAgo = 1;
          break;
        case '6h':
          hoursAgo = 6;
          break;
        case '24h':
          hoursAgo = 24;
          break;
        case '7d':
          hoursAgo = 24 * 7;
          break;
        default:
          hoursAgo = null;
      }

      if (hoursAgo) {
        const cutoffTime = now.getTime() - (hoursAgo * 60 * 60 * 1000);
        filtered = filtered.filter(log => {
          const logTime = new Date(log.timestamp).getTime();
          return logTime >= cutoffTime;
        });
      }
    }

    return filtered;
  }, [logs, searchQuery, levelFilter, timeFilter]);

  if (!logs || logs.length === 0) {
    return (
      <Box 
        sx={{ 
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          color: '#8e8e93'
        }}
      >
        <Inbox sx={{ fontSize: 48, opacity: 0.3, mb: 1.5 }} />
        <Typography variant="body2">No logs available</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Search Bar */}
      <Card sx={{ mb: 2, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)' }}>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 20, color: '#8e8e93' }} />
                </InputAdornment>
              ),
              sx: {
                fontSize: '14px',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(0, 0, 0, 0.12)'
                }
              }
            }}
          />
        </CardContent>
      </Card>

      {/* Filters */}
      <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
        {/* Level Filter */}
        <ToggleButtonGroup
          value={levelFilter}
          exclusive
          onChange={handleLevelFilterChange}
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
                backgroundColor: '#007aff',
                color: 'white',
                '&:hover': {
                  backgroundColor: '#0051d5'
                }
              }
            }
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="info">Info</ToggleButton>
          <ToggleButton value="warning">Warning</ToggleButton>
          <ToggleButton value="error">Error</ToggleButton>
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
          <ToggleButton value="1h">Last Hour</ToggleButton>
          <ToggleButton value="6h">Last 6 Hours</ToggleButton>
          <ToggleButton value="24h">Last 24 Hours</ToggleButton>
          <ToggleButton value="7d">Last 7 Days</ToggleButton>
          <ToggleButton value="all">All Time</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Results Count */}
      <Typography 
        variant="caption" 
        sx={{ 
          display: 'block',
          textAlign: 'center',
          color: '#8e8e93',
          fontSize: '11px',
          mb: 1.5
        }}
      >
        Showing {filteredLogs.length} of {logs.length} logs
      </Typography>

      {/* Logs List */}
      {filteredLogs.length > 0 ? (
        filteredLogs.map((log, index) => (
          <LogItem key={index} log={log} />
        ))
      ) : (
        <Box 
          sx={{ 
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '30vh',
            color: '#8e8e93'
          }}
        >
          <SearchIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1.5 }} />
          <Typography variant="body2">No logs match your filters</Typography>
          <Typography variant="caption" sx={{ mt: 0.5 }}>
            Try adjusting your search or filters
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default Logs;