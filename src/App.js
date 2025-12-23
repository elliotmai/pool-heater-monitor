import React, { useState, useEffect } from 'react';
import { 
  Box, 
  AppBar, 
  Toolbar, 
  Typography, 
  // IconButton, 
  BottomNavigation,
  BottomNavigationAction,
  CircularProgress,
  Alert
} from '@mui/material';
import { 
  Home,
  ShowChart, 
  ListAlt,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import Overview from './components/Overview';
import Trends from './components/Trends';
import Logs from './components/Logs';
import Settings from './components/Settings';
import { fetchAllData } from './services/api';
import { CONFIG } from './config/config';
import './App.css';

function App() {
  const [currentTab, setCurrentTab] = useState(0);
  const [data, setData] = useState({
    latest: null,
    historical: [],
    weatherHistory: [],
    logs: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refreshData = async (targetDate) => {
    try {
      setError(null);
      const newData = await fetchAllData(targetDate);
      setData(newData);
      setLoading(false);
      
    } catch (err) {
      setError('Failed to load data. Please try again.');
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch data on mount
    refreshData();

    // Set up auto-refresh
    const interval = setInterval(refreshData, CONFIG.REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const renderTabContent = () => {
    switch (currentTab) {
      case 0:
        return <Overview latest={data.latest} />;
      case 1:
        return <Trends 
            latest={data.latest} 
            historical={data.historical} 
            weatherHistory={data.weatherHistory}
            onDateChange={refreshData}
          />;
      case 2:
        return <Logs logs={data.logs} />;
      case 3:
        return <Settings />;
      default:
        return null;
    }
  };

  if (loading && !data.latest) {
    return (
      <Box 
        sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '100vh',
          bgcolor: 'white'
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 8 }}>
      {/* Status Bar */}
      <AppBar 
        position="fixed" 
        sx={{ 
          bgcolor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0.5px 0 rgba(0, 0, 0, 0.1)',
          color: '#1c1c1e'
        }}
      >
        <Toolbar sx={{ minHeight: '44px !important', py: 0 }}>
          <ThermostatIcon sx={{ mr: 1, fontSize: 20 }} />
          <Typography 
            variant="h6" 
            component="div" 
            sx={{ 
              flexGrow: 1,
              fontSize: '17px',
              fontWeight: 600,
              letterSpacing: '-0.4px'
            }}
          >
            House Weather Monitor
          </Typography>
          {/* <IconButton 
            onClick={refreshData}
            sx={{ color: '#007aff' }}
          >
            <Refresh />
          </IconButton> */}
        </Toolbar>
      </AppBar>

      {/* Content Area */}
      <Box sx={{ mt: '44px', minHeight: 'calc(100vh - 124px)' }}>
        {error && (
          <Box sx={{ p: 2 }}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}
        {renderTabContent()}
      </Box>

      {/* Bottom Tab Bar */}
      <BottomNavigation
        value={currentTab}
        onChange={(event, newValue) => setCurrentTab(newValue)}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          bgcolor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px)',
          borderTop: '0.5px solid rgba(0, 0, 0, 0.1)',
          height: 64,
          '& .MuiBottomNavigationAction-root': {
            color: '#8e8e93',
            minWidth: 'auto',
            padding: '8px 12px',
            '&.Mui-selected': {
              color: '#007aff'
            }
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: '10px',
            fontWeight: 500,
            mt: 0.5,
            '&.Mui-selected': {
              fontSize: '10px'
            }
          }
        }}
      >
        <BottomNavigationAction 
          label="Overview" 
          icon={<Home />} 
        />
        <BottomNavigationAction 
          label="Trends" 
          icon={<ShowChart />} 
        />
        <BottomNavigationAction 
          label="Logs" 
          icon={<ListAlt />} 
        />
        <BottomNavigationAction 
          label="Settings" 
          icon={<SettingsIcon />} 
        />
      </BottomNavigation>
    </Box>
  );
}

export default App;