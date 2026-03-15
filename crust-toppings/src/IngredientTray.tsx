import React, { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { INGREDIENT_COLORS, INGREDIENT_TEXT_COLORS, ALL_INGREDIENTS } from './types';
import type { BehavioralSignalHandlers } from './useBehavioralSignals';
import styles from './ToppingsChallenge.module.css';

interface IngredientTrayProps {
  placedIngredients: string[];   // ingredient names already on pizza
  onDragStart:       (ingredient: string) => void;
  onDragEnd:         () => void;
  signals:           BehavioralSignalHandlers;
  /** Keyboard-place: fires when user selects via keyboard */
  onKeyboardPlace:   (ingredient: string) => void;
}

export const IngredientTray: React.FC<IngredientTrayProps> = ({
  placedIngredients,
  onDragStart,
  onDragEnd,
  signals,
  onKeyboardPlace,
}) => {
  const [pickedUp, setPickedUp] = useState<string | null>(null);

  const handleDragStart = useCallback((
    e: React.DragEvent<HTMLDivElement>,
    ingredient: string,
    x: number, y: number,
  ) => {
    e.dataTransfer.setData('ingredient', ingredient);
    e.dataTransfer.effectAllowed = 'copy';
    signals.onDragStart(x, y);
    onDragStart(ingredient);
  }, [signals, onDragStart]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    signals.onDrop(e.clientX, e.clientY, false); // approximate
    onDragEnd();
  }, [signals, onDragEnd]);

  const handleKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLDivElement>,
    ingredient: string,
  ) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (pickedUp === ingredient) {
        // Second Space = place (drop at centre)
        onKeyboardPlace(ingredient);
        setPickedUp(null);
        signals.onFirstInteraction();
      } else {
        setPickedUp(ingredient);
        signals.onFirstInteraction();
      }
    }
    if (e.key === 'Escape') setPickedUp(null);
  }, [pickedUp, onKeyboardPlace, signals]);

  return (
    <div className={styles.ingredientTray} role="list" aria-label="Ingredient tray">
      {ALL_INGREDIENTS.map((ingredient) => {
        const placed   = placedIngredients.includes(ingredient);
        const isPickup = pickedUp === ingredient;
        const bg       = INGREDIENT_COLORS[ingredient] ?? '#ccc';
        const fg       = INGREDIENT_TEXT_COLORS[ingredient] ?? '#fff';

        return (
          <motion.div
            key={ingredient}
            role="listitem"
            className={`${styles.ingredientChip} ${placed ? styles.chipPlaced : ''} ${isPickup ? styles.chipPickedUp : ''}`}
            style={{
              '--chip-bg': bg,
              '--chip-fg': fg,
            } as React.CSSProperties}
            draggable={!placed}
            aria-label={`${ingredient}${placed ? ' (placed)' : ''}${isPickup ? ' (picked up — press Space to place)' : ''}`}
            aria-disabled={placed}
            tabIndex={placed ? -1 : 0}
            onDragStart={(e) => {
              if (placed) { e.preventDefault(); return; }
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              handleDragStart(e as unknown as React.DragEvent<HTMLDivElement>, ingredient, rect.x, rect.y);
            }}
            onDragEnd={(e) => handleDragEnd(e as unknown as React.DragEvent<HTMLDivElement>)}
            onKeyDown={(e) => handleKeyDown(e as unknown as React.KeyboardEvent<HTMLDivElement>, ingredient)}
            whileHover={!placed ? { scale: 1.08, y: -2 } : {}}
            whileTap={!placed ? { scale: 0.95 } : {}}
            animate={{
              opacity:   placed ? 0.38 : 1,
              scale:     isPickup ? 1.12 : 1,
              boxShadow: isPickup
                ? '0 0 0 2px #0588f0, 0 4px 12px rgba(0,0,0,0.18)'
                : placed
                  ? 'none'
                  : '0 1px 4px rgba(0,0,0,0.12)',
            }}
            transition={{ duration: 0.15 }}
          >
            <span
              className={styles.chipDot}
              style={{ background: bg }}
              aria-hidden
            />
            <span className={styles.chipLabel}>{ingredient}</span>
            {placed && <span className={styles.chipCheckmark} aria-hidden>✓</span>}
            {isPickup && (
              <span className={styles.chipPickupHint} aria-hidden>↑</span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
};
