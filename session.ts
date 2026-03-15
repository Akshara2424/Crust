/**
 * CRUST SDK — Session features (dims 27–34)
 *
 * SessionCollector observes page-lifecycle events forwarded from the main
 * thread over the collection window, then condenses them into 8 normalised
 * feature values.  Raw scroll event arrays are cleared after extract().
 *
 * Dims:
 * 27  sess_first_interaction_delay   delay from page load to first event (ms)
 * 28  sess_focus_switches            window focus/blur transitions
 * 29  sess_tab_hidden_duration       proportion of session while tab was hidden
 * 30  sess_scroll_velocity_mean      mean scroll speed (px/ms)
 * 31  sess_scroll_direction_reversals  scroll direction reversals
 * 32  sess_form_focus_count          input/textarea/select focus events
 * 33  sess_copy_paste_detected       1 if any copy/paste detected
 * 34  sess_total_duration            total session length (ms)
 */

import type { RawScrollEvent, RawSessionEvent } from './types.js';

// ── Math helpers ──────────────────────────────────────────────────────────────

function arrayMean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ── Collector ─────────────────────────────────────────────────────────────────

export class SessionCollector {
  private readonly startTime: number;            // performance.now() at init
  private firstInteractionTime: number | null = null;

  private focusSwitches = 0;
  private lastFocused   = true;                  // assume page starts focused

  private hiddenStart:    number | null = null;
  private totalHiddenMs               = 0;

  private scrollEvents: RawScrollEvent[] = [];

  private formFocusCount    = 0;
  private copyPasteDetected = false;

  constructor(startTime: number) {
    this.startTime = startTime;
  }

  pushSession(ev: RawSessionEvent): void {
    this.markFirstInteraction(ev.t);

    switch (ev.type) {
      case 'focus':
        if (!this.lastFocused) {
          this.focusSwitches++;
          this.lastFocused = true;
        }
        break;

      case 'blur':
        if (this.lastFocused) {
          this.focusSwitches++;
          this.lastFocused = false;
        }
        break;

      case 'visibility':
        if (ev.hidden === true) {
          this.hiddenStart = ev.t;
        } else if (this.hiddenStart !== null) {
          this.totalHiddenMs += ev.t - this.hiddenStart;
          this.hiddenStart = null;
        }
        break;

      case 'formfocus':
        this.formFocusCount++;
        break;

      case 'copy':
      case 'paste':
        this.copyPasteDetected = true;
        break;
    }
  }

  pushScroll(ev: RawScrollEvent): void {
    this.markFirstInteraction(ev.t);
    this.scrollEvents.push(ev);
  }

  /**
   * Derive all 8 session features at extraction time.
   * @param now  current performance.now() value passed in by the worker
   */
  extract(now: number): [number, number, number, number, number, number, number, number] {
    const totalMs = Math.max(now - this.startTime, 1);

    // Account for still-hidden tab at extraction time
    let hiddenMs = this.totalHiddenMs;
    if (this.hiddenStart !== null) hiddenMs += now - this.hiddenStart;

    // ── Dim 27: first interaction delay ──────────────────────────────────────
    // Time from page load to first observed event.  Normalised over 0–30 s.
    const firstDelay = this.firstInteractionTime !== null
      ? this.firstInteractionTime - this.startTime
      : totalMs;                                   // no interaction → max delay
    const firstDelayNorm = Math.min(firstDelay / 30_000, 1);

    // ── Dim 28: focus switches ────────────────────────────────────────────────
    // Normalised over 0–20 transitions.
    const focusSwitchNorm = Math.min(this.focusSwitches / 20, 1);

    // ── Dim 29: tab hidden duration ratio ─────────────────────────────────────
    const hiddenRatio = Math.min(hiddenMs / totalMs, 1);

    // ── Dims 30–31: scroll velocity mean & direction reversals ────────────────
    const evs = this.scrollEvents;
    const scrollVelocities: number[] = [];
    let reversals = 0;

    for (let i = 1; i < evs.length; i++) {
      const dt = evs[i]!.t - evs[i - 1]!.t;
      if (dt > 0) scrollVelocities.push(Math.abs(evs[i]!.deltaY) / dt);

      const prevSign = Math.sign(evs[i - 1]!.deltaY);
      const currSign = Math.sign(evs[i]!.deltaY);
      if (prevSign !== 0 && currSign !== 0 && prevSign !== currSign) reversals++;
    }

    // Scroll velocity: human typical peak ~5 px/ms on trackpad.
    const scrollVelMean   = Math.min(arrayMean(scrollVelocities) / 5, 1);
    const reversalNorm    = Math.min(reversals / 30, 1);

    // ── Dim 32: form focus count ──────────────────────────────────────────────
    const formFocusNorm = Math.min(this.formFocusCount / 20, 1);

    // ── Dim 33: copy/paste flag ───────────────────────────────────────────────
    const copyPasteFlag = this.copyPasteDetected ? 1 : 0;

    // ── Dim 34: total session duration ────────────────────────────────────────
    // Normalised over 0–120 s.
    const durationNorm = Math.min(totalMs / 120_000, 1);

    // Discard raw scroll data
    this.scrollEvents = [];

    return [
      firstDelayNorm,
      focusSwitchNorm,
      hiddenRatio,
      scrollVelMean,
      reversalNorm,
      formFocusNorm,
      copyPasteFlag,
      durationNorm,
    ];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private markFirstInteraction(t: number): void {
    if (this.firstInteractionTime === null) {
      this.firstInteractionTime = t;
    }
  }
}
