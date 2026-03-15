/**
 * CRUST SDK — Keystroke features (dims 19–26)
 *
 * KeystrokeCollector tracks keydown/keyup timings forwarded from the main
 * thread and derives 8 normalised features on demand.  All internal buffers
 * are cleared after extract() to avoid retaining raw keystroke data.
 *
 * Dims:
 * 19  ks_iki_mean             inter-key interval mean
 * 20  ks_iki_variance         inter-key interval variance
 * 21  ks_hold_time_mean       key hold duration mean
 * 22  ks_hold_time_variance   key hold duration variance
 * 23  ks_bigram_consistency   consistency of repeated character-pair timings
 * 24  ks_event_count          total key events (normalised)
 * 25  ks_backspace_ratio      backspace events / total keydown events
 * 26  ks_burst_ratio          rapid-succession keystrokes / total transitions
 */

import type { RawKeyEvent } from './types.js';

// ── Math helpers ──────────────────────────────────────────────────────────────

function arrayMean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function arrayVariance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = arrayMean(xs);
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length;
}

/** Coefficient of variation: σ / μ  (0 = maximally consistent) */
function coefficientOfVariation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = arrayMean(xs);
  if (m === 0) return 0;
  return Math.sqrt(arrayVariance(xs)) / m;
}

// ── Collector ─────────────────────────────────────────────────────────────────

export class KeystrokeCollector {
  /** Tracks keydown timestamp by key code for hold-time computation */
  private readonly downTimes = new Map<string, number>();

  /** Inter-key intervals (ms) between consecutive keydown events */
  private ikis: number[] = [];

  /** Hold durations (ms) per key press */
  private holdTimes: number[] = [];

  /**
   * Bigram IKI samples keyed by consecutive key pair string (e.g. "th").
   * Only printable single characters are tracked for bigrams.
   */
  private readonly bigrams = new Map<string, number[]>();

  private totalKeydowns = 0;
  private backspaceCount = 0;
  /** Transitions where IKI < BURST_THRESHOLD_MS are considered "burst" */
  private burstTransitions = 0;
  private lastKeydownTime: number | null = null;
  private lastKey: string | null = null;

  private static readonly BURST_THRESHOLD_MS   = 150;  // ms — rapid typing burst
  private static readonly MAX_VALID_IKI_MS      = 2_000; // ms — discard pauses
  private static readonly MAX_VALID_HOLD_MS     = 800;   // ms — discard held keys

  push(ev: RawKeyEvent): void {
    if (ev.type === 'down') {
      this.totalKeydowns++;

      if (ev.key === 'Backspace') this.backspaceCount++;

      if (this.lastKeydownTime !== null) {
        const iki = ev.t - this.lastKeydownTime;

        // Record IKI if plausible (not a long idle gap)
        if (iki >= 0 && iki < KeystrokeCollector.MAX_VALID_IKI_MS) {
          this.ikis.push(iki);

          // Bigram tracking — only single printable chars
          if (this.lastKey !== null && this.lastKey.length === 1 && ev.key.length === 1) {
            const bg = this.lastKey + ev.key;
            const existing = this.bigrams.get(bg);
            if (existing !== undefined) {
              existing.push(iki);
            } else {
              this.bigrams.set(bg, [iki]);
            }
          }

          // Burst detection
          if (iki < KeystrokeCollector.BURST_THRESHOLD_MS) {
            this.burstTransitions++;
          }
        }
      }

      this.lastKeydownTime = ev.t;
      this.lastKey         = ev.key;
      this.downTimes.set(ev.code, ev.t);

    } else {
      // Key up → derive hold time
      const t0 = this.downTimes.get(ev.code);
      if (t0 !== undefined) {
        const hold = ev.t - t0;
        if (hold >= 0 && hold < KeystrokeCollector.MAX_VALID_HOLD_MS) {
          this.holdTimes.push(hold);
        }
        this.downTimes.delete(ev.code);
      }
    }
  }

  /**
   * Derive all 8 keystroke features and clear raw buffers.
   * Returns a fixed-length 8-tuple.
   */
  extract(): [number, number, number, number, number, number, number, number] {
    const nDown = this.totalKeydowns;

    // ── Dim 19: IKI mean ─────────────────────────────────────────────────────
    // Typical human IKI range: 80–400 ms.  Normalised against 500 ms ceiling.
    const ikiMean = Math.min(arrayMean(this.ikis) / 500, 1);

    // ── Dim 20: IKI variance ─────────────────────────────────────────────────
    // Normalised against (500 ms)² = 250 000
    const ikiVar = Math.min(arrayVariance(this.ikis) / 250_000, 1);

    // ── Dim 21: hold time mean ────────────────────────────────────────────────
    // Typical human hold: 50–120 ms.  Normalised against 300 ms.
    const holdMean = Math.min(arrayMean(this.holdTimes) / 300, 1);

    // ── Dim 22: hold time variance ────────────────────────────────────────────
    const holdVar = Math.min(arrayVariance(this.holdTimes) / 90_000, 1);

    // ── Dim 23: bigram consistency ────────────────────────────────────────────
    // For each bigram with ≥ 3 IKI samples compute CoV.
    // Average CoV across all qualifying bigrams; invert so high consistency → 1.
    const bigramCovs: number[] = [];
    for (const [, samples] of this.bigrams) {
      if (samples.length >= 3) {
        bigramCovs.push(coefficientOfVariation(samples));
      }
    }
    // Low CoV ≈ consistent typing ≈ human; result inverted and clamped.
    const bigramConsistency = bigramCovs.length > 0
      ? Math.max(0, 1 - Math.min(arrayMean(bigramCovs), 1))
      : 0;

    // ── Dim 24: event count ───────────────────────────────────────────────────
    // 500 keydowns ≈ a typical form-fill session ceiling.
    const eventCountNorm = Math.min(nDown / 500, 1);

    // ── Dim 25: backspace ratio ───────────────────────────────────────────────
    const backspaceRatio = nDown > 0 ? Math.min(this.backspaceCount / nDown, 1) : 0;

    // ── Dim 26: burst ratio ───────────────────────────────────────────────────
    const transitions = Math.max(nDown - 1, 1);
    const burstRatio  = Math.min(this.burstTransitions / transitions, 1);

    // Discard raw keystroke data
    this.ikis       = [];
    this.holdTimes  = [];
    this.downTimes.clear();
    this.bigrams.clear();

    return [
      ikiMean,
      ikiVar,
      holdMean,
      holdVar,
      bigramConsistency,
      eventCountNorm,
      backspaceRatio,
      burstRatio,
    ];
  }
}
