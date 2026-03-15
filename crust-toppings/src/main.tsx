import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToppingsChallenge } from './ToppingsChallenge';

// ── Inline Obvious Design System tokens ───────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --font-sans: "Inter", system-ui, -apple-system, sans-serif;
    --font-mono: "Courier New", Courier, monospace;
    --neutral-100: #ffffff; --neutral-200: #fcfcfc; --neutral-300: #f5f5f5;
    --neutral-400: #ededed; --neutral-500: #e5e5e5; --neutral-600: #d6d6d6;
    --neutral-700: #c2c2c2; --neutral-800: #a8a8a8; --neutral-900: #808080;
    --neutral-1000: #3d3d3d; --neutral-1100: #2e2e2e; --neutral-1200: #080808;
    --darken-100: rgba(0,0,0,0.02); --darken-200: rgba(0,0,0,0.04);
    --darken-300: rgba(0,0,0,0.06); --darken-400: rgba(0,0,0,0.08);
    --darken-500: rgba(0,0,0,0.12); --darken-600: rgba(0,0,0,0.16);
    --darken-800: rgba(0,0,0,0.24); --darken-900: rgba(0,0,0,0.4);
    --darken-1100: rgba(0,0,0,0.64); --darken-1300: rgba(0,0,0,0.8);
    --darken-1400: rgba(0,0,0,0.92);
    --surface-base: var(--neutral-200); --surface-primary: var(--neutral-100);
    --surface-hover: var(--darken-200); --surface-active: var(--darken-300);
    --text-primary: var(--darken-1400); --text-secondary: var(--darken-1100);
    --text-tertiary: var(--darken-900); --text-muted: var(--darken-800);
    --text-inverse: var(--neutral-100);
    --border-subtle: var(--darken-200); --border-default: var(--darken-400);
    --border-strong: var(--darken-600); --border-focus: #29a2ff;
    --button-primary-bg: var(--neutral-1200); --button-primary-fg: var(--neutral-100);
    --button-primary-hover: var(--neutral-1000);
    --state-success-bg: #f0fdf4; --state-success-fg: #15803d; --state-success-border: #22c55e;
    --state-error-bg: #fef2f2; --state-error-fg: #b91c1c; --state-error-border: #ef4444;
    --state-warning-bg: #fff7ed; --state-warning-fg: #c2410c; --state-warning-border: #f97316;
    --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-8:32px;
    --radius-sm:6px;--radius-md:8px;--radius-lg:10px;--radius-xl:14px;
    --row-sm:28px;--row-md:32px;--row-lg:36px;--row-xl:40px;
    --transition-fast:100ms ease;--transition-normal:150ms ease;
    --shadow-lifted: 0px 0px 2px 0px rgba(0,0,0,0.05),0px 0px 1px 0px rgba(0,0,0,0.05),0px 0px 0px 1px rgba(0,0,0,0.08);
    --shadow-lifted-card: 0px 1px 2px 0px rgba(0,0,0,0.05),0px 0px 1px 0px rgba(0,0,0,0.05),0px 0px 0px 1px rgba(0,0,0,0.08);
  }
  html.dark {
    --neutral-100:#1a1a1a;--neutral-200:#1f1f1f;--neutral-300:#262626;
    --neutral-400:#2e2e2e;--neutral-500:#383838;--neutral-600:#4a4a4a;
    --neutral-1000:#e0e0e0;--neutral-1100:#ebebeb;--neutral-1200:#f5f5f5;
    --darken-100:rgba(255,255,255,0.02);--darken-200:rgba(255,255,255,0.04);
    --darken-300:rgba(255,255,255,0.06);--darken-400:rgba(255,255,255,0.08);
    --darken-500:rgba(255,255,255,0.12);--darken-600:rgba(255,255,255,0.16);
    --darken-800:rgba(255,255,255,0.24);--darken-900:rgba(255,255,255,0.4);
    --darken-1100:rgba(255,255,255,0.64);--darken-1300:rgba(255,255,255,0.8);
    --darken-1400:rgba(255,255,255,0.92);
    --button-primary-bg:var(--neutral-500);--button-primary-fg:var(--neutral-1200);
    --button-primary-hover:var(--neutral-600);
    --state-error-bg:#450a0a;--state-error-fg:#fecaca;--state-error-border:#ef4444;
  }
  html { font-family:var(--font-sans);font-size:16px;-webkit-font-smoothing:antialiased; }
  body { background-color:var(--surface-base);color:var(--text-primary);min-height:100vh; }
