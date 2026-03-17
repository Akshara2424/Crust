/**
 * CRUST SDK — Public entry point (index.ts)
 *
 * Bootstraps the Web Worker, registers passive event listeners on the main
 * thread, and exposes `window.CRUST.protect(actionName)`.
 *
 * Zero dependencies. All event data is forwarded to the worker; no raw
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
import { DecisionEnum, DEFAULT_CONFIG } from './types.js';
import { runToppingsChallenge, GAME_SIGNAL_KEYS } from './toppings-stub.js';

// ── Worker URL ────────────────────────────────────────────────────────────────
// WORKER_URL is injected by esbuild --define at build time.
// The worker is bundled separately as dist/crust.worker.js so that
// `new Worker(url)` works in an IIFE context (import.meta.url is unavailable).
declare const WORKER_URL: string;
const RESOLVED_WORKER_URL = (typeof WORKER_URL !== 'undefined')
  ? WORKER_URL
  : '/dist/crust.worker.js';

// ── JWT helpers ───────────────────────────────────────────────────────────────

function decodeJwtPayload(jwt: string): JWTPayload {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const b64 = (parts[1] as string).replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(b64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
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

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error = new Error('CRUST_SERVICE_UNAVAILABLE');
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt] as number));
      }
    }
  }
  throw lastError;
}

// ── SDK class ─────────────────────────────────────────────────────────────────

class CrustSDK {
  readonly config: CrustConfig;
  private worker: Worker | null = null;

  private readonly pendingExtract = new Map<string, {
    resolve: (v: FeatureVector) => void;
    reject:  (e: Error) => void;
  }>();

  private cachedJwt: string | null = null;
  private reqSeq = 0;

  constructor(config: Partial<CrustConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initWorker();
    this.registerDomListeners();
  }

  private initWorker(): void {
    try {
      // Plain string URL — works in IIFE bundles where import.meta.url is unavailable
      this.worker = new Worker(RESOLVED_WORKER_URL);
      this.worker.addEventListener('message', this.onWorkerMessage.bind(this));
      this.worker.addEventListener('error', (e: ErrorEvent) => {
        console.error('[CRUST] Worker error:', e.message);
      });
      this.postToWorker({ type: 'INIT', payload: this.config });
      if (this.config.debug) console.log('[CRUST] Worker spawned from', RESOLVED_WORKER_URL);
    } catch (err) {
      // Worker spawn failed (e.g. file:// protocol) — fall back gracefully
      console.warn('[CRUST] Could not spawn Web Worker:', err);
      this.worker = null;
    }
  }

  // ── DOM → Worker event forwarding ─────────────────────────────────────────

  private registerDomListeners(): void {
    const forwardPointer = (e: PointerEvent, isClick: boolean): void => {
      const rect = (e.target instanceof Element)
        ? e.target.getBoundingClientRect()
        : { width: 0, height: 0 };
      this.postToWorker({
        type: 'MOUSE_EVENT',
        payload: {
          x: e.clientX, y: e.clientY, t: performance.now(),
          pressure: e.pressure, isClick,
          targetW: rect.width, targetH: rect.height,
        },
      });
    };
    document.addEventListener('pointermove', e => forwardPointer(e, false), { passive: true });
    document.addEventListener('pointerdown', e => forwardPointer(e, true),  { passive: true });

    const forwardKey = (type: 'down' | 'up') => (e: KeyboardEvent): void => {
      this.postToWorker({
        type: 'KEY_EVENT',
        payload: { type, key: e.key, code: e.code, t: performance.now() },
      });
    };
    document.addEventListener('keydown', forwardKey('down'), { passive: true });
    document.addEventListener('keyup',   forwardKey('up'),   { passive: true });

    let lastScrollY = window.scrollY;
    document.addEventListener('wheel', e => {
      this.postToWorker({ type: 'SCROLL_EVENT', payload: { deltaY: e.deltaY, t: performance.now() } });
    }, { passive: true });
    window.addEventListener('scroll', () => {
      const delta = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;
      if (delta !== 0) {
        this.postToWorker({ type: 'SCROLL_EVENT', payload: { deltaY: delta, t: performance.now() } });
      }
    }, { passive: true });

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
    document.addEventListener('focusin', e => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        this.postToWorker({ type: 'SESSION_EVENT', payload: { type: 'formfocus', t: performance.now() } });
      }
    }, { passive: true });
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
        if (this.config.debug) console.log('[CRUST] Environment features ready');
        break;
      case 'FEATURES_READY': {
        const p = this.pendingExtract.get(msg.id);
        if (p) { this.pendingExtract.delete(msg.id); p.resolve(msg.payload); }
        break;
      }
      case 'FEATURES_ERROR': {
        const p = this.pendingExtract.get(msg.id);
        if (p) { this.pendingExtract.delete(msg.id); p.reject(new Error(msg.error)); }
        break;
      }
    }
  }

  // ── Public: protect() ─────────────────────────────────────────────────────

  async protect(actionName: string): Promise<string> {
    if (this.cachedJwt !== null) {
      if (!isJwtExpired(this.cachedJwt)) return this.cachedJwt;
      this.cachedJwt = null;
    }

    const featureVector = await this.extractFeatures();

    const verifyRes = await fetchWithRetry(`${this.config.apiBase}/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-crust-action': actionName },
      body:    JSON.stringify({ feature_vector: featureVector }),
      credentials: 'omit',
    });

    const verifyBody = (await verifyRes.json()) as CrustResponse;
    if (this.config.debug) console.log('[CRUST] /verify →', verifyBody.decision, verifyBody.confidence);
    return this.handleDecision(verifyBody);
  }

  // ── Public: getStatus() ───────────────────────────────────────────────────

  getStatus(): { confidence: number | null; decision: string | null } {
    if (!this.cachedJwt) return { confidence: null, decision: null };
    try {
      const p = decodeJwtPayload(this.cachedJwt);
      return { confidence: p.confidence, decision: p.decision as string };
    } catch {
      return { confidence: null, decision: null };
    }
  }

  // ── Decision routing ───────────────────────────────────────────────────────

  private async handleDecision(resp: CrustResponse): Promise<string> {
    switch (resp.decision) {
      case DecisionEnum.PASS:
        this.cachedJwt = resp.jwt;
        return resp.jwt;

      case DecisionEnum.SOFT_CHALLENGE: {
        const orderRes = await fetchWithRetry(`${this.config.apiBase}/challenge/order`, {
          method: 'POST', headers: { Authorization: `Bearer ${resp.jwt}` },
        });
        const order = await orderRes.json() as {
          order_id: string; base: string; sauce: string; toppings: string[];
        };
        const result = await runToppingsChallenge(order.order_id, resp.jwt);
        const gameSignals: Record<string, number> = {};
        for (let i = 0; i < GAME_SIGNAL_KEYS.length; i++) {
          gameSignals[GAME_SIGNAL_KEYS[i] as string] = result.gameSignals[i] ?? 0;
        }
        const challengeRes = await fetchWithRetry(`${this.config.apiBase}/challenge/result`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jwt: resp.jwt, order_id: result.orderId,
            submitted: result.submitted, game_signals: gameSignals,
          }),
        });
        return this.handleDecision(await challengeRes.json() as CrustResponse);
      }

      case DecisionEnum.HARD_CHALLENGE:
        throw new Error('CRUST_HARD_CHALLENGE');

      case DecisionEnum.BLOCK:
        throw new Error('CRUST_BLOCKED');

      default:
        throw new Error(`CRUST_UNKNOWN_DECISION: ${String(resp.decision)}`);
    }
  }

  // ── Feature extraction ────────────────────────────────────────────────────

  private extractFeatures(): Promise<FeatureVector> {
    // No worker → return a synthetic vector so the flow still works
    if (!this.worker) {
      if (this.config.debug) console.warn('[CRUST] No worker — using synthetic feature vector');
      return Promise.resolve(
        Array.from({ length: 40 }, Math.random) as unknown as FeatureVector
      );
    }
    return new Promise<FeatureVector>((resolve, reject) => {
      const id = `fv-${++this.reqSeq}-${Date.now()}`;
      const timer = setTimeout(() => {
        if (this.pendingExtract.has(id)) {
          this.pendingExtract.delete(id);
          reject(new Error('CRUST_FEATURE_EXTRACTION_TIMEOUT'));
        }
      }, this.config.collectionWindowMs + 8_000);
      this.pendingExtract.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject:  e => { clearTimeout(timer); reject(e);  },
      });
      this.postToWorker({ type: 'EXTRACT_FEATURES', id });
    });
  }

  private postToWorker(msg: WorkerInboundMessage): void {
    this.worker?.postMessage(msg);
  }
}

// ── Global surface ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    CRUST: {
      protect:   (actionName: string) => Promise<string>;
      getStatus: () => { confidence: number | null; decision: string | null };
      config:    Readonly<CrustConfig>;
      init:      (config?: Partial<CrustConfig>) => void;
    };
    CRUSTConfig?: Partial<CrustConfig>;
  }
}

let _instance: CrustSDK | null = null;

export function initCrust(config: Partial<CrustConfig> = {}): void {
  if (_instance !== null) {
    console.warn('[CRUST] Already initialised — ignoring duplicate initCrust() call');
    return;
  }
  _instance = new CrustSDK(config);
  window.CRUST = {
    protect:   actionName => _instance!.protect(actionName),
    getStatus: ()         => _instance!.getStatus(),
    config:    _instance.config,
    init:      ()         => { /* no-op after first init */ },
  };
  if (_instance.config.debug) console.log('[CRUST] SDK ready', _instance.config);
}

// Auto-initialise when loaded via <script> tag
if (typeof window !== 'undefined' && typeof window.CRUST === 'undefined') {
  initCrust(window.CRUSTConfig ?? {});
}