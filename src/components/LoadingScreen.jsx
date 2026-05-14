import React, { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';

const MESSAGES = [
  'Connecting to sensors…',
  'Reading temperatures…',
  'Loading recent history…',
  'Almost there…',
];

const LoadingScreen = () => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [temp, setTemp] = useState(72);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMessageIndex(i => (i + 1) % MESSAGES.length);
    }, 1800);

    // Gentle fluctuation around a plausible indoor temperature to mimic a live sensor.
    const tempTimer = setInterval(() => {
      setTemp(prev => {
        const drift = Math.random() < 0.5 ? -1 : 1;
        const next = prev + drift;
        if (next < 68) return 69;
        if (next > 78) return 77;
        return next;
      });
    }, 450);

    return () => {
      clearInterval(msgTimer);
      clearInterval(tempTimer);
    };
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'white',
        gap: 3,
        px: 2,
      }}
    >
      <svg
        width="110"
        height="240"
        viewBox="0 0 110 240"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Tube background */}
        <rect
          x="42"
          y="18"
          width="26"
          height="160"
          rx="13"
          fill="#f2f2f7"
          stroke="#d1d1d6"
          strokeWidth="2"
        />
        {/* Bulb background */}
        <circle cx="55" cy="195" r="28" fill="#ff3b30" stroke="#d1d1d6" strokeWidth="2" />
        {/* Bulb highlight */}
        <circle cx="48" cy="188" r="8" fill="rgba(255,255,255,0.28)" />

        {/* Animated mercury column. Bottom anchored at y=176 (bulb top inside tube). */}
        <rect x="46" width="18" fill="#ff3b30" rx="2">
          <animate
            attributeName="y"
            values="160;30;160"
            keyTimes="0;0.5;1"
            dur="2.6s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
          />
          <animate
            attributeName="height"
            values="16;146;16"
            keyTimes="0;0.5;1"
            dur="2.6s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
          />
        </rect>

        {/* Tick marks */}
        {[42, 70, 98, 126, 154].map(y => (
          <line
            key={y}
            x1="70"
            y1={y}
            x2="78"
            y2={y}
            stroke="#c7c7cc"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ))}
      </svg>

      <Typography
        sx={{
          fontSize: '56px',
          fontWeight: 600,
          color: '#1c1c1e',
          letterSpacing: '-2px',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          mt: -1,
        }}
      >
        {temp}&deg;F
      </Typography>

      <Typography
        sx={{
          fontSize: '15px',
          color: '#8e8e93',
          fontWeight: 500,
          minHeight: '22px',
          textAlign: 'center',
        }}
      >
        {MESSAGES[messageIndex]}
      </Typography>
    </Box>
  );
};

export default LoadingScreen;
