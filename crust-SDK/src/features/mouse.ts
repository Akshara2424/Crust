/**
 * CRUST SDK — Mouse features (dims 9–18)
 *
 * MouseCollector accumulates RawMouseEvents forwarded from the main thread,
 * then derives 10 normalised features on demand.  All raw event arrays are
 * set to empty immediately after extract() to honour the "no raw data
 * retained" constraint.
 *
 * Dims:
 *  9  mouse_trajectory_linearity
 * 10  mouse_avg_velocity
 * 11  mouse_velocity_variance
 * 12  mouse_curvature_mean
 * 13  mouse_pause_count
 * 14  mouse_overshoot_count
 * 15  mouse_click_pressure_variance
 * 16  mouse_event_count
 * 17  mouse_idle_ratio
 * 18  mouse_fitts_adherence
 */

import type { RawMouseEvent } from '../types.js';

// ── Math helpers ──────────────────────────────────────────────────────────────

function arrayMean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function arrayVariance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = arrayMean(xs);
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length;
}

/** Pearson correlation coefficient ∈ [−1, 1] */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = arrayMean(xs);
  const my = arrayMean(ys);
  let num = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num   += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }
  const denom = Math.sqrt(sumX2 * sumY2);
  return denom === 0 ? 0 : num / denom;
}

// ── Click record ──────────────────────────────────────────────────────────────

interface ClickRecord {
  fromX:        number;
  fromY:        number;
  toX:          number;
  toY:          number;
  movementMs:   number;  // time from previous event to click (ms)
  targetW:      number;  // width of click target (px)
  pressure:     number;  // pointer pressure 0–1
}

// ── Collector ─────────────────────────────────────────────────────────────────

export class MouseCollector {
  private events: RawMouseEvent[] = [];
  private clicks: ClickRecord[]   = [];
  private readonly sessionStart: number;

  // Reusable velocity array – built lazily in extract()
  private velocities: number[] = [];

  constructor(sessionStart: number) {
    this.sessionStart = sessionStart;
  }

  push(ev: RawMouseEvent): void {
    const prev = this.events[this.events.length - 1];
    this.events.push(ev);

    if (ev.isClick && prev !== undefined) {
      this.clicks.push({
        fromX:      prev.x,
        fromY:      prev.y,
        toX:        ev.x,
        toY:        ev.y,
        movementMs: Math.max(ev.t - prev.t, 0),
        targetW:    Math.max(ev.targetW, 1),
        pressure:   ev.pressure,
      });
    }
  }

