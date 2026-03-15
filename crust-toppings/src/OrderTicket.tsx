import React from 'react';
import type { PizzaOrder } from './types';
import { CountdownRing } from './CountdownRing';
import { CHALLENGE_DURATION_S } from './types';
import styles from './ToppingsChallenge.module.css';

interface OrderTicketProps {
  order:            PizzaOrder | null;
  remainingSeconds: number;
  loading:          boolean;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  order,
  remainingSeconds,
  loading,
}) => {
  return (
    <div className={styles.orderTicket}>
      {/* Header row */}
      <div className={styles.ticketHeader}>
        <div className={styles.ticketHeaderLeft}>
          <span className={styles.ticketLogo}>🍕</span>
          <span className={styles.ticketTitle}>ORDER</span>
        </div>
        <CountdownRing
          totalSeconds={CHALLENGE_DURATION_S}
          remainingSeconds={remainingSeconds}
        />
      </div>

      <div className={styles.ticketDivider} />

      {loading && (
        <div className={styles.ticketLoading}>
          <span className={styles.ticketLoadingDot} />
          <span className={styles.ticketLoadingDot} />
          <span className={styles.ticketLoadingDot} />
        </div>
      )}

      {order && !loading && (
        <dl className={styles.ticketBody}>
          <div className={styles.ticketRow}>
            <dt className={styles.ticketLabel}>BASE</dt>
            <dd className={styles.ticketValue}>{order.base.toUpperCase()}</dd>
          </div>

          <div className={styles.ticketRow}>
            <dt className={styles.ticketLabel}>SAUCE</dt>
            <dd className={styles.ticketValue}>{order.sauce.toUpperCase()}</dd>
          </div>

          <div className={styles.ticketDividerDashed} />

          <div className={styles.ticketToppingsBlock}>
            <dt className={styles.ticketLabel}>TOPPINGS</dt>
            {order.toppings.map((t, i) => (
              <dd key={i} className={styles.ticketTopping}>
                <span className={styles.ticketBullet}>›</span>
                {t.toUpperCase()}
              </dd>
            ))}
          </div>
        </dl>
      )}

      <div className={styles.ticketFooter}>
        <span className={styles.ticketFooterText}>MATCH THIS ORDER</span>
        <span className={styles.ticketFooterText}>TO PROCEED</span>
      </div>

      {/* Tear-edge decorative holes */}
      <div className={styles.ticketHoles}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className={styles.ticketHole} />
        ))}
      </div>
    </div>
  );
};
