import React, { useEffect, useRef } from 'react';
import { motion, animate } from 'framer-motion';

interface CountdownRingProps {
  totalSeconds:     number;
  remainingSeconds: number;
}

const SIZE          = 60;
const STROKE_WIDTH  = 5;
const RADIUS        = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ringColor(s: number): string {
  if (s < 8)  return '#ef4444';  // red
  if (s < 20) return '#f59e0b';  // amber
  return '#22c55e';              // green
}

const srOnlyStyle: React.CSSProperties = {
  position:   'absolute',
  width:      '1px',
  height:     '1px',
  padding:    0,
  margin:     '-1px',
  overflow:   'hidden',
  clip:       'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border:     0,
};

export const CountdownRing: React.FC<CountdownRingProps> = ({
  totalSeconds,
  remainingSeconds,
}) => {
  const circleRef = useRef<SVGCircleElement>(null);

  const fraction = Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
  const offset   = CIRCUMFERENCE * (1 - fraction);
  const color    = ringColor(remainingSeconds);

  // Animate strokeDashoffset with spring on each tick
  useEffect(() => {
    if (!circleRef.current) return;
    animate(circleRef.current, { strokeDashoffset: offset }, {
      type:      'spring',
      stiffness: 60,
      damping:   20,
    });
  }, [offset]);

  // Screen reader announcement every 10 s
  const announce = remainingSeconds % 10 === 0 && remainingSeconds > 0
    ? `${remainingSeconds} seconds remaining`
    : undefined;

  const mins  = Math.floor(remainingSeconds / 60);
  const secs  = remainingSeconds % 60;
  const label = `${mins}:${String(secs).padStart(2, '0')}`;

  return (
    // Outer div: fixed size, relative so the text label can overlay
    <div
      role="timer"
      aria-label={`${remainingSeconds} seconds remaining`}
      style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}
    >
      {/* Live region for screen readers — visually hidden, NOT rotated */}
      {announce && (
        <span style={srOnlyStyle} aria-live="polite">{announce}</span>
      )}

      {/* SVG rotated -90° so stroke starts at 12 o'clock */}
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ display: 'block', transform: 'rotate(-90deg)' }}
        aria-hidden
      >
        {/* Background track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="rgba(0,0,0,0.10)"
          strokeWidth={STROKE_WIDTH}
        />
        {/* Animated progress arc */}
        <motion.circle
          ref={circleRef}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          animate={{ stroke: color }}
          transition={{ duration: 0.35 }}
        />
      </svg>

      {/*
        Label sits in its OWN absolutely-positioned layer, completely
        outside the rotated SVG — so it is never affected by the rotation.
      */}
      <span
        aria-hidden
        style={{
          position:       'absolute',
          inset:          0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          fontFamily:     '"Courier New", Courier, monospace',
          fontSize:       '11px',
          fontWeight:     700,
          color,
          transition:     'color 0.35s ease',
          letterSpacing:  '-0.02em',
          // ensure it is NOT rotated
          transform:      'none',
          pointerEvents:  'none',
        }}
      >
        {label}
      </span>
    </div>
  );
};