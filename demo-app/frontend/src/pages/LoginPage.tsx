import React, { useState, useEffect } from 'react';
import { CrustStatusBadge } from '../components/CrustStatusBadge';

declare global {
  interface Window {
    CRUST: {
      protect:   (context: string) => Promise<string>;
      getStatus: () => { confidence: number | null; decision: string | null };
      config:    { apiBase: string; debug: boolean };
    };
  }
}

type PageState = 'idle' | 'collecting' | 'submitting' | 'success';

export const LoginPage: React.FC = () => {
  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [pageState,  setPageState]  = useState<PageState>('idle');
  const [error,      setError]      = useState<string | null>(null);
  const [crustInfo,  setCrustInfo]  = useState<{ confidence: number | null; decision: string | null }>({
    confidence: null, decision: null,
  });
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);

  // Poll CRUST status for the badge
  useEffect(() => {
    const id = setInterval(() => {
      if (window.CRUST?.getStatus) setCrustInfo(window.CRUST.getStatus());
    }, 500);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // ── Step 1: CRUST verification ──────────────────────────────────────────
    setPageState('collecting');

    let jwt: string;
    try {
      jwt = await window.CRUST.protect('login');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Verification failed: ${message}`);
      setPageState('idle');
      return;
    }

    // ── Step 2: POST to guarded endpoint ────────────────────────────────────
    setPageState('submitting');

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-crust-jwt': jwt },
        body:    JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? data.reason ?? `Server error ${res.status}`);
        setPageState('idle');
        return;
      }

      setCrustInfo({ confidence: data.crust?.confidence ?? null, decision: data.crust?.decision ?? null });
      setWelcomeMsg(data.message ?? 'Logged in!');
      setPageState('success');
    } catch (err) {
      setError('Network error — please try again.');
      setPageState('idle');
    }
  };

  if (pageState === 'success') {
    return (
      <div style={pageWrap}>
        <div style={card}>
          <div style={{ fontSize: 40, textAlign: 'center' }}>🎉</div>
          <h2 style={heading}>Login successful</h2>
          <p style={subtext}>{welcomeMsg}</p>
          <button style={btnPrimary} onClick={() => setPageState('idle')}>Back</button>
        </div>
        <CrustStatusBadge confidence={crustInfo.confidence} decision={crustInfo.decision} />
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 32 }}>🔐</span>
          <h1 style={heading}>Sign in</h1>
          <p style={subtext}>Protected by CRUST passive verification</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={fieldGroup}>
            <label style={labelStyle} htmlFor="username">Username</label>
            <input id="username" style={inputStyle} type="text" value={username}
              onChange={e => setUsername(e.target.value)} placeholder="Enter username"
              autoComplete="username" required
              disabled={pageState !== 'idle'} />
          </div>

          <div style={fieldGroup}>
            <label style={labelStyle} htmlFor="password">Password</label>
            <input id="password" style={inputStyle} type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Enter password"
              autoComplete="current-password" required
              disabled={pageState !== 'idle'} />
          </div>

          {error && (
            <div style={errorBox} role="alert">{error}</div>
          )}

          <button
            style={{ ...btnPrimary, opacity: pageState === 'idle' ? 1 : 0.7 }}
            type="submit"
            disabled={pageState !== 'idle'}
          >
            {pageState === 'collecting' && '🔍 Verifying…'}
            {pageState === 'submitting' && '⏳ Signing in…'}
            {pageState === 'idle'       && 'Sign in'}
          </button>
        </form>

        <p style={{ ...subtext, marginTop: 16, textAlign: 'center' }}>
          <a href="/checkout" style={{ color: '#0588f0' }}>Go to Checkout demo →</a>
        </p>
      </div>
      <CrustStatusBadge confidence={crustInfo.confidence} decision={crustInfo.decision} />
    </div>
  );
};

const pageWrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-base, #f5f5f5)', padding: '24px' };
const card: React.CSSProperties = { width: '100%', maxWidth: '400px', background: 'var(--surface-primary, #fff)', borderRadius: '14px', padding: '32px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)' };
const heading: React.CSSProperties = { fontFamily: 'inherit', fontSize: '22px', fontWeight: 700, margin: '8px 0 4px', letterSpacing: '-0.02em', color: 'var(--text-primary, #080808)' };
const subtext: React.CSSProperties = { fontSize: '13px', color: 'var(--text-tertiary, #808080)', margin: 0 };
const fieldGroup: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary, #808080)' };
const inputStyle: React.CSSProperties = { height: '38px', padding: '0 12px', fontSize: '14px', fontFamily: 'inherit', border: '1px solid var(--border-default, rgba(0,0,0,0.12))', borderRadius: '8px', background: 'var(--surface-primary, #fff)', color: 'var(--text-primary, #080808)', outline: 'none', transition: 'border-color 100ms ease' };
const btnPrimary: React.CSSProperties = { height: '40px', background: 'var(--button-primary-bg, #080808)', color: 'var(--button-primary-fg, #fff)', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', marginTop: '4px', transition: 'all 100ms ease' };
const errorBox: React.CSSProperties = { padding: '10px 12px', background: 'var(--state-error-bg, #fef2f2)', color: 'var(--state-error-fg, #b91c1c)', border: '1px solid var(--state-error-border, #ef4444)', borderRadius: '8px', fontSize: '13px' }; 