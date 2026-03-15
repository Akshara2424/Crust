import type { Meta, StoryObj } from '@storybook/react';
import { ToppingsChallenge } from './ToppingsChallenge';
import type { PizzaOrder } from './types';

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_ORDER: PizzaOrder = {
  order_id:   'mock-order-001',
  base:       'sourdough',
  sauce:      'tomato',
  toppings:   ['mushroom', 'pepperoni', 'olive'],
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

const MOCK_JWT_PASS =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiJjcnVzdC1zZXNzaW9uIiwiZGVjaXNpb24iOiJQQVNTIn0' +
  '.mock-signature';

const MOCK_FEATURE_VECTOR = Array.from({ length: 40 }, (_, i) => Math.random());

// ── Mock fetch decorator ──────────────────────────────────────────────────────

/**
 * Replaces global fetch for the duration of the story.
 * Simulates /challenge/order and /challenge/result endpoints.
 */
function withMockFetch(
  mode: 'pass' | 'mismatch' | 'service_error' = 'pass',
) {
  return (Story: React.ComponentType) => {
    const originalFetch = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      await new Promise((r) => setTimeout(r, 400)); // simulate network delay

      if (url.includes('/challenge/order')) {
        return new Response(JSON.stringify(MOCK_ORDER), {
          status:  200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/challenge/result')) {
        if (mode === 'mismatch') {
          return new Response(JSON.stringify({ error: 'ORDER_MISMATCH' }), {
            status:  422,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (mode === 'service_error') {
          return new Response(JSON.stringify({ detail: 'Internal server error' }), {
            status:  500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // PASS
        return new Response(
          JSON.stringify({ jwt: MOCK_JWT_PASS, confidence: 0.91, decision: 'PASS' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return originalFetch(input, init);
    };

    return <Story />;
  };
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta<typeof ToppingsChallenge> = {
  title:     'CRUST/ToppingsChallenge',
  component: ToppingsChallenge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Pizza-based SOFT_CHALLENGE widget. Collects 8 passive behavioral signals ' +
          'during the puzzle and submits them with the challenge result.',
      },
    },
  },
  argTypes: {
    onSuccess: { action: 'onSuccess' },
    onFailure: { action: 'onFailure' },
  },
};

export default meta;
type Story = StoryObj<typeof ToppingsChallenge>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** Happy path — correct submission resolves to PASS */
export const Default: Story = {
  args: {
    softChallengeJwt:      'eyJhbGciOiJSUzI1NiJ9.soft-challenge.sig',
    originalFeatureVector: MOCK_FEATURE_VECTOR,
    apiBase:               '/api/crust',
  },
  decorators: [withMockFetch('pass')],
};

/** All submissions return ORDER_MISMATCH → after 3 fails → onFailure("max_attempts") */
export const AlwaysMismatch: Story = {
  args: {
    softChallengeJwt:      'eyJhbGciOiJSUzI1NiJ9.soft-challenge.sig',
    originalFeatureVector: MOCK_FEATURE_VECTOR,
    apiBase:               '/api/crust',
  },
  decorators: [withMockFetch('mismatch')],
  parameters: {
    docs: {
      description: {
        story: 'Every submission returns ORDER_MISMATCH. After 3 attempts, onFailure("max_attempts") fires.',
      },
    },
  },
};

/** Service error on submit → onFailure("service_error") */
export const ServiceError: Story = {
  args: {
    softChallengeJwt:      'eyJhbGciOiJSUzI1NiJ9.soft-challenge.sig',
    originalFeatureVector: MOCK_FEATURE_VECTOR,
    apiBase:               '/api/crust',
  },
  decorators: [withMockFetch('service_error')],
};

/** Slow-loading order (800 ms delay) — shows loading dots */
export const SlowOrder: Story = {
  args: {
    softChallengeJwt:      'eyJhbGciOiJSUzI1NiJ9.soft-challenge.sig',
    originalFeatureVector: MOCK_FEATURE_VECTOR,
    apiBase:               '/api/crust',
  },
  decorators: [
    (Story) => {
      const orig = window.fetch;
      window.fetch = async (input, init) => {
        await new Promise((r) => setTimeout(r, 800));
        return orig(input, init);
      };
      return <Story />;
    },
  ],
};
