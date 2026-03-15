/**
 * CRUST SDK — Web Worker (worker.ts)
 *
 * Runs entirely off the main thread.  Responsibilities:
 *   1. Receive INIT message → compute environment features (≤ 800 ms)
 *   2. Buffer MOUSE_EVENT / KEY_EVENT / SCROLL_EVENT / SESSION_EVENT messages
 *   3. On EXTRACT_FEATURES → assemble full 40-float vector + fire network probes
 *   4. Reply FEATURES_READY | FEATURES_ERROR with matching correlation id
 *
 * Raw event buffers are cleared inside each collector's extract() method —
 * coordinates and keystroke timestamps never persist beyond that call.
 */

/// <reference lib="webworker" />

import { collectEnvironmentFeatures }  from './features/environment.js';
import { MouseCollector }              from './features/mouse.js';
import { KeystrokeCollector }          from './features/keystroke.js';
import { SessionCollector }            from './features/session.js';
import { collectNetworkFeatures }      from './features/network.js';
import type {
  CrustConfig,
  FeatureVector,
  WorkerInboundMessage,
  WorkerOutboundMessage,
  RawMouseEvent,
  RawKeyEvent,
  RawScrollEvent,
  RawSessionEvent,
} from './types.js';

// ── State ─────────────────────────────────────────────────────────────────────

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let config:            CrustConfig | null = null;
let sessionStart:      number             = performance.now();
let mouseCollector:    MouseCollector | null      = null;
let keystrokeCollector: KeystrokeCollector | null = null;
let sessionCollector:  SessionCollector | null    = null;

// ── Logging ───────────────────────────────────────────────────────────────────

function log(...args: unknown[]): void {
  if (config?.debug) console.log('[CRUST Worker]', ...args);
}

// ── Message handler ───────────────────────────────────────────────────────────

ctx.addEventListener('message', (event: MessageEvent<WorkerInboundMessage>) => {
  void handleMessage(event.data);
});

async function handleMessage(msg: WorkerInboundMessage): Promise<void> {
  switch (msg.type) {

    // ── INIT ─────────────────────────────────────────────────────────────────
    case 'INIT': {
      config        = msg.payload;
      sessionStart  = performance.now();
      mouseCollector     = new MouseCollector(sessionStart);
      keystrokeCollector = new KeystrokeCollector();
      sessionCollector   = new SessionCollector(sessionStart);

      // Environment features are cheap and synchronous — collect within 800 ms
      const envFeatures = collectEnvironmentFeatures();
      log('environment features collected', envFeatures);

      ctx.postMessage({ type: 'ENV_READY' } satisfies WorkerOutboundMessage);
      break;
    }

    // ── Buffered signal forwarding ────────────────────────────────────────────
    case 'MOUSE_EVENT': {
      mouseCollector?.push(msg.payload as RawMouseEvent);
      break;
    }

    case 'KEY_EVENT': {
      keystrokeCollector?.push(msg.payload as RawKeyEvent);
      break;
    }

    case 'SCROLL_EVENT': {
      sessionCollector?.pushScroll(msg.payload as RawScrollEvent);
      break;
    }

    case 'SESSION_EVENT': {
      sessionCollector?.pushSession(msg.payload as RawSessionEvent);
      break;
    }

    // ── Feature extraction ────────────────────────────────────────────────────
    case 'EXTRACT_FEATURES': {
      const { id } = msg;
      try {
        const vector = await buildFeatureVector();
        log('feature vector assembled', vector);
        ctx.postMessage({
          type:    'FEATURES_READY',
          id,
          payload: vector,
        } satisfies WorkerOutboundMessage);
      } catch (err) {
        const msg2: WorkerOutboundMessage = {
          type:  'FEATURES_ERROR',
          id,
          error: err instanceof Error ? err.message : String(err),
        };
        ctx.postMessage(msg2);
      }
      break;
    }
  }
}

// ── Feature assembly ──────────────────────────────────────────────────────────

async function buildFeatureVector(): Promise<FeatureVector> {
  const now = performance.now();

  // Re-collect env dims at extraction time to capture any devtools state change
  const envFeatures = collectEnvironmentFeatures();

  const mouseFeatures: [number,number,number,number,number,number,number,number,number,number] =
    mouseCollector?.extract() ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const keystrokeFeatures: [number,number,number,number,number,number,number,number] =
    keystrokeCollector?.extract() ?? [0, 0, 0, 0, 0, 0, 0, 0];

  const sessionFeatures: [number,number,number,number,number,number,number,number] =
    sessionCollector?.extract(now) ?? [0, 0, 0, 0, 0, 0, 0, 0];

  const networkFeatures: [number,number,number,number,number,number] =
    await collectNetworkFeatures(config?.apiBase ?? '/api/crust');

  const vector: FeatureVector = [
    ...envFeatures,
    ...mouseFeatures,
    ...keystrokeFeatures,
    ...sessionFeatures,
    ...networkFeatures,
  ] as FeatureVector;

  if (vector.length !== 40) {
    throw new Error(`FeatureVector length mismatch: expected 40, got ${vector.length}`);
  }

  // Re-initialise collectors so a subsequent protect() call starts fresh
  sessionStart       = performance.now();
  mouseCollector     = new MouseCollector(sessionStart);
  keystrokeCollector = new KeystrokeCollector();
  sessionCollector   = new SessionCollector(sessionStart);

  return vector;
}
