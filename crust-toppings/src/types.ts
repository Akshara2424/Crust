// ── Domain types for the CRUST Toppings Challenge ─────────────────────────────

export interface ToppingsProps {
  softChallengeJwt: string;
  /** 40-float feature vector from the initial /verify call */
  originalFeatureVector: number[];
  onSuccess: (newJwt: string) => void;
  onFailure: (reason: 'timeout' | 'max_attempts' | 'service_error') => void;
  /** Default: "/api/crust" */
  apiBase?: string;
}

export interface GameSignals {
  drag_velocity_mean: number;
  placement_hesitation_ms: number;
  correction_count: number;
  completion_time_ms: number;
  overshoot_ratio: number;
  idle_ratio_during_play: number;
  ingredient_reorder_count: number;
  interaction_entropy: number;
}

export interface PizzaOrder {
  order_id: string;
  base: string;
  sauce: string;
  toppings: string[];
  expires_at: string;
}

export interface PlacedTopping {
  /** Unique placement id */
  id: string;
  ingredient: string;
  /** 0–1 relative to pizza canvas width */
  x: number;
  /** 0–1 relative to pizza canvas height */
  y: number;
}

export type FailureReason = 'timeout' | 'max_attempts' | 'service_error';

// ── Ingredient palette ─────────────────────────────────────────────────────────

export const INGREDIENT_COLORS: Record<string, string> = {
  mushroom:  '#C4A882',
  olive:     '#7D9B4C',
  pepperoni: '#C0392B',
  onion:     '#E8B4D0',
  pepper:    '#E67E22',
  jalapeño:  '#27AE60',
  corn:      '#F1C40F',
  spinach:   '#2ECC71',
};

export const INGREDIENT_TEXT_COLORS: Record<string, string> = {
  mushroom:  '#5a3e28',
  olive:     '#fff',
  pepperoni: '#fff',
  onion:     '#7a3560',
  pepper:    '#fff',
  jalapeño:  '#fff',
  corn:      '#7a5a00',
  spinach:   '#fff',
};

export const SAUCE_COLORS: Record<string, string> = {
  tomato:  '#D63B1F',
  pesto:   '#4A7C3F',
  alfredo: '#F5E6C8',
  bbq:     '#6B2F0A',
};

export const SAUCE_OVERLAY_COLORS: Record<string, string> = {
  tomato:  'rgba(214,59,31,0.82)',
  pesto:   'rgba(74,124,63,0.82)',
  alfredo: 'rgba(245,230,200,0.72)',
  bbq:     'rgba(107,47,10,0.82)',
};

export const ALL_INGREDIENTS = Object.keys(INGREDIENT_COLORS);
export const BASE_OPTIONS    = ['thin', 'thick', 'gluten-free', 'sourdough'];
export const SAUCE_OPTIONS   = Object.keys(SAUCE_COLORS);

/** 3×3 snap grid (relative 0–1 coords within the pizza surface) */
export const SNAP_GRID: Array<{ x: number; y: number }> = [
  { x: 0.30, y: 0.30 }, { x: 0.50, y: 0.25 }, { x: 0.70, y: 0.30 },
  { x: 0.25, y: 0.50 }, { x: 0.50, y: 0.50 }, { x: 0.75, y: 0.50 },
  { x: 0.30, y: 0.70 }, { x: 0.50, y: 0.75 }, { x: 0.70, y: 0.70 },
];

export const MAX_PLACED_TOPPINGS  = 4;
export const CHALLENGE_DURATION_S = 60;
export const MAX_ATTEMPTS         = 3;
