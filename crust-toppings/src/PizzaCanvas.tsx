import React, { useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PlacedTopping } from './types';
import { SAUCE_OVERLAY_COLORS, INGREDIENT_COLORS, SNAP_GRID, MAX_PLACED_TOPPINGS } from './types';
import type { BehavioralSignalHandlers } from './useBehavioralSignals';
import styles from './ToppingsChallenge.module.css';

const CANVAS_SIZE = 280;
const PIZZA_R     = 120;   // pizza radius in SVG units
const CX          = 140;
const CY          = 140;

interface PizzaCanvasProps {
  sauce:           string;
  placedToppings:  PlacedTopping[];
  shake:           boolean;
  onAddTopping:    (ingredient: string, x: number, y: number) => void;
  onRemoveTopping: (id: string) => void;
  signals:         BehavioralSignalHandlers;
  dragIngredient:  string | null;
}

/** Nearest snap grid point (pizza-relative 0–1 coords) */
function snapNearest(rx: number, ry: number): { x: number; y: number } {
  let best = SNAP_GRID[0];
  let bestDist = Infinity;
  for (const p of SNAP_GRID) {
    const d = Math.hypot(rx - p.x, ry - p.y);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

/** Convert SVG-local coords to pizza-relative 0–1 */
function svgToPizzaRel(svgX: number, svgY: number) {
  const rx = (svgX - (CX - PIZZA_R)) / (2 * PIZZA_R);
  const ry = (svgY - (CY - PIZZA_R)) / (2 * PIZZA_R);
  return { rx, ry };
}

/** Is the SVG point inside the pizza circle? */
function insidePizza(svgX: number, svgY: number): boolean {
  return Math.hypot(svgX - CX, svgY - CY) <= PIZZA_R;
}

export const PizzaCanvas: React.FC<PizzaCanvasProps> = ({
  sauce,
  placedToppings,
  shake,
  onAddTopping,
  onRemoveTopping,
  signals,
  dragIngredient,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgPos = useCallback((e: React.DragEvent | React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const pos = getSvgPos(e);
    if (pos) signals.onDragMove(pos.x, pos.y);
  }, [getSvgPos, signals]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const ingredient = e.dataTransfer.getData('ingredient');
    if (!ingredient) return;
    const pos = getSvgPos(e);
    if (!pos) return;

    const crossed = !insidePizza(pos.x, pos.y);
    signals.onDrop(pos.x, pos.y, crossed);

    if (!insidePizza(pos.x, pos.y)) return; // drop outside pizza = ignore
    if (placedToppings.length >= MAX_PLACED_TOPPINGS) return;

    const { rx, ry } = svgToPizzaRel(pos.x, pos.y);
    const snapped = snapNearest(rx, ry);

    // Check grid cell not already occupied
    const occupied = placedToppings.some(
      t => Math.hypot(t.x - snapped.x, t.y - snapped.y) < 0.05
    );
    if (occupied) return;

    onAddTopping(ingredient, snapped.x, snapped.y);
  }, [getSvgPos, placedToppings, onAddTopping, signals]);

  const sauceColor = SAUCE_OVERLAY_COLORS[sauce] ?? 'rgba(214,59,31,0.82)';

  return (
    <motion.div
      className={styles.pizzaCanvasWrap}
      role="region"
      aria-label="Pizza assembly area"
      animate={shake ? { x: [0, -10, 10, -10, 10, 0] } : { x: 0 }}
      transition={shake ? { duration: 0.4, ease: 'easeInOut' } : {}}
    >
      <svg
        ref={svgRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={styles.pizzaSvg}
        aria-hidden="false"
      >
        <defs>
          <radialGradient id="crustGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#F5CBA7" />
            <stop offset="78%"  stopColor="#E8A87C" />
            <stop offset="88%"  stopColor="#D4855A" />
            <stop offset="100%" stopColor="#A0522D" />
          </radialGradient>
          <radialGradient id="doughGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="#FDE8C2" />
            <stop offset="100%" stopColor="#F5CBA7" />
          </radialGradient>
          <clipPath id="pizzaClip">
            <circle cx={CX} cy={CY} r={PIZZA_R - 14} />
          </clipPath>
          {/* Drop-shadow filter for toppings */}
          <filter id="toppingShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Outer crust ring */}
        <circle cx={CX} cy={CY} r={PIZZA_R}      fill="url(#crustGrad)" />
        {/* Dough base */}
        <circle cx={CX} cy={CY} r={PIZZA_R - 14} fill="url(#doughGrad)" />
        {/* Sauce overlay */}
        <circle
          cx={CX} cy={CY} r={PIZZA_R - 16}
          fill={sauceColor}
          style={{ transition: 'fill 0.4s ease' }}
        />
        {/* Cheese speckle texture */}
        {[
          [CX-30, CY-20], [CX+25, CY-35], [CX-10, CY+30],
          [CX+35, CY+20], [CX-40, CY+10], [CX+10, CY-10],
        ].map(([x, y], i) => (
          <ellipse
            key={i}
            cx={x} cy={y}
            rx={12 + (i % 3) * 5} ry={8 + (i % 2) * 4}
            fill="rgba(255,240,180,0.55)"
            clipPath="url(#pizzaClip)"
          />
        ))}

        {/* Placed toppings */}
        <AnimatePresence>
          {placedToppings.map((t) => {
            const svgX = (CX - PIZZA_R) + t.x * 2 * PIZZA_R;
            const svgY = (CY - PIZZA_R) + t.y * 2 * PIZZA_R;
            const color = INGREDIENT_COLORS[t.ingredient] ?? '#ccc';

            return (
              <motion.g
                key={t.id}
                layoutId={`topping-${t.id}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                style={{ cursor: 'pointer' }}
                onClick={() => onRemoveTopping(t.id)}
                role="button"
                aria-label={`Remove ${t.ingredient}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRemoveTopping(t.id);
                  }
                }}
                filter="url(#toppingShadow)"
              >
                <circle
                  cx={svgX} cy={svgY} r={18}
                  fill={color}
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth={2}
                />
                <text
                  x={svgX} y={svgY + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="8"
                  fontWeight="600"
                  fontFamily="var(--font-sans, Inter, sans-serif)"
                  fill="rgba(255,255,255,0.92)"
                  pointerEvents="none"
                >
                  {t.ingredient.slice(0, 4).toUpperCase()}
                </text>
                {/* ✕ remove indicator on hover */}
                <circle cx={svgX + 13} cy={svgY - 13} r={7} fill="rgba(0,0,0,0.35)" />
                <text
                  x={svgX + 13} y={svgY - 13}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="8"
                  fill="#fff"
                  fontWeight="700"
                  pointerEvents="none"
                >×</text>
              </motion.g>
            );
          })}
        </AnimatePresence>

        {/* Drop hint ring when dragging over pizza */}
        {dragIngredient && (
          <circle
            cx={CX} cy={CY} r={PIZZA_R - 2}
            fill="none"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={3}
            strokeDasharray="8 6"
            pointerEvents="none"
          />
        )}

        {/* Crust sesame dots */}
        {Array.from({ length: 16 }, (_, i) => {
          const angle = (i / 16) * 2 * Math.PI;
          const r = PIZZA_R - 7;
          return (
            <circle
              key={i}
              cx={CX + r * Math.cos(angle)}
              cy={CY + r * Math.sin(angle)}
              r={1.8}
              fill="rgba(180,110,60,0.6)"
            />
          );
        })}
      </svg>

      <p className={styles.pizzaHint}>
        {placedToppings.length >= MAX_PLACED_TOPPINGS
          ? 'Max toppings placed — click a topping to remove'
          : 'Drag ingredients onto the pizza · click to remove'}
      </p>
    </motion.div>
  );
};