`;
document.head.appendChild(style);

// ── Randomised mock order ─────────────────────────────────────────────────────
const ALL_BASES    = ['thin', 'thick', 'gluten-free', 'sourdough'];
const ALL_SAUCES   = ['tomato', 'pesto', 'alfredo', 'bbq'];
const ALL_TOPPINGS = ['mushroom', 'olive', 'pepperoni', 'onion', 'pepper', 'jalapeño', 'corn', 'spinach'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

interface MockOrder {
  order_id: string; base: string; sauce: string;
  toppings: string[]; expires_at: string;
}

function generateOrder(): MockOrder {
  return {
    order_id:   `dev-${Date.now()}`,
    base:       pick(ALL_BASES),
    sauce:      pick(ALL_SAUCES),
    toppings:   pickN(ALL_TOPPINGS, 2 + Math.floor(Math.random() * 3)),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

// Stored here so /challenge/result can validate against it
let currentOrder: MockOrder = generateOrder();

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();

  if (url.includes('/challenge/order')) {
    await new Promise(r => setTimeout(r, 450));
    currentOrder = generateOrder();
    console.log('🍕 New order:', currentOrder);
    return new Response(JSON.stringify(currentOrder), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (url.includes('/challenge/result')) {
    await new Promise(r => setTimeout(r, 600));
    const body      = init?.body ? JSON.parse(init.body as string) : {};
    const submitted = body.submitted ?? {};
    const correct   =
      submitted.base  === currentOrder.base &&
      submitted.sauce === currentOrder.sauce &&
      currentOrder.toppings.every((t: string) => (submitted.toppings ?? []).includes(t));
    console.log('📋 Submit check:', { submitted, expected: currentOrder, correct });
    if (!correct) {
      return new Response(JSON.stringify({ error: 'ORDER_MISMATCH' }), {
        status: 422, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      jwt: 'eyJhbGciOiJSUzI1NiJ9.eyJkZWNpc2lvbiI6ICJQQVNTIH0.mock',
      confidence: 0.93, decision: 'PASS',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return originalFetch(input, init);
};

// ── Dark mode init ────────────────────────────────────────────────────────────
const stored    = localStorage.getItem('obvious-theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
if (stored === 'dark' || (!stored && prefersDark)) {
  document.documentElement.classList.add('dark');
}

// ── Mount ─────────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',
      justifyContent:'center',minHeight:'100vh',gap:'12px',padding:'24px' }}>

      <button
        onClick={() => {
          const isDark = document.documentElement.classList.toggle('dark');
          localStorage.setItem('obvious-theme', isDark ? 'dark' : 'light');
        }}
        style={{ position:'fixed',top:'16px',right:'16px',padding:'6px 14px',
          borderRadius:'8px',border:'1px solid rgba(0,0,0,0.12)',
          background:'var(--surface-primary)',color:'var(--text-secondary)',
          cursor:'pointer',fontSize:'12px',fontFamily:'inherit' }}
      >
        Toggle dark
      </button>

      <p style={{ fontSize:'11px',color:'var(--text-tertiary)',fontFamily:'monospace' }}>
        🍕 CRUST dev harness — order is randomised each load · check console for details
      </p>

      <ToppingsChallenge
        softChallengeJwt="eyJhbGciOiJSUzI1NiJ9.soft.mock"
        originalFeatureVector={Array.from({ length: 40 }, Math.random)}
        onSuccess={jwt  => { console.log('✅ PASS — JWT:', jwt); alert('✅ Verified!'); }}
        onFailure={reason => { console.log('❌ Failed:', reason); alert(`❌ ${reason}`); }}
      />
    </div>
  </React.StrictMode>,
);