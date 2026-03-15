/**
 * CRUST SDK — shared type definitions
 * All worker message contracts and domain types live here.
 */

// ── Feature vector ─────────────────────────────────────────────────────────────
// 40 floats in fixed order: 8 env · 10 mouse · 8 keystroke · 8 session · 6 network

export type FeatureVector = [
  // Environment (dims 1–8)
  number, number, number, number, number, number, number, number,
  // Mouse (dims 9–18)
  number, number, number, number, number, number, number, number, number, number,
  // Keystroke (dims 19–26)
  number, number, number, number, number, number, number, number,
  // Session (dims 27–34)
  number, number, number, number, number, number, number, number,
  // Network (dims 35–40)
  number, number, number, number, number, number,
];

// ── Config ─────────────────────────────────────────────────────────────────────

export interface CrustConfig {
  /** Base URL for the CRUST verification service. Default: "/api/crust" */
  apiBase: string;
  /** Passive observation window before feature extraction (ms). Default: 10 000 */
  collectionWindowMs: number;
  /** Emit verbose debug logs to the console. Default: false */
  debug: boolean;
}

export const DEFAULT_CONFIG: Readonly<CrustConfig> = {
  apiBase: '/api/crust',
  collectionWindowMs: 10_000,
  debug: false,
};

// ── Decision enum ──────────────────────────────────────────────────────────────

export enum DecisionEnum {
  PASS           = 'PASS',
  SOFT_CHALLENGE = 'SOFT_CHALLENGE',
  HARD_CHALLENGE = 'HARD_CHALLENGE',
  BLOCK          = 'BLOCK',
}

// ── JWT ────────────────────────────────────────────────────────────────────────

export interface JWTPayload {
  sub:          string;         // "crust-session"
  iss:          string;         // "crust-verification-service"
  iat:          number;         // epoch seconds
  exp:          number;         // iat + 900
  confidence:   number;
  decision:     DecisionEnum;
  feature_hash: string;         // SHA-256 hex of the feature vector
}

// ── API response ───────────────────────────────────────────────────────────────

export interface CrustResponse {
  jwt:        string;
  confidence: number;
  decision:   DecisionEnum;
}

export interface ChallengeOrder {
  order_id:   string;
  base:       string;
  sauce:      string;
  toppings:   string[];
  expires_at: string;
}

// ── Raw event payloads (forwarded from main thread to worker) ──────────────────

export interface RawMouseEvent {
  x:        number;
  y:        number;
  t:        number;        // performance.now()
  pressure: number;        // PointerEvent.pressure (0–1)
  isClick:  boolean;
  targetW:  number;        // bounding rect width of target element
  targetH:  number;        // bounding rect height of target element
}

export interface RawKeyEvent {
  type: 'down' | 'up';
  key:  string;
  code: string;
  t:    number;            // performance.now()
}

export interface RawScrollEvent {
  deltaY: number;          // signed pixels
  t:      number;
}

export interface RawSessionEvent {
  type:    'focus' | 'blur' | 'visibility' | 'formfocus' | 'paste' | 'copy';
  t:       number;
  hidden?: boolean;        // only for 'visibility'
}

// ── Worker message protocol ────────────────────────────────────────────────────

export type WorkerInboundMessage =
  | { type: 'INIT';          payload: CrustConfig }
  | { type: 'MOUSE_EVENT';   payload: RawMouseEvent }
  | { type: 'KEY_EVENT';     payload: RawKeyEvent }
  | { type: 'SCROLL_EVENT';  payload: RawScrollEvent }
  | { type: 'SESSION_EVENT'; payload: RawSessionEvent }
  | { type: 'EXTRACT_FEATURES'; id: string };

export type WorkerOutboundMessage =
  | { type: 'ENV_READY' }
  | { type: 'FEATURES_READY';  id: string; payload: FeatureVector }
  | { type: 'FEATURES_ERROR';  id: string; error: string };
