/**
 * CRUST SDK — Public entry point (index.ts)
 *
 * Bootstraps the Web Worker, registers passive event listeners on the main
 * thread, and exposes `window.CRUST.protect(actionName)`.
 *
 * Zero dependencies.  All event data is forwarded to the worker; no raw
 * coordinates or timestamps are stored on the main thread.
 */

import type {
  CrustConfig,
  CrustResponse,
  FeatureVector,
  JWTPayload,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './types.js';
import { DecisionEnum, DEFAULT_CONFIG }       from './types.js';
import { runToppingsChallenge, GAME_SIGNAL_KEYS } from './toppings-stub.js';

// ── JWT helpers ───────────────────────────────────────────────────────────────

function decodeJwtPayload(jwt: string): JWTPayload {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  // Base64url → Base64 → JSON
  const b64 = (parts[1] as string)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(b64)
      .split('')
      .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  );
  return JSON.parse(json) as JWTPayload;
}

function isJwtExpired(jwt: string): boolean {
  try {
    const { exp } = decodeJwtPayload(jwt);
    return Math.floor(Date.now() / 1_000) >= exp;
  } catch {
    return true;
  }
}

// ── Fetch with exponential backoff ────────────────────────────────────────────

const RETRY_DELAYS_MS = [200, 400, 800] as const;

async function fetchWithRetry(
  url:     string,
  init:    RequestInit,
): Promise<Response> {
  let lastError: Error = new Error('CRUST_SERVICE_UNAVAILABLE');

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const response = await fetch(url, init);
      // 5xx → treat as transient, retry
      if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt] as number);
      }
    }
  }
  throw new Error('CRUST_SERVICE_UNAVAILABLE');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── SDK class ─────────────────────────────────────────────────────────────────

class CrustSDK {
  readonly config: CrustConfig;
  private readonly worker: Worker;

  /** Pending feature-extraction promises, keyed by correlation id */
  private readonly pendingExtract = new Map<string, {
    resolve: (v: FeatureVector) => void;
    reject:  (e: Error) => void;
  }>();

  private cachedJwt:   string | null = null;
  private reqSeq                     = 0;

  constructor(config: Partial<CrustConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Spawn the Web Worker — bundlers inline the URL via `new URL(…, import.meta.url)`
    this.worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.addEventListener('message', this.onWorkerMessage.bind(this));
    this.worker.addEventListener('error', (e: ErrorEvent) => {
      console.error('[CRUST] Worker error:', e.message);
    });

    // INIT triggers env feature collection within 800 ms
    this.postToWorker({ type: 'INIT', payload: this.config });

    this.registerDomListeners();
  }

  // ── DOM → Worker event forwarding ─────────────────────────────────────────

