# CRUST SDK

**C**aptcha **R**eplacement **U**sing **S**ignal-based **T**racking  
ML-based passive human verification — zero interruption for most users.

---

## How it works

```
Browser
  └─► CRUST SDK (Web Worker)
        ├─ Collects 40 behavioural features passively over 5–30 s
        ├─ Extracts feature vector client-side; raw events discarded
        └─ POST /verify → signed RS256 JWT (confidence + decision)
              ├─ PASS           → JWT returned immediately
              ├─ SOFT_CHALLENGE → pizza assembly game (Toppings)
              ├─ HARD_CHALLENGE → escalated challenge (Phase 2)
              └─ BLOCK          → rejects with Error("CRUST_BLOCKED")
```

The JWT is then attached to your protected API requests.  Your gateway
validates the JWT locally — no round-trip to the verification service.

---

## Quick start

### Option A — Script tag (no build step)

```html
<!-- Optional: pre-configure before the script loads -->
<script>
  window.CRUSTConfig = {
    apiBase:           '/api/crust',  // default
    collectionWindowMs: 10000,        // default
    debug:             false          // set true for verbose logs
  };
</script>

<script src="/assets/crust.iife.js"></script>

<script>
  document.getElementById('login-btn').addEventListener('click', async () => {
    const jwt = await window.CRUST.protect('login');
    await fetch('/api/login', {
      method:  'POST',
      headers: { 'x-crust-jwt': jwt },
      body:    JSON.stringify({ username, password }),
    });
  });
</script>
```

### Option B — npm / bundler

```bash
npm install crust-sdk
```

```ts
import { initCrust } from 'crust-sdk';

// Call once at app startup (e.g. in main.ts / index.tsx)
initCrust({
  apiBase:            '/api/crust',
  collectionWindowMs: 10_000,
  debug:              import.meta.env.DEV,
});
```

Then, anywhere you need to gate an action:

```ts
// Returns a PASS JWT string, or throws on BLOCK / service failure
const jwt = await window.CRUST.protect('checkout');

await fetch('/api/checkout', {
  method:  'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-crust-jwt':  jwt,
  },
  body: JSON.stringify(payload),
});
```

---

## API reference

### `window.CRUST.protect(actionName: string): Promise<string>`

Collects or retrieves the 40-float feature vector, posts it to `/verify`,
handles challenges, and resolves with a signed JWT string.

| Scenario | Behaviour |
|---|---|
| First call | Triggers feature extraction + `/verify` POST |
| Repeat call within JWT TTL | Returns cached JWT (in-memory only) |
| JWT expired | Clears cache, re-collects, re-verifies |
| `SOFT_CHALLENGE` | Runs Toppings stub (Phase 1) / full game (Phase 3) |
| `BLOCK` | Throws `Error("CRUST_BLOCKED")` |
| Service unreachable | Retries 3× (200 / 400 / 800 ms backoff), then throws `Error("CRUST_SERVICE_UNAVAILABLE")` |

### `initCrust(config?: Partial<CrustConfig>): void`

Initialises the SDK.  Safe to call from a `<script>` module or your app
entry point.  Subsequent calls are no-ops.

### `CrustConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `apiBase` | `string` | `"/api/crust"` | Base URL of the CRUST verification service |
| `collectionWindowMs` | `number` | `10000` | Observation window before feature extraction (ms) |
| `debug` | `boolean` | `false` | Verbose logging to `console.log` |

---

## Feature vector (40 floats)

All values are normalised to **[0, 1]**.

