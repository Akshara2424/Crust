import { useRef, useCallback } from 'react';
import type { GameSignals } from './types';
import { CHALLENGE_DURATION_S } from './types';

interface DragRecord {
  startT:          number;
  endT:            number;
  distance:        number;
  hesitationMs:    number;  // dragstart → dragend delay
  crossedBoundary: boolean;
}

/** Bins intervals into 100 ms buckets → normalised Shannon entropy (0–1, max=4 bits) */
function computeEntropy(intervals: number[]): number {
  if (intervals.length < 2) return 0;
  const bins: Record<number, number> = {};
  for (const iv of intervals) {
    const b = Math.floor(Math.max(0, iv) / 100);
    bins[b] = (bins[b] ?? 0) + 1;
  }
  const total = intervals.length;
  let entropy = 0;
  for (const count of Object.values(bins)) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return Math.min(entropy / 4, 1);
}

export interface BehavioralSignalHandlers {
  onDragStart(x: number, y: number): void;
  onDragMove(x: number, y: number): void;
  onDrop(x: number, y: number, crossedBoundary: boolean): void;
  onToppingRemoved(): void;
  onToppingReordered(): void;
  onFirstInteraction(): void;
  onSubmit(): void;
  onPointerMove(): void;
  collectSignals(): GameSignals;
}

export function useBehavioralSignals(): BehavioralSignalHandlers {
  const drags               = useRef<DragRecord[]>([]);
  const currentDrag         = useRef<{ startT: number; startX: number; startY: number } | null>(null);
  const correctionCount     = useRef(0);
  const reorderCount        = useRef(0);
  const firstInteractionT   = useRef<number | null>(null);
  const submitT             = useRef<number | null>(null);
  const overshoots          = useRef(0);
  const pointerEventTs      = useRef<number[]>([]);
  const lastPointerT        = useRef<number | null>(null);
  const totalIdleMs         = useRef(0);
  const windowStartT        = useRef<number>(performance.now());

  const onFirstInteraction = useCallback(() => {
    if (firstInteractionT.current === null) {
      firstInteractionT.current = performance.now();
    }
  }, []);

  const onDragStart = useCallback((x: number, y: number) => {
    onFirstInteraction();
    currentDrag.current = { startT: performance.now(), startX: x, startY: y };
    pointerEventTs.current.push(performance.now());
  }, [onFirstInteraction]);

  const onDragMove = useCallback((_x: number, _y: number) => {
    const now = performance.now();
    if (lastPointerT.current !== null) {
      const gap = now - lastPointerT.current;
      // Gap > 1 s with no movement counts as idle
      if (gap > 1000) totalIdleMs.current += gap;
    }
    lastPointerT.current = now;
    pointerEventTs.current.push(now);
  }, []);

  const onDrop = useCallback((x: number, y: number, crossedBoundary: boolean) => {
    if (!currentDrag.current) return;
    const { startT, startX, startY } = currentDrag.current;
    const endT = performance.now();
    const distance = Math.hypot(x - startX, y - startY);
    const hesitationMs = endT - startT;
    if (crossedBoundary) overshoots.current++;
    drags.current.push({ startT, endT, distance, hesitationMs, crossedBoundary });
    currentDrag.current = null;
    pointerEventTs.current.push(endT);
  }, []);

  const onToppingRemoved = useCallback(() => {
    correctionCount.current++;
  }, []);

  const onToppingReordered = useCallback(() => {
    reorderCount.current++;
  }, []);

  const onSubmit = useCallback(() => {
    submitT.current = performance.now();
  }, []);

  const onPointerMove = useCallback(() => {
    const now = performance.now();
    if (lastPointerT.current !== null) {
      const gap = now - lastPointerT.current;
      if (gap > 1000) totalIdleMs.current += gap;
    }
    lastPointerT.current = now;
  }, []);

  const collectSignals = useCallback((): GameSignals => {
    const allDrags = drags.current;
    const now = performance.now();

    // drag_velocity_mean: mean px/ms
    const drag_velocity_mean = allDrags.length === 0 ? 0 :
      allDrags.reduce((sum, d) => {
        const dt = d.endT - d.startT;
        return sum + (dt > 0 ? d.distance / dt : 0);
      }, 0) / allDrags.length;

    // placement_hesitation_ms: mean drag duration
    const placement_hesitation_ms = allDrags.length === 0 ? 0 :
      allDrags.reduce((s, d) => s + d.hesitationMs, 0) / allDrags.length;

    // correction_count: raw count
    const correction_count = correctionCount.current;

    // completion_time_ms
    const ft = firstInteractionT.current;
    const st = submitT.current ?? now;
    const completion_time_ms = ft !== null ? st - ft : 0;

    // overshoot_ratio
    const overshoot_ratio = allDrags.length === 0 ? 0 :
      overshoots.current / allDrags.length;

    // idle_ratio_during_play
    const windowMs = CHALLENGE_DURATION_S * 1000;
    const elapsed  = Math.min(now - windowStartT.current, windowMs);
    const idle_ratio_during_play = elapsed > 0
      ? Math.min(totalIdleMs.current / elapsed, 1)
      : 0;

    // ingredient_reorder_count
    const ingredient_reorder_count = reorderCount.current;

    // interaction_entropy: Shannon over inter-event intervals
    const pts = pointerEventTs.current;
    const intervals = pts.slice(1).map((t, i) => t - pts[i]);
    const interaction_entropy = computeEntropy(intervals);

    return {
      drag_velocity_mean,
      placement_hesitation_ms,
      correction_count,
      completion_time_ms,
      overshoot_ratio,
      idle_ratio_during_play,
      ingredient_reorder_count,
      interaction_entropy,
    };
  }, []);

  return {
    onDragStart,
    onDragMove,
    onDrop,
    onToppingRemoved,
    onToppingReordered,
    onFirstInteraction,
    onSubmit,
    onPointerMove,
    collectSignals,
  };
}
