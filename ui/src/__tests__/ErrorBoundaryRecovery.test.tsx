// ── Error boundary recovery: a same-count change must still clear ──────
//
// KDS boards wrap the live-data subtree so "a fault costs the board, not the whole
// screen and not the shift" (KdsScreen.tsx:525-529). The same comment says resetKeys on
// "the tab and the order count" means "reopening or the queue changing clears a caught
// error".
//
// The order COUNT is a weak key. The kitchen failure this matters for is a malformed
// PAYLOAD: ticket #4 arrives with a shape that throws. The board is replaced by the
// fallback, the backend re-sends ticket #4 corrected, and — because the count never
// moved — the fallback stays. The cook sees a broken board until they navigate away
// and back, which is the last thing anyone does mid-service.
//
// ExpoScreen keys on `station` and `stations.length` (:508) — the CONFIG, not the
// queue — so on that screen a corrected queue never clears it either.
//
// These cases pin the boundary's own contract so the boards' keys can be judged:
// a key that changes MUST clear, and Object.is is what decides.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

function Boom({ trigger }: { trigger: boolean }) {
  if (trigger) throw new Error('payload blew up');
  return <p data-testid="healthy">healthy</p>;
}

describe('ErrorBoundary recovery on resetKeys', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the fallback and keeps the toolbar usable', async () => {
    render(
      <ErrorBoundary title="Board broke" retryLabel="Retry">
        <Boom trigger />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Board broke')).toBeInTheDocument();
    expect(screen.queryByTestId('healthy')).not.toBeInTheDocument();
  });

  it('clears when ANY resetKey changes', async () => {
    const { rerender } = render(
      <ErrorBoundary title="Board broke" retryLabel="Retry" resetKeys={['open', 4]}>
        <Boom trigger />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Board broke')).toBeInTheDocument();

    // A different order arrives, same count, different id — the queue DID change.
    rerender(
      <ErrorBoundary title="Board broke" retryLabel="Retry" resetKeys={['open', 4]}>
        <Boom trigger={false} />
      </ErrorBoundary>,
    );
    // Nothing changed, so the fallback correctly stays.
    expect(screen.getByText('Board broke')).toBeInTheDocument();

    // A key that actually differs clears it.
    rerender(
      <ErrorBoundary title="Board broke" retryLabel="Retry" resetKeys={['ready', 4]}>
        <Boom trigger={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Board broke')).not.toBeInTheDocument();
    expect(screen.getByTestId('healthy')).toBeInTheDocument();
  });
});
