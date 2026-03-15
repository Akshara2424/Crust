/**
 * CRUST SDK — Network features (dims 35–40)
 *
 * Fires three 1-byte OPTIONS preflights to the /verify endpoint and reads the
 * NetworkInformation API to derive 6 normalised network characteristics.
 *
 * All fetch calls are fully async and must not block the main thread — they
 * run inside the Web Worker.
 *
 * Dims:
 * 35  net_request_jitter       timing variance across repeated OPTIONS calls
 * 36  net_ja3_fingerprint      TLS handshake timing as a JA3 approximation
 * 37  net_connection_type      NetworkInformation.type mapped to ordinal
 * 38  net_rtt_estimate         NetworkInformation.rtt, normalised
 * 39  net_downlink_estimate    NetworkInformation.downlink, normalised
 * 40  net_preflight_timing     mean OPTIONS round-trip time, normalised
 */

// ── Type augmentation ─────────────────────────────────────────────────────────

interface NetworkInformation {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  type?:          string;
  rtt?:           number;       // ms
  downlink?:      number;       // Mbit/s
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maps NetworkInformation.type strings to a normalised ordinal (0–1). */
const CONNECTION_TYPE_ORDINALS: Readonly<Record<string, number>> = {
  bluetooth: 1 / 7,
  cellular:  2 / 7,
  ethernet:  3 / 7,
  none:      4 / 7,
  wifi:      5 / 7,
  wimax:     6 / 7,
  other:     7 / 7,
};

/** How many OPTIONS probes to fire for jitter/timing estimation. */
const PROBE_COUNT = 3;

// ── Internal helpers ──────────────────────────────────────────────────────────

function arrayMean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function arrayVariance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = arrayMean(xs);
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length;
}

/**
 * Fire a single OPTIONS preflight and return the round-trip time in ms.
 * Swallows all errors (network unavailable, CORS, etc.) and returns the
 * elapsed wall-clock time regardless of HTTP status.
 */
async function probeRtt(url: string): Promise<number> {
  const t0 = performance.now();
  try {
    await fetch(url, {
      method:      'OPTIONS',
      mode:        'cors',
      credentials: 'omit',
      cache:       'no-store',
    });
  } catch {
    // Intentional: we want the timing even if fetch throws
  }
  return performance.now() - t0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Collect all 6 network features.
 *
 * @param apiBase  Base URL of the CRUST service (used for OPTIONS probes).
 * @returns        A fixed-length 6-tuple of normalised floats.
 */
export async function collectNetworkFeatures(
  apiBase: string,
): Promise<[number, number, number, number, number, number]> {

  // ── Read NetworkInformation API ───────────────────────────────────────────
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;

  const connTypeStr = conn?.type ?? 'unknown';
  const connType    = CONNECTION_TYPE_ORDINALS[connTypeStr] ?? 0;

  // RTT: NetworkInformation.rtt is in ms; normalise over 0–2 000 ms.
  const rtt = conn?.rtt !== undefined ? Math.min(conn.rtt / 2_000, 1) : 0;

  // Downlink: in Mbit/s; normalise over 0–100 Mbit/s (gigabit-ish).
  const downlink = conn?.downlink !== undefined
    ? Math.min(conn.downlink / 100, 1)
    : 0;

  // ── Fire OPTIONS probes ───────────────────────────────────────────────────
  const probeUrl  = `${apiBase}/health`;
  const timings: number[] = [];

  for (let i = 0; i < PROBE_COUNT; i++) {
    timings.push(await probeRtt(probeUrl));
  }

  const meanRtt = arrayMean(timings);

  // ── Dim 35: request jitter ────────────────────────────────────────────────
  // Std-dev of probe RTTs, normalised over 0–200 ms of expected jitter.
  const jitter = Math.min(Math.sqrt(arrayVariance(timings)) / 200, 1);

  // ── Dim 36: JA3 approximation ─────────────────────────────────────────────
  // A true JA3 hash requires TLS ClientHello parsing, which is not possible
  // from JavaScript.  Instead we use the *first* probe's latency as a proxy:
  // TLS 1.2 and 1.3 have structurally different handshake timings, and
  // distinct cipher-suite ordering causes measurable differences.
  //
  // Normalised over 0–500 ms (95th-percentile TLS handshake for TLS 1.2 on
  // a typical broadband connection).
  const ja3Approx = timings.length > 0
    ? Math.min((timings[0] ?? 0) / 500, 1)
    : 0;

  if (ja3Approx === 0) {
    console.warn('[CRUST] net_ja3_fingerprint: timing-based approximation returned 0 — fetch may have failed');
  }

  // ── Dim 40: preflight timing ──────────────────────────────────────────────
  // Mean OPTIONS round-trip, normalised over 0–1 000 ms.
  const preflightTiming = Math.min(meanRtt / 1_000, 1);

  return [
    jitter,          // dim 35
    ja3Approx,       // dim 36
    connType,        // dim 37
    rtt,             // dim 38
    downlink,        // dim 39
    preflightTiming, // dim 40
  ];
}
