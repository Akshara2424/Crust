import React from 'react';

interface CrustStatusBadgeProps {
  confidence: number | null;
  decision:   string | null;
}

const DECISION_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  PASS:           { bg: '#dcfce7', color: '#15803d', label: 'PASS' },
  SOFT_CHALLENGE: { bg: '#fef9c3', color: '#a16207', label: 'SOFT' },
  HARD_CHALLENGE: { bg: '#ffedd5', color: '#c2410c', label: 'HARD' },
  BLOCK:          { bg: '#fee2e2', color: '#b91c1c', label: 'BLOCK' },
};

export const CrustStatusBadge: React.FC<CrustStatusBadgeProps> = ({
  confidence,
  decision,
}) => {
  if (decision === null || confidence === null) {
    return (
      <div style={badgeWrap}>
        <span style={{ ...dot, background: '#d1d5db' }} />
        <span style={labelStyle}>CRUST: pending…</span>
      </div>
    );
  }

  const style = DECISION_STYLES[decision] ?? { bg: '#f3f4f6', color: '#374151', label: decision };

  return (
    <div style={badgeWrap} title="CRUST verification status (dev only)">
      <span
        style={{
          display:         'inline-flex',
          alignItems:      'center',
          gap:             '5px',
          padding:         '2px 8px',
          borderRadius:    '9999px',
          background:      style.bg,
          color:           style.color,
          fontWeight:      700,
          fontSize:        '11px',
          letterSpacing:   '0.04em',
          fontFamily:      '"Courier New", monospace',
          border:          `1px solid ${style.color}22`,
        }}
      >
        {style.label}
      </span>
      <span style={labelStyle}>
        {confidence.toFixed(2)}
      </span>
    </div>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const badgeWrap: React.CSSProperties = {
  position:      'fixed',
  bottom:        '16px',
  right:         '16px',
  display:       'flex',
  alignItems:    'center',
  gap:           '6px',
  background:    'rgba(255,255,255,0.92)',
  backdropFilter:'blur(6px)',
  border:        '1px solid rgba(0,0,0,0.1)',
  borderRadius:  '8px',
  padding:       '5px 10px',
  boxShadow:     '0 2px 8px rgba(0,0,0,0.1)',
  fontFamily:    '"Courier New", monospace',
  fontSize:      '11px',
  zIndex:        9999,
  userSelect:    'none',
};

const dot: React.CSSProperties = {
  width:         '7px',
  height:        '7px',
  borderRadius:  '50%',
  display:       'inline-block',
};

const labelStyle: React.CSSProperties = {
  fontFamily:   '"Courier New", monospace',
  fontSize:     '11px',
  fontWeight:   600,
  color:        '#374151',
  letterSpacing:'0.02em',
};
