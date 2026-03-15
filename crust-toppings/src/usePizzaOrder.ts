import { useState, useCallback } from 'react';
import type { PizzaOrder, GameSignals } from './types';

type OrderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; order: PizzaOrder }
  | { status: 'error'; message: string };

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'mismatch' }
  | { status: 'error'; message: string };

interface SubmitPayload {
  jwt:                    string;
  original_feature_vector: number[];
  order_id:               string;
  submitted: {
    base:     string;
    sauce:    string;
    toppings: string[];
  };
  game_signals: GameSignals;
}

interface UsePizzaOrderReturn {
  orderState:  OrderState;
  submitState: SubmitState;
  fetchOrder:  () => Promise<void>;
  submitOrder: (payload: SubmitPayload) => Promise<{ decision: string; jwt: string } | null>;
  clearSubmitError: () => void;
}

export function usePizzaOrder(apiBase: string): UsePizzaOrderReturn {
  const [orderState,  setOrderState]  = useState<OrderState>({ status: 'idle' });
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });

  const fetchOrder = useCallback(async () => {
    setOrderState({ status: 'loading' });
    try {
      const res = await fetch(`${apiBase}/challenge/order`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const order: PizzaOrder = await res.json();
      setOrderState({ status: 'ready', order });
    } catch (err) {
      setOrderState({ status: 'error', message: (err as Error).message });
    }
  }, [apiBase]);

  const submitOrder = useCallback(async (
    payload: SubmitPayload,
  ): Promise<{ decision: string; jwt: string } | null> => {
    setSubmitState({ status: 'submitting' });
    try {
      const res = await fetch(`${apiBase}/challenge/result`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data?.error === 'ORDER_MISMATCH') {
          setSubmitState({ status: 'mismatch' });
          return null;
        }
        throw new Error(data?.detail ?? `HTTP ${res.status}`);
      }

      setSubmitState({ status: 'idle' });
      return { decision: data.decision, jwt: data.jwt };
    } catch (err) {
      setSubmitState({ status: 'error', message: (err as Error).message });
      return null;
    }
  }, [apiBase]);

  const clearSubmitError = useCallback(() => {
    setSubmitState({ status: 'idle' });
  }, []);

  return { orderState, submitState, fetchOrder, submitOrder, clearSubmitError };
}