| Dim | Name | Description |
|-----|------|-------------|
| 1 | `env_webdriver_flag` | `navigator.webdriver` detected |
| 2 | `env_canvas_hash` | FNV-1a hash of 64×64 OffscreenCanvas render |
| 3 | `env_plugin_count` | Plugin count / 20 |
| 4 | `env_language_mismatch` | Language tag vs timezone continent mismatch |
| 5 | `env_screen_depth` | `screen.colorDepth` / 32 |
| 6 | `env_timezone_offset` | UTC offset mapped to [0, 1] |
| 7 | `env_touch_support` | `navigator.maxTouchPoints > 0` |
| 8 | `env_devtools_open` | Timing-based debugger heuristic |
| 9 | `mouse_trajectory_linearity` | Straight-line / path-length ratio |
| 10 | `mouse_avg_velocity` | Mean pointer speed (px/ms), /3 |
| 11 | `mouse_velocity_variance` | Variance of pointer speed |
| 12 | `mouse_curvature_mean` | Mean discrete curvature |
| 13 | `mouse_pause_count` | Low-velocity pauses ≥ 300 ms, /20 |
| 14 | `mouse_overshoot_count` | Post-click direction reversals, /10 |
| 15 | `mouse_click_pressure_variance` | Variance of `PointerEvent.pressure` |
| 16 | `mouse_event_count` | Event count / 2000 |
| 17 | `mouse_idle_ratio` | Idle time (gaps > 500 ms) / session |
| 18 | `mouse_fitts_adherence` | Pearson r(Fitts predicted, observed MT) → [0,1] |
| 19 | `ks_iki_mean` | Inter-key interval mean / 500 ms |
| 20 | `ks_iki_variance` | IKI variance / 250 000 |
| 21 | `ks_hold_time_mean` | Key hold duration mean / 300 ms |
| 22 | `ks_hold_time_variance` | Hold duration variance / 90 000 |
| 23 | `ks_bigram_consistency` | 1 − mean CoV of repeated bigram IKIs |
| 24 | `ks_event_count` | Keydown events / 500 |
| 25 | `ks_backspace_ratio` | Backspaces / total keydowns |
| 26 | `ks_burst_ratio` | Burst transitions (IKI < 150 ms) / total |
| 27 | `sess_first_interaction_delay` | Time to first event / 30 s |
| 28 | `sess_focus_switches` | Focus/blur transitions / 20 |
| 29 | `sess_tab_hidden_duration` | Hidden time / session duration |
| 30 | `sess_scroll_velocity_mean` | Scroll speed mean / 5 px/ms |
| 31 | `sess_scroll_direction_reversals` | Reversals / 30 |
| 32 | `sess_form_focus_count` | Input/select focuses / 20 |
| 33 | `sess_copy_paste_detected` | 1 if paste or copy fired |
| 34 | `sess_total_duration` | Session length / 120 s |
| 35 | `net_request_jitter` | Std-dev of 3 probe RTTs / 200 ms |
| 36 | `net_ja3_fingerprint` | First OPTIONS RTT / 500 ms (TLS proxy) |
| 37 | `net_connection_type` | Ordinal from `NetworkInformation.type` |
| 38 | `net_rtt_estimate` | `NetworkInformation.rtt` / 2000 ms |
| 39 | `net_downlink_estimate` | `NetworkInformation.downlink` / 100 Mbit/s |
| 40 | `net_preflight_timing` | Mean OPTIONS RTT / 1000 ms |

---

## Gateway integration

Your backend middleware must validate the JWT on every protected request:

```ts
// Express example
import jwt from 'jsonwebtoken';

app.use('/api/protected', (req, res, next) => {
  const token = req.headers['x-crust-jwt'];
  if (!token) return res.status(403).json({ error: 'Missing CRUST token' });

  try {
    const payload = jwt.verify(token, PUBLIC_KEY_PEM, {
      algorithms: ['RS256'],
      issuer:     'crust-verification-service',
      subject:    'crust-session',
    });
    if (payload.decision === 'BLOCK') return res.sendStatus(403);
    next();
  } catch {
    return res.sendStatus(403);
  }
});
```

---

## Security guarantees

- **No raw events transmitted.** Mouse coordinates, keystroke timestamps, and scroll
  positions are processed inside the Web Worker and discarded after feature extraction.
  Only the 40-float vector reaches the network.
- **No persistent storage.** The JWT cache is in-memory only — never `localStorage`,
  `sessionStorage`, or cookies.
- **Stateless service.** All session state lives in the signed JWT.
- **Worker isolation.** Signal collection runs on a separate thread; it never blocks
  the main thread or the page's JavaScript execution context.

---

## Build

```bash
npm install
npm run build      # → dist/index.js  +  dist/crust.iife.js
npm run typecheck  # strict tsc type check (no emit)
npm run dev        # watch mode
```

---

## Phase roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ This PR | SDK + stub Toppings challenge |
| 2 | Planned | Verification Service (FastAPI + XGBoost) |
| 3 | Planned | Full React Toppings UI component |
| 4 | Planned | Express / NGINX gateway middleware |
| 5 | Planned | Grafana dashboard + Prometheus metrics |