  private registerDomListeners(): void {
    // ── Pointer (mouse / touch / stylus) ──────────────────────────────────
    const forwardPointer = (e: PointerEvent, isClick: boolean): void => {
      const rect = (e.target instanceof Element)
        ? e.target.getBoundingClientRect()
        : { width: 0, height: 0 };
      this.postToWorker({
        type: 'MOUSE_EVENT',
        payload: {
          x:        e.clientX,
          y:        e.clientY,
          t:        performance.now(),
          pressure: e.pressure,
          isClick,
          targetW:  rect.width,
          targetH:  rect.height,
        },
      });
    };
    document.addEventListener('pointermove', e => forwardPointer(e, false), { passive: true });
    document.addEventListener('pointerdown', e => forwardPointer(e, true),  { passive: true });

    // ── Keyboard ──────────────────────────────────────────────────────────
    const forwardKey = (type: 'down' | 'up') => (e: KeyboardEvent): void => {
      this.postToWorker({
        type: 'KEY_EVENT',
        payload: { type, key: e.key, code: e.code, t: performance.now() },
      });
    };
    document.addEventListener('keydown', forwardKey('down'), { passive: true });
    document.addEventListener('keyup',   forwardKey('up'),   { passive: true });

    // ── Wheel / scroll ────────────────────────────────────────────────────
    // Use `wheel` for signed deltaY; fall back to tracking scrollY delta.
    let lastScrollY = window.scrollY;
    document.addEventListener('wheel', e => {
      this.postToWorker({
        type: 'SCROLL_EVENT',
        payload: { deltaY: e.deltaY, t: performance.now() },
      });
    }, { passive: true });
    // Also listen to scroll for pages that scroll programmatically
    window.addEventListener('scroll', () => {
      const delta = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;
      if (delta !== 0) {
        this.postToWorker({
          type: 'SCROLL_EVENT',
          payload: { deltaY: delta, t: performance.now() },
        });
      }
    }, { passive: true });

    // ── Page lifecycle ────────────────────────────────────────────────────
    window.addEventListener('focus', () => {
      this.postToWorker({ type: 'SESSION_EVENT', payload: { type: 'focus', t: performance.now() } });
    });
    window.addEventListener('blur', () => {
      this.postToWorker({ type: 'SESSION_EVENT', payload: { type: 'blur', t: performance.now() } });
    });
    document.addEventListener('visibilitychange', () => {
      this.postToWorker({
        type: 'SESSION_EVENT',
        payload: { type: 'visibility', t: performance.now(), hidden: document.hidden },
      });
    });

    // ── Form interactions ─────────────────────────────────────────────────
    document.addEventListener('focusin', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        this.postToWorker({ type: 'SESSION_EVENT', payload: { type: 'formfocus', t: performance.now() } });
      }
    }, { passive: true });

    // ── Clipboard ─────────────────────────────────────────────────────────
    document.addEventListener('copy',  () => {
      this.postToWorker({ type: 'SESSION_EVENT', payload: { type: 'copy',  t: performance.now() } });
    }, { passive: true });
    document.addEventListener('paste', () => {
      this.postToWorker({ type: 'SESSION_EVENT', payload: { type: 'paste', t: performance.now() } });
    }, { passive: true });
  }

  // ── Worker message handling ────────────────────────────────────────────────

  private onWorkerMessage(event: MessageEvent<WorkerOutboundMessage>): void {
    const msg = event.data;
    if (this.config.debug) console.log('[CRUST]', msg.type, msg);

    switch (msg.type) {
      case 'ENV_READY':
        // Environment features collected within 800 ms spec requirement
        if (this.config.debug) console.log('[CRUST] Environment features ready');
        break;

      case 'FEATURES_READY': {
        const pending = this.pendingExtract.get(msg.id);
        if (pending) {
          this.pendingExtract.delete(msg.id);
          pending.resolve(msg.payload);
        }
        break;
      }

      case 'FEATURES_ERROR': {
        const pending = this.pendingExtract.get(msg.id);
        if (pending) {
          this.pendingExtract.delete(msg.id);
          pending.reject(new Error(msg.error));
        }
        break;
      }
    }
  }

  // ── Public: protect() ─────────────────────────────────────────────────────

  async protect(actionName: string): Promise<string> {
    // Return in-memory cached JWT if still within its TTL
    if (this.cachedJwt !== null) {
      if (!isJwtExpired(this.cachedJwt)) {
        if (this.config.debug) console.log('[CRUST] Returning cached JWT');
        return this.cachedJwt;
      }
      // Cache expired — clear and re-collect
      this.cachedJwt = null;
      if (this.config.debug) console.log('[CRUST] Cached JWT expired; re-collecting features');
    }

    const featureVector = await this.extractFeatures();

    const verifyRes = await fetchWithRetry(
      `${this.config.apiBase}/verify`,
      {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'x-crust-action': actionName,
        },
        body:        JSON.stringify({ feature_vector: featureVector }),
        credentials: 'omit',
      },
    );

    const verifyBody = (await verifyRes.json()) as CrustResponse;
    if (this.config.debug) console.log('[CRUST] /verify →', verifyBody.decision, verifyBody.confidence);

    return this.handleDecision(verifyBody);
  }

  // ── Decision routing ───────────────────────────────────────────────────────

  private async handleDecision(resp: CrustResponse): Promise<string> {
    switch (resp.decision) {

      case DecisionEnum.PASS:
        this.cachedJwt = resp.jwt;
        return resp.jwt;

      case DecisionEnum.SOFT_CHALLENGE: {
        // Fetch a pizza order from the server
        const orderRes = await fetchWithRetry(
          `${this.config.apiBase}/challenge/order`,
          {
            method:  'POST',
            headers: { Authorization: `Bearer ${resp.jwt}` },
          },
        );
        const order = (await orderRes.json()) as {
          order_id: string;
          base:     string;
          sauce:    string;
          toppings: string[];
        };

        // Phase 1: toppings stub — Phase 3 will swap in the real UI component
        const toppingsResult = await runToppingsChallenge(order.order_id, resp.jwt);

        // Build named game_signals object from the ordered tuple
        const gameSignals: Record<string, number> = {};
        for (let i = 0; i < GAME_SIGNAL_KEYS.length; i++) {
          const key = GAME_SIGNAL_KEYS[i] as string;
          gameSignals[key] = toppingsResult.gameSignals[i] ?? 0;
        }

        const challengeRes = await fetchWithRetry(
          `${this.config.apiBase}/challenge/result`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jwt:       resp.jwt,
              order_id:  toppingsResult.orderId,
              submitted: toppingsResult.submitted,
              game_signals: gameSignals,
            }),
          },
        );
        const challengeBody = (await challengeRes.json()) as CrustResponse;
        if (this.config.debug) {
          console.log('[CRUST] /challenge/result →', challengeBody.decision, challengeBody.confidence);
        }
        // Recurse once — prevents infinite SOFT_CHALLENGE loops
        return this.handleDecision(challengeBody);
      }

      case DecisionEnum.HARD_CHALLENGE:
        // Phase 1: surface to the caller; Phase 2 will implement the full flow
        throw new Error('CRUST_HARD_CHALLENGE');

      case DecisionEnum.BLOCK:
        throw new Error('CRUST_BLOCKED');

      default:
        throw new Error(`CRUST_UNKNOWN_DECISION: ${String(resp.decision)}`);
    }
  }

  // ── Feature extraction promise ─────────────────────────────────────────────

  private extractFeatures(): Promise<FeatureVector> {
    return new Promise<FeatureVector>((resolve, reject) => {
      const id = `fv-${++this.reqSeq}-${Date.now()}`;

      // Timeout: collection window + generous network buffer
      const timeoutMs = this.config.collectionWindowMs + 8_000;
      const timer = setTimeout(() => {
        if (this.pendingExtract.has(id)) {
          this.pendingExtract.delete(id);
          reject(new Error('CRUST_FEATURE_EXTRACTION_TIMEOUT'));
        }
      }, timeoutMs);

      this.pendingExtract.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e);  },
      });

      this.postToWorker({ type: 'EXTRACT_FEATURES', id });
    });
  }

  // ── Typed worker postMessage ───────────────────────────────────────────────

  private postToWorker(msg: WorkerInboundMessage): void {
    this.worker.postMessage(msg);
  }
}

// ── Global surface ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    /** CRUST public API — populated by initCrust() */
    CRUST: {
      protect: (actionName: string) => Promise<string>;
      config:  Readonly<CrustConfig>;
    };
    /** Optional pre-load configuration object set before crust.js loads */
    CRUSTConfig?: Partial<CrustConfig>;
  }
}

let _instance: CrustSDK | null = null;

/**
 * initCrust
 *
 * Initialise the CRUST SDK with optional configuration overrides and expose
 * `window.CRUST`.  Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param config  Partial config merged over `DEFAULT_CONFIG`
 */
export function initCrust(config: Partial<CrustConfig> = {}): void {
  if (_instance !== null) {
    console.warn('[CRUST] Already initialised — ignoring duplicate initCrust() call');
    return;
  }
  _instance = new CrustSDK(config);
  window.CRUST = {
    protect: (actionName: string) => _instance!.protect(actionName),
    config:  _instance.config,
  };
}

// Auto-initialise when loaded via <script> tag.
// Consumers may pre-configure via `window.CRUSTConfig = { … }` before the tag.
if (typeof window !== 'undefined' && typeof window.CRUST === 'undefined') {
  initCrust(window.CRUSTConfig ?? {});
}
