import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ToppingsProps, PlacedTopping } from './types';
import {
  BASE_OPTIONS, SAUCE_OPTIONS, SAUCE_COLORS,
  MAX_PLACED_TOPPINGS, CHALLENGE_DURATION_S, MAX_ATTEMPTS,
} from './types';
import { usePizzaOrder }        from './usePizzaOrder';
import { useBehavioralSignals } from './useBehavioralSignals';
import { OrderTicket }          from './OrderTicket';
import { PizzaCanvas }          from './PizzaCanvas';
import { IngredientTray }       from './IngredientTray';
import styles from './ToppingsChallenge.module.css';

let toppingCounter = 0;
function uid() { return `t-${++toppingCounter}-${Math.random().toString(36).slice(2, 7)}`; }

export const ToppingsChallenge: React.FC<ToppingsProps> = ({
  softChallengeJwt,
  originalFeatureVector,
  onSuccess,
  onFailure,
  apiBase = '/api/crust',
}) => {
  const componentId = useId();

  // ── State ──────────────────────────────────────────────────────────────────
  const [selectedBase,    setSelectedBase]    = useState('');
  const [selectedSauce,   setSelectedSauce]   = useState('');
  const [placedToppings,  setPlacedToppings]  = useState<PlacedTopping[]>([]);
  const [remainingSeconds, setRemainingSeconds] = useState(CHALLENGE_DURATION_S);
  const [attempts,        setAttempts]        = useState(0);
  const [shake,           setShake]           = useState(false);
  const [showSuccess,     setShowSuccess]     = useState(false);
  const [dragIngredient,  setDragIngredient]  = useState<string | null>(null);
  const [submitting,      setSubmitting]      = useState(false);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const confettiRef = useRef<HTMLCanvasElement | null>(null);

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const signals  = useBehavioralSignals();
  const { orderState, submitState, fetchOrder, submitOrder } = usePizzaOrder(apiBase);

  // ── Fetch order on mount ───────────────────────────────────────────────────
  useEffect(() => {
    fetchOrder();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Countdown timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (orderState.status !== 'ready') return;
    timerRef.current = setInterval(() => {
      setRemainingSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          onFailure('timeout');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [orderState.status, onFailure]);

  // ── Pointer move tracking for idle ratio ──────────────────────────────────
  useEffect(() => {
    const handler = () => signals.onPointerMove();
    window.addEventListener('pointermove', handler, { passive: true });
    return () => window.removeEventListener('pointermove', handler);
  }, [signals]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const canSubmit =
    selectedBase !== '' &&
    selectedSauce !== '' &&
    placedToppings.length >= 2 &&
    !submitting &&
    orderState.status === 'ready';

  const placedIngredientNames = placedToppings.map((t) => t.ingredient);

  // ── Add / remove toppings ─────────────────────────────────────────────────
  const handleAddTopping = useCallback((ingredient: string, x: number, y: number) => {
    if (placedToppings.length >= MAX_PLACED_TOPPINGS) return;
    signals.onFirstInteraction();
    setPlacedToppings((prev) => {
      // If ingredient already placed, treat as reorder
      const existing = prev.find((t) => t.ingredient === ingredient);
      if (existing) {
        signals.onToppingReordered();
        return prev.map((t) =>
          t.ingredient === ingredient ? { ...t, x, y } : t
        );
      }
      return [...prev, { id: uid(), ingredient, x, y }];
    });
  }, [placedToppings.length, signals]);

  const handleRemoveTopping = useCallback((id: string) => {
    signals.onToppingRemoved();
    setPlacedToppings((prev) => prev.filter((t) => t.id !== id));
  }, [signals]);

  const handleClear = useCallback(() => {
    setPlacedToppings([]);
    setSelectedBase('');
    setSelectedSauce('');
  }, []);

  // Keyboard-place: put ingredient at next available snap grid cell
  const handleKeyboardPlace = useCallback((ingredient: string) => {
    if (placedToppings.length >= MAX_PLACED_TOPPINGS) return;
    const { SNAP_GRID } = require('./types');
    const occupied = new Set(placedToppings.map((t) => `${t.x},${t.y}`));
    const cell = SNAP_GRID.find(
      (p: { x: number; y: number }) => !occupied.has(`${p.x},${p.y}`)
    );
    if (!cell) return;
    handleAddTopping(ingredient, cell.x, cell.y);
  }, [placedToppings, handleAddTopping]);

  // ── Confetti burst ────────────────────────────────────────────────────────
  const launchConfetti = useCallback(async () => {
    // Dynamic import to keep bundle lean; falls back gracefully if not available
    try {
      const confetti = (await import('canvas-confetti')).default;
      confetti({
        particleCount: 120,
        spread:        80,
        origin:        { x: 0.5, y: 0.5 },
        colors:        ['#C0392B', '#F1C40F', '#27AE60', '#E67E22', '#2ECC71', '#E8B4D0'],
        zIndex:        9999,
      });
    } catch {
      // canvas-confetti not installed — CSS fallback via className
    }
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || orderState.status !== 'ready') return;

    signals.onSubmit();
    setSubmitting(true);

    const gameSignals = signals.collectSignals();

    const result = await submitOrder({
      jwt:                    softChallengeJwt,
      original_feature_vector: originalFeatureVector,
      order_id:               orderState.order.order_id,
      submitted: {
        base:     selectedBase,
        sauce:    selectedSauce,
        toppings: placedIngredientNames,
      },
      game_signals: gameSignals,
    });

    setSubmitting(false);

    if (result?.decision === 'PASS') {
      setShowSuccess(true);
      launchConfetti();
      clearInterval(timerRef.current!);
      setTimeout(() => onSuccess(result.jwt), 1200);
      return;
    }

    if (submitState.status === 'mismatch' || result === null) {
      // Shake animation
      setShake(true);
      setTimeout(() => setShake(false), 500);

      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        clearInterval(timerRef.current!);
        onFailure('max_attempts');
      }
    } else if (submitState.status === 'error') {
      clearInterval(timerRef.current!);
      onFailure('service_error');
    }
  }, [
    canSubmit, orderState, signals, submitOrder, softChallengeJwt,
    originalFeatureVector, selectedBase, selectedSauce, placedIngredientNames,
    submitState, attempts, onSuccess, onFailure, launchConfetti,
  ]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const sauceButtonColor = selectedSauce ? SAUCE_COLORS[selectedSauce] : undefined;

  return (
    <div className={styles.challengeRoot}>
      {/* Success overlay */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            className={styles.successOverlay}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className={styles.successEmoji}>🎉</span>
            <span className={styles.successText}>Verified!</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.challengeInner}>
        {/* LEFT — Order Ticket */}
        <OrderTicket
          order={orderState.status === 'ready' ? orderState.order : null}
          remainingSeconds={remainingSeconds}
          loading={orderState.status === 'loading'}
        />

        {/* RIGHT — Pizza Builder */}
        <div className={styles.builderPanel}>
          {/* Top controls: Base + Sauce */}
          <div className={styles.controlBar}>
            <div className={styles.controlGroup}>
              <label htmlFor={`${componentId}-base`} className={styles.controlLabel}>
                BASE
              </label>
              <div className={styles.pillGroup} role="group" aria-labelledby={`${componentId}-base-label`}>
                {BASE_OPTIONS.map((b) => (
                  <button
                    key={b}
                    className={`${styles.pillBtn} ${selectedBase === b ? styles.pillBtnActive : ''}`}
                    onClick={() => { setSelectedBase(b); signals.onFirstInteraction(); }}
                    aria-pressed={selectedBase === b}
                    type="button"
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.controlGroup}>
              <label htmlFor={`${componentId}-sauce`} className={styles.controlLabel}>
                SAUCE
              </label>
              <div className={styles.pillGroup} role="group">
                {SAUCE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`${styles.pillBtn} ${styles.pillBtnSauce} ${selectedSauce === s ? styles.pillBtnActive : ''}`}
                    style={selectedSauce === s ? {
                      background: SAUCE_COLORS[s],
                      color: ['alfredo'].includes(s) ? '#5a3e28' : '#fff',
                      borderColor: SAUCE_COLORS[s],
                    } : {}}
                    onClick={() => { setSelectedSauce(s); signals.onFirstInteraction(); }}
                    aria-pressed={selectedSauce === s}
                    type="button"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Pizza Canvas */}
          <PizzaCanvas
            sauce={selectedSauce}
            placedToppings={placedToppings}
            shake={shake}
            onAddTopping={handleAddTopping}
            onRemoveTopping={handleRemoveTopping}
            signals={signals}
            dragIngredient={dragIngredient}
          />

          {/* Ingredient Tray */}
          <IngredientTray
            placedIngredients={placedIngredientNames}
            onDragStart={(ing) => setDragIngredient(ing)}
            onDragEnd={() => setDragIngredient(null)}
            signals={signals}
            onKeyboardPlace={handleKeyboardPlace}
          />

          {/* Action bar */}
          <div className={styles.actionBar}>
            {attempts > 0 && (
              <span className={styles.attemptsWarning} role="alert">
                {MAX_ATTEMPTS - attempts} attempt{MAX_ATTEMPTS - attempts !== 1 ? 's' : ''} remaining
              </span>
            )}
            <div className={styles.actionButtons}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={handleClear}
                type="button"
                disabled={submitting}
              >
                Clear
              </button>
              <motion.button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleSubmit}
                type="button"
                disabled={!canSubmit}
                animate={canSubmit ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                transition={{ duration: 0.3, repeat: canSubmit ? Infinity : 0, repeatDelay: 2 }}
                whileTap={{ scale: 0.96 }}
                aria-label={submitting ? 'Submitting…' : 'Submit order'}
              >
                {submitting ? (
                  <span className={styles.spinner} aria-hidden />
                ) : '🍕 Submit'}
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* Error state */}
      {orderState.status === 'error' && (
        <div className={styles.errorBanner} role="alert">
          Failed to load order: {orderState.message}
          <button className={styles.retryBtn} onClick={fetchOrder} type="button">
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

export default ToppingsChallenge;
