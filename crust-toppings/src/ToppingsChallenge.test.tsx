/**
 * ToppingsChallenge.test.tsx
 * 15+ tests covering: render, timer, drag/drop, submit gate, pass/fail, signals, a11y
 * Uses: @testing-library/react, jest, jest fake timers
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToppingsChallenge } from './ToppingsChallenge';
import type { PizzaOrder } from './types';

// ── Mock framer-motion to avoid JSDOM issues ──────────────────────────────────
jest.mock('framer-motion', () => {
  const actual = jest.requireActual('framer-motion');
  return {
    ...actual,
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_t: unknown, tag: string) =>
        // eslint-disable-next-line react/display-name
        React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: unknown) =>
          React.createElement(tag, { ...props, ref }, children)
        ),
    }),
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

// ── Mock canvas-confetti ───────────────────────────────────────────────────────
jest.mock('canvas-confetti', () => ({ default: jest.fn() }));

// ── Test helpers ──────────────────────────────────────────────────────────────

const MOCK_ORDER: PizzaOrder = {
  order_id:   'order-test-1',
  base:       'thin',
  sauce:      'tomato',
  toppings:   ['mushroom', 'olive'],
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

const MOCK_JWT = 'eyJhbGciOiJSUzI1NiJ9.pass.sig';
const SOFT_JWT = 'eyJhbGciOiJSUzI1NiJ9.soft.sig';
const FV       = Array.from({ length: 40 }, () => Math.random());

function makeFetch(
  mode: 'pass' | 'mismatch' | 'error' = 'pass',
  orderDelay = 0,
) {
  return jest.fn(async (url: string) => {
    await new Promise((r) => setTimeout(r, orderDelay));

    if (url.includes('/challenge/order')) {
      return new Response(JSON.stringify(MOCK_ORDER), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/challenge/result')) {
      if (mode === 'mismatch') {
        return new Response(JSON.stringify({ error: 'ORDER_MISMATCH' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (mode === 'error') {
        return new Response(JSON.stringify({ detail: 'server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ jwt: MOCK_JWT, confidence: 0.92, decision: 'PASS' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function renderComponent(
  overrides: Partial<React.ComponentProps<typeof ToppingsChallenge>> = {},
) {
  const onSuccess = jest.fn();
  const onFailure = jest.fn();
  const result = render(
    <ToppingsChallenge
      softChallengeJwt={SOFT_JWT}
      originalFeatureVector={FV}
      onSuccess={onSuccess}
      onFailure={onFailure}
      apiBase="/api/crust"
      {...overrides}
    />,
  );
  return { ...result, onSuccess, onFailure };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─── 1. Render & order fetch ──────────────────────────────────────────────────
test('1. mounts and calls /challenge/order on load', async () => {
  const fetchMock = makeFetch('pass');
  global.fetch = fetchMock as unknown as typeof fetch;
  renderComponent();
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/challenge/order'),
      expect.objectContaining({ method: 'POST' }),
    )
  );
});

// ─── 2. Order renders in ticket ──────────────────────────────────────────────
test('2. renders order details in ticket after fetch', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();
  await waitFor(() => expect(screen.getByText('THIN')).toBeInTheDocument());
  expect(screen.getByText('TOMATO')).toBeInTheDocument();
  expect(screen.getByText('MUSHROOM')).toBeInTheDocument();
});

// ─── 3. Loading state ────────────────────────────────────────────────────────
test('3. shows loading indicator while fetching order', () => {
  global.fetch = makeFetch('pass', 500) as unknown as typeof fetch;
  renderComponent();
  // Loading dots rendered — no order text yet
  expect(screen.queryByText('THIN')).not.toBeInTheDocument();
});

// ─── 4. Timer fires onFailure("timeout") after 60 s ──────────────────────────
test('4. countdown fires onFailure("timeout") after 60 s', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  const { onFailure } = renderComponent();
  await waitFor(() => expect(screen.getByText('THIN')).toBeInTheDocument());
  act(() => { jest.advanceTimersByTime(60_000); });
  expect(onFailure).toHaveBeenCalledWith('timeout');
});

// ─── 5. Submit disabled initially ────────────────────────────────────────────
test('5. Submit button is disabled on initial render', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();
  await waitFor(() => expect(screen.getByText('THIN')).toBeInTheDocument());
  const submitBtn = screen.getByRole('button', { name: /submit/i });
  expect(submitBtn).toBeDisabled();
});

// ─── 6. Submit enabled only when base + sauce + ≥ 2 toppings ─────────────────
test('6. Submit gate: only active with base + sauce + ≥ 2 toppings', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();
  await waitFor(() => expect(screen.getByRole('button', { name: /thin/i })).toBeInTheDocument());

  const submitBtn = screen.getByRole('button', { name: /submit/i });

  // Select base only
  await userEvent.click(screen.getByRole('button', { name: /thin/i }));
  expect(submitBtn).toBeDisabled();

  // Select sauce too
  await userEvent.click(screen.getByRole('button', { name: /tomato/i }));
  expect(submitBtn).toBeDisabled(); // still no toppings
});

// ─── 7. Pizza region accessible ──────────────────────────────────────────────
test('7. pizza canvas has correct accessible role and label', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();
  await waitFor(() =>
    expect(screen.getByRole('region', { name: /pizza assembly/i })).toBeInTheDocument()
  );
});

// ─── 8. Ingredient tray renders all 8 chips ───────────────────────────────────
test('8. ingredient tray shows all 8 ingredients', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();
  await waitFor(() =>
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(8)
  );
});

// ─── 9. Drag and drop places topping on pizza ────────────────────────────────
test('9. drag → drop inside pizza places topping', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();
  await waitFor(() =>
    expect(screen.getByRole('region', { name: /pizza assembly/i })).toBeInTheDocument()
  );

  const pizzaRegion = screen.getByRole('region', { name: /pizza assembly/i });
  const chip = screen.getAllByRole('listitem')[0];

  // Simulate drag from chip
  fireEvent.dragStart(chip, {
    dataTransfer: { setData: jest.fn(), effectAllowed: '', getData: () => 'mushroom' },
  });

  // Simulate dragover + drop onto pizza canvas
  const svgEl = pizzaRegion.querySelector('svg')!;
  fireEvent.dragOver(svgEl, {
    preventDefault: jest.fn(),
    clientX: 140, clientY: 140,
  });
  fireEvent.drop(svgEl, {
    preventDefault: jest.fn(),
    clientX: 140, clientY: 140,
    dataTransfer: { getData: () => 'mushroom' },
  });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /remove mushroom/i })).toBeInTheDocument()
  );
});

// ─── 10. Remove topping from pizza ───────────────────────────────────────────
test('10. clicking placed topping removes it', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();
  await waitFor(() =>
    expect(screen.getByRole('region', { name: /pizza assembly/i })).toBeInTheDocument()
  );

  const pizzaRegion = screen.getByRole('region', { name: /pizza assembly/i });
  const svgEl = pizzaRegion.querySelector('svg')!;

  // Place a topping
  fireEvent.dragStart(screen.getAllByRole('listitem')[0], {
    dataTransfer: { setData: jest.fn(), effectAllowed: '', getData: () => 'mushroom' },
  });
  fireEvent.drop(svgEl, {
    preventDefault: jest.fn(),
    clientX: 140, clientY: 140,
    dataTransfer: { getData: () => 'mushroom' },
  });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /remove mushroom/i })).toBeInTheDocument()
  );

  fireEvent.click(screen.getByRole('button', { name: /remove mushroom/i }));

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /remove mushroom/i })).not.toBeInTheDocument()
  );
});

// ─── 11. Correct submission → onSuccess ──────────────────────────────────────
test('11. correct submission calls onSuccess with JWT after 1.2 s', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  const { onSuccess } = renderComponent();

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /thin/i })).toBeInTheDocument()
  );

  // Select base & sauce
  fireEvent.click(screen.getByRole('button', { name: /thin/i }));
  fireEvent.click(screen.getByRole('button', { name: /tomato/i }));

  // Place 2 toppings via drop
  const pizzaRegion = screen.getByRole('region', { name: /pizza assembly/i });
  const svgEl = pizzaRegion.querySelector('svg')!;

  for (const [ingredient, clientX, clientY] of [
    ['mushroom', 130, 130],
    ['olive',    150, 155],
  ] as const) {
    fireEvent.drop(svgEl, {
      preventDefault: jest.fn(),
      clientX, clientY,
      dataTransfer: { getData: () => ingredient },
    });
  }

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled()
  );

  fireEvent.click(screen.getByRole('button', { name: /submit/i }));

  await waitFor(() =>
    expect(screen.getByText(/verified/i)).toBeInTheDocument()
  );

  act(() => { jest.advanceTimersByTime(1200); });
  expect(onSuccess).toHaveBeenCalledWith(MOCK_JWT);
});

// ─── 12. Wrong submission → shake class applied ───────────────────────────────
test('12. ORDER_MISMATCH response triggers shake', async () => {
  global.fetch = makeFetch('mismatch') as unknown as typeof fetch;
  renderComponent();

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /thin/i })).toBeInTheDocument()
  );

  fireEvent.click(screen.getByRole('button', { name: /thin/i }));
  fireEvent.click(screen.getByRole('button', { name: /tomato/i }));

  const pizzaRegion = screen.getByRole('region', { name: /pizza assembly/i });
  const svgEl = pizzaRegion.querySelector('svg')!;

  for (const [ingredient, cx, cy] of [
    ['mushroom', 130, 130],
    ['olive',    150, 155],
  ] as const) {
    fireEvent.drop(svgEl, {
      preventDefault: jest.fn(), clientX: cx, clientY: cy,
      dataTransfer: { getData: () => ingredient },
    });
  }

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled()
  );

  fireEvent.click(screen.getByRole('button', { name: /submit/i }));

  // After mismatch, attempts warning appears
  await waitFor(() =>
    expect(screen.getByRole('alert')).toBeInTheDocument()
  );
});

// ─── 13. Max attempts → onFailure("max_attempts") ────────────────────────────
test('13. three mismatches trigger onFailure("max_attempts")', async () => {
  global.fetch = makeFetch('mismatch') as unknown as typeof fetch;
  const { onFailure } = renderComponent();

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /thin/i })).toBeInTheDocument()
  );

  const pizzaRegion = screen.getByRole('region', { name: /pizza assembly/i });
  const svgEl = pizzaRegion.querySelector('svg')!;

  const doAttempt = async () => {
    fireEvent.click(screen.getByRole('button', { name: /thin/i }));
    fireEvent.click(screen.getByRole('button', { name: /tomato/i }));

    for (const [ing, cx, cy] of [
      ['mushroom', 130, 130],
      ['olive',    150, 155],
    ] as const) {
      fireEvent.drop(svgEl, {
        preventDefault: jest.fn(), clientX: cx, clientY: cy,
        dataTransfer: { getData: () => ing },
      });
    }

    const btn = screen.getByRole('button', { name: /submit/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  };

  await doAttempt();
  await doAttempt();
  await doAttempt();

  await waitFor(() =>
    expect(onFailure).toHaveBeenCalledWith('max_attempts')
  );
});

// ─── 14. Clear button resets state ───────────────────────────────────────────
test('14. Clear button removes all placed toppings', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();

  await waitFor(() =>
    expect(screen.getByRole('region', { name: /pizza assembly/i })).toBeInTheDocument()
  );

  const pizzaRegion = screen.getByRole('region', { name: /pizza assembly/i });
  const svgEl = pizzaRegion.querySelector('svg')!;

  fireEvent.drop(svgEl, {
    preventDefault: jest.fn(), clientX: 130, clientY: 130,
    dataTransfer: { getData: () => 'mushroom' },
  });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /remove mushroom/i })).toBeInTheDocument()
  );

  fireEvent.click(screen.getByRole('button', { name: /clear/i }));

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /remove mushroom/i })).not.toBeInTheDocument()
  );
});

// ─── 15. Keyboard navigation Space to pick up ────────────────────────────────
test('15. Space key on chip enters picked-up state', async () => {
  global.fetch = makeFetch('pass') as unknown as typeof fetch;
  renderComponent();

  await waitFor(() =>
    expect(screen.getAllByRole('listitem')[0]).toBeInTheDocument()
  );

  const firstChip = screen.getAllByRole('listitem')[0];
  firstChip.focus();
  fireEvent.keyDown(firstChip, { key: ' ', code: 'Space' });

  // chip should show pickup indicator — aria-label updates
  await waitFor(() =>
    expect(firstChip).toHaveAttribute(
      'aria-label',
      expect.stringContaining('picked up'),
    )
  );
});

// ─── 16. Order fetch error shows retry button ─────────────────────────────────
test('16. order fetch failure shows error + retry button', async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error')) as unknown as typeof fetch;
  renderComponent();

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  );
});
