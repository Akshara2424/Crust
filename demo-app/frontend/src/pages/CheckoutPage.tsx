import React, { useState, useEffect } from 'react';
import { CrustStatusBadge } from '../components/CrustStatusBadge';

declare global {
  interface Window {
    CRUST: {
      protect: (context: string) => Promise<string>;
      getStatus: () => { confidence: number | null; decision: string | null };
    };
  }
}

const MOCK_CART = [
  { id: 1, name: 'Margherita Pizza',   price: 12.99, qty: 2 },
  { id: 2, name: 'Truffle Fries',      price:  6.50, qty: 1 },
  { id: 3, name: 'San Pellegrino',     price:  2.99, qty: 3 },
];

type PageState = 'idle' | 'collecting' | 'submitting' | 'success' | 'blocked';

export const CheckoutPage: React.FC = () => {
  const [pageState,  setPageState]  = useState<PageState>('idle');
  const [error,      setError]      = useState<string | null>(null);
  const [orderId,    setOrderId]    = useState<string | null>(null);
  const [crustInfo,  setCrustInfo]  = useState<{ confidence: number | null; decision: string | null }>({
    confidence: null, decision: null,
  });

  useEffect(() => {
    const id = setInterval(() => {
      if (window.CRUST?.getStatus) {
        setCrustInfo(window.CRUST.getStatus());
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  const total = MOCK_CART.reduce((s, i) => s + i.price * i.qty, 0);

  const handleCheckout = async () => {
    setError(null);
    setPageState('collecting');

    let jwt: string;
    try {
      jwt = await window.CRUST.protect('checkout');
    } catch {
      setPageState('blocked');
      setError('Verification failed — could not complete checkout.');
      return;
    }

    setPageState('submitting');

    try {
      const res = await fetch('/api/checkout', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-crust-jwt':  jwt,
        },
        body: JSON.stringify({ items: MOCK_CART }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Checkout failed');
        setPageState('idle');
        return;
      }

      setCrustInfo({ confidence: data.crust.confidence, decision: data.crust.decision });
      setOrderId(data.orderId);
      setPageState('success');
    } catch {
      setError('Network error — please try again.');
      setPageState('idle');
    }
  };

  if (pageState === 'success') {
    return (
      <div style={pageWrap}>
        <div style={card}>
          <div style={{ fontSize: 40, textAlign: 'center' }}>✅</div>
          <h2 style={heading}>Order placed!</h2>
          <p style={{ ...subtext, textAlign: 'center' }}>Order ID: <strong>{orderId}</strong></p>
          <button style={btnPrimary} onClick={() => setPageState('idle')}>
            Back to cart
          </button>
        </div>
        <CrustStatusBadge confidence={crustInfo.confidence} decision={crustInfo.decision} />
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={card}>
        <h1 style={heading}>Checkout</h1>
        <p style={subtext}>Protected by CRUST passive verification</p>

        {/* Cart items */}
        <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MOCK_CART.map(item => (
            <div key={item.id} style={cartRow}>
              <span style={cartName}>{item.name} ×{item.qty}</span>
              <span style={cartPrice}>${(item.price * item.qty).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ ...cartRow, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10 }}>
            <strong style={{ fontSize: 14 }}>Total</strong>
            <strong style={{ fontSize: 14 }}>${total.toFixed(2)}</strong>
          </div>
        </div>

        {error && (
          <div style={errorBox} role="alert">{error}</div>
        )}

        <button
          style={{ ...btnPrimary, opacity: pageState === 'idle' || pageState === 'blocked' ? 1 : 0.7 }}
          onClick={handleCheckout}
          disabled={pageState !== 'idle' && pageState !== 'blocked'}
        >
          {pageState === 'collecting' && '🔍 Verifying…'}
          {pageState === 'submitting' && '⏳ Placing order…'}
          {(pageState === 'idle' || pageState === 'blocked') && `Pay $${total.toFixed(2)}`}
        </button>

        <p style={{ ...subtext, marginTop: 14, textAlign: 'center' }}>
          <a href="/" style={{ color: '#0588f0' }}>← Back to login</a>
        </p>
      </div>

      <CrustStatusBadge confidence={crustInfo.confidence} decision={crustInfo.decision} />
    </div>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'var(--surface-base, #f5f5f5)', padding: '24px',
};
const card: React.CSSProperties = {
  width: '100%', maxWidth: '400px', background: 'var(--surface-primary, #fff)',
  borderRadius: '14px', padding: '32px 28px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)',
};
const heading: React.CSSProperties = {
  fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em',
  color: 'var(--text-primary, #080808)', margin: '0 0 4px',
};
const subtext: React.CSSProperties = {
  fontSize: '13px', color: 'var(--text-tertiary, #808080)', margin: 0,
};
const cartRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const cartName: React.CSSProperties = {
  fontSize: '13px', color: 'var(--text-secondary, #2e2e2e)',
};
const cartPrice: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #080808)',
  fontFamily: '"Courier New", monospace',
};
const btnPrimary: React.CSSProperties = {
  width: '100%', height: '42px', background: 'var(--button-primary-bg, #080808)',
  color: 'var(--button-primary-fg, #fff)', border: 'none', borderRadius: '8px',
  fontSize: '14px', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  marginTop: '8px', transition: 'all 100ms ease',
};
const errorBox: React.CSSProperties = {
  padding: '10px 12px', background: 'var(--state-error-bg, #fef2f2)',
  color: 'var(--state-error-fg, #b91c1c)', border: '1px solid #ef4444',
  borderRadius: '8px', fontSize: '13px', marginBottom: '10px',
};
