/**
 * CRUST SDK — Toppings Challenge stub (Phase 1)
 *
 * Returns a fixed submitted order and 8 zero-float game signals.
 * Phase 3 replaces this module entirely with the interactive React component
 * that renders inline in the page without a full reload.
 *
 * Named game signal slots (in fixed order):
 *   drag_velocity_mean         [0]
 *   placement_hesitation_ms    [1]
 *   correction_count           [2]
 *   completion_time_ms         [3]
 *   overshoot_ratio            [4]
 *   idle_ratio_during_play     [5]
 *   ingredient_reorder_count   [6]
 *   interaction_entropy        [7]
 */

/** Shape of the object returned by POST /challenge/result's game_signals field */
export interface GameSignals {
  drag_velocity_mean:       number;
  placement_hesitation_ms:  number;
  correction_count:         number;
  completion_time_ms:       number;
  overshoot_ratio:          number;
  idle_ratio_during_play:   number;
  ingredient_reorder_count: number;
  interaction_entropy:      number;
}

/** Full return type consumed by the verify flow in index.ts */
export interface ToppingsResult {
  orderId:     string;
  submitted: {
    base:     string;
    sauce:    string;
    toppings: string[];
  };
  /** 8-element tuple matching the GameSignals fields in order */
  gameSignals: [number, number, number, number, number, number, number, number];
}

/** Ordered keys for serialising gameSignals tuple → GameSignals object */
export const GAME_SIGNAL_KEYS: ReadonlyArray<keyof GameSignals> = [
  'drag_velocity_mean',
  'placement_hesitation_ms',
  'correction_count',
  'completion_time_ms',
  'overshoot_ratio',
  'idle_ratio_during_play',
  'ingredient_reorder_count',
  'interaction_entropy',
];

/**
 * runToppingsChallenge
 *
 * Phase 1 stub: auto-submits a minimal valid pizza order with all-zero
 * behavioural signals so the pipeline can be exercised end-to-end.
 * The verification service will re-score this at a lower confidence
 * (expected to remain in SOFT_CHALLENGE or escalate to HARD_CHALLENGE).
 *
 * @param orderId          UUID returned by POST /challenge/order
 * @param softChallengeJwt JWT with decision == SOFT_CHALLENGE
 */
export async function runToppingsChallenge(
  orderId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _softChallengeJwt: string,
): Promise<ToppingsResult> {
  return {
    orderId,
    submitted: {
      base:     'classic',
      sauce:    'tomato',
      toppings: [],
    },
    gameSignals: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}