  /**
   * Derive all 10 mouse features from accumulated events, then discard
   * the raw buffers.  Returns a fixed-length 10-tuple.
   */
  extract(): [number, number, number, number, number, number, number, number, number, number] {
    const evs = this.events;
    const n   = evs.length;

    // Epoch span used for ratio calculations
    const spanMs = n > 1
      ? (evs[n - 1]!.t - this.sessionStart)
      : 1;

    // ── Dim 9: trajectory linearity ──────────────────────────────────────────
    // Ratio of Euclidean start→end distance to cumulative path length.
    // 1 = perfectly straight; approaching 0 = highly curved.
    let pathLen = 0;
    this.velocities = [];
    for (let i = 1; i < n; i++) {
      const ev  = evs[i]!;
      const pev = evs[i - 1]!;
      const dx  = ev.x - pev.x;
      const dy  = ev.y - pev.y;
      const seg = Math.sqrt(dx * dx + dy * dy);
      pathLen += seg;
      const dt = ev.t - pev.t;
      if (dt > 0) this.velocities.push(seg / dt); // px/ms
    }
    let linearity = 0;
    if (pathLen > 0 && n >= 2) {
      const ex = evs[n - 1]!.x - evs[0]!.x;
      const ey = evs[n - 1]!.y - evs[0]!.y;
      linearity = Math.min(Math.sqrt(ex * ex + ey * ey) / pathLen, 1);
    }

    // ── Dim 10: velocity mean (normalised; human peak ~3 px/ms) ──────────────
    const velMean = Math.min(arrayMean(this.velocities) / 3, 1);

    // ── Dim 11: velocity variance (normalised to max 9 (px/ms)²) ─────────────
    const velVar = Math.min(arrayVariance(this.velocities) / 9, 1);

    // ── Dim 12: curvature mean ────────────────────────────────────────────────
    // Approximate discrete curvature at each interior point via cross-product.
    const curvatures: number[] = [];
    for (let i = 1; i < n - 1; i++) {
      const ax = evs[i]!.x - evs[i - 1]!.x, ay = evs[i]!.y - evs[i - 1]!.y;
      const bx = evs[i + 1]!.x - evs[i]!.x, by = evs[i + 1]!.y - evs[i]!.y;
      const cross = Math.abs(ax * by - ay * bx);
      const magA  = Math.sqrt(ax * ax + ay * ay);
      const magB  = Math.sqrt(bx * bx + by * by);
      if (magA > 0 && magB > 0) curvatures.push(cross / (magA * magB));
    }
    const curvatureMean = Math.min(arrayMean(curvatures), 1);

    // ── Dim 13: pause count ───────────────────────────────────────────────────
    // A pause is a stretch of consecutive inter-event intervals all < 0.02 px/ms,
    // lasting a cumulative ≥ 300 ms.
    const PAUSE_VEL  = 0.02; // px/ms
    const PAUSE_TIME = 300;  // ms
    let pauseCount = 0;
    let pauseAccum = 0;
    for (let i = 0; i < this.velocities.length; i++) {
      const dt = i + 1 < n ? evs[i + 1]!.t - evs[i]!.t : 0;
      if (this.velocities[i]! < PAUSE_VEL) {
        pauseAccum += dt;
      } else {
        if (pauseAccum >= PAUSE_TIME) pauseCount++;
        pauseAccum = 0;
      }
    }
    if (pauseAccum >= PAUSE_TIME) pauseCount++;
    const pauseNorm = Math.min(pauseCount / 20, 1);

    // ── Dim 14: overshoot count ───────────────────────────────────────────────
    // After a click, if the very next movement reverses back toward the origin,
    // count it as an overshoot.
    let overshootCount = 0;
    for (const c of this.clicks) {
      const idx = evs.findIndex(e => e.isClick && e.x === c.toX && e.y === c.toY);
      if (idx >= 0 && idx < n - 1) {
        const afterDx = evs[idx + 1]!.x - c.toX;
        const afterDy = evs[idx + 1]!.y - c.toY;
        const backDx  = c.fromX - c.toX;
        const backDy  = c.fromY - c.toY;
        if (afterDx * backDx + afterDy * backDy > 0) overshootCount++;
      }
    }
    const overshootNorm = Math.min(overshootCount / 10, 1);

    // ── Dim 15: click pressure variance ──────────────────────────────────────
    const pressures = this.clicks.map(c => c.pressure);
    const pressVar  = Math.min(arrayVariance(pressures), 1);

    // ── Dim 16: event count (normalised; 2000 events ≈ saturated session) ────
    const eventCountNorm = Math.min(n / 2_000, 1);

    // ── Dim 17: idle ratio ────────────────────────────────────────────────────
    // Proportion of session time where inter-event gap exceeded 500 ms.
    const IDLE_GAP = 500; // ms
    let idleMs = 0;
    for (let i = 1; i < n; i++) {
      const gap = evs[i]!.t - evs[i - 1]!.t;
      if (gap > IDLE_GAP) idleMs += gap;
    }
    const idleRatio = Math.min(idleMs / spanMs, 1);

    // ── Dim 18: Fitts's Law adherence ─────────────────────────────────────────
    const fittsAdherence = this.computeFittsAdherence();

    // Discard raw buffers — raw event coordinates must not linger
    this.events     = [];
    this.clicks     = [];
    this.velocities = [];

    return [
      linearity,
      velMean,
      velVar,
      curvatureMean,
      pauseNorm,
      overshootNorm,
      pressVar,
      eventCountNorm,
      idleRatio,
      fittsAdherence,
    ];
  }

  /**
   * Fitts's Law adherence (dim 18)
   *
   * Fitts's Law: MT = a + b · log₂(2D/W)
   * where D = distance to target, W = target width.
   * We use canonical constants a = 0 ms, b = 100 ms/bit.
   *
   * For each recorded click compute the predicted MT, then calculate the
   * Pearson correlation coefficient between the predicted and observed MTs.
   * The correlation (∈ [−1, 1]) is remapped to [0, 1] before returning.
   */
  private computeFittsAdherence(): number {
    if (this.clicks.length < 3) return 0;

    const predicted: number[] = [];
    const observed:  number[] = [];
    for (const c of this.clicks) {
      const dx = c.toX - c.fromX;
      const dy = c.toY - c.fromY;
      const D  = Math.sqrt(dx * dx + dy * dy);
      const W  = Math.max(c.targetW, 1);
      // Index of Difficulty (clamp at 0 to handle degenerate D/W values)
      const id = Math.max(Math.log2((2 * D) / W), 0);
      predicted.push(100 * id);   // ms
      observed.push(c.movementMs);
    }

    const r = pearson(predicted, observed);
    // Remap [−1, 1] → [0, 1]: a perfectly Fitts-adherent human scores ~1
    return (r + 1) / 2;
  }
}
