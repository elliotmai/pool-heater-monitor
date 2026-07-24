import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  BottomNavigation,
  BottomNavigationAction,
  Alert
} from '@mui/material';
import {
  Home,
  ShowChart,
  Insights,
  ListAlt,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import Overview from './components/Overview';
import Trends from './components/Trends';
import Stats from './components/Stats';
import Logs from './components/Logs';
import Settings from './components/Settings';
import LoadingScreen from './components/LoadingScreen';
import { fetchInitialData, fetchBackgroundData } from './services/api';
import { setSensorConfig } from './config/settingsUtils';
import { CONFIG } from './config/config';
import logo from './house-weather-logo-minimal.svg';
import './App.css';

function App() {
  const [currentTab, setCurrentTab] = useState(0);
  const [range, setRange] = useState('7d');
  const [data, setData] = useState({
    latest: null,
    historical: [],
    logs: [],
    sensorConfig: {}
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Keep the current range readable inside the interval callback without
  // re-subscribing the effect.
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const refreshData = async (selectedRange = rangeRef.current) => {
    try {
      setError(null);

      const initial = await fetchInitialData();
      setData(prev => ({
        ...prev,
        latest: initial.latest,
        sensorConfig: initial.sensorConfig,
      }));
      setSensorConfig(initial.sensorConfig);
      setLoading(false);

      const background = await fetchBackgroundData(selectedRange);
      setData(prev => ({
        ...prev,
        historical: background.historical,
        logs: background.logs,
      }));
    } catch (err) {
      setError('Failed to load data. Please try again.');
      setLoading(false);
    }
  };

  // Change the Trends fetch tier: refetch only when it actually changes.
  // Stable identity (uses refs) so Trends' effect doesn't loop.
  const handleRangeChange = useCallback((newRange) => {
    if (newRange === rangeRef.current) return;
    setRange(newRange);
    refreshData(newRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshData();

    const interval = setInterval(() => refreshData(), CONFIG.REFRESH_INTERVAL);
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
          onRangeChange={handleRangeChange}
        />;
      case 2:
        return <Stats sensorConfig={data.sensorConfig} latest={data.latest} />;
      case 3:
        return <Logs logs={data.logs} />;
      case 4:
        return <Settings sensorConfig={data.sensorConfig} onRefresh={refreshData} />;
      default:
        return null;
    }
  };

  if (loading) {
    return <LoadingScreen />;
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
          <img
            src={logo}
            alt="Temperature Monitor"
            style={{
              height: '28px',
              width: '28px',
              marginRight: '8px'
            }}
          />
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
          zIndex: 1000,
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
          label="Stats"
          icon={<Insights />}
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