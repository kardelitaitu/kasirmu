// ── LazyBoundary tests ────────────────────────────────────────────
//
// Covers the shared Suspense boundary (PERF-01 route-level code
// splitting) used across AppShell / TabletAppShell / widget hosts:
//   - default fallback renders a polite "Loading…" status region
//   - a custom fallback (e.g. skeleton) replaces the default
//   - once the lazy chunk resolves, the fallback unmounts and the
//     content renders
//
// The test uses a manually-suspending component whose promise we can
// resolve inside `act()`, avoiding any reliance on real dynamic
// imports in the test environment.

import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import { LazyBoundary } from '@/components/LazyBoundary';

// ── Controllable suspender ────────────────────────────────────────
//
// `resolveSuspense()` flips the guard and resolves the pending promise,
// letting the Suspense fallback swap to the real content.

let resolveSuspense!: () => void;
let suspend = true;

function makeSuspender() {
  const Component = () => {
    if (suspend) {
      throw new Promise<void>((resolve) => {
        resolveSuspense = () => {
          suspend = false;
          resolve();
        };
      });
    }
    return <div>Lazy content loaded</div>;
  };
  return Component;
}

describe('LazyBoundary (PERF-01)', () => {
  afterEach(() => {
    suspend = true;
  });

  it('renders the default polite loading fallback while children suspend', async () => {
    const Suspender = makeSuspender();
    await renderInAct(
      withFluent(
        <LazyBoundary>
          <Suspender />
        </LazyBoundary>,
      ),
    );
    const fallback = screen.getByText('Loading…');
    expect(fallback).toBeInTheDocument();
    const region = fallback.closest('[role="status"]');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('renders a custom fallback when provided', async () => {
    const Suspender = makeSuspender();
    await renderInAct(
      withFluent(
        <LazyBoundary fallback={<div data-testid="skeleton">Skeleton…</div>}>
          <Suspender />
        </LazyBoundary>,
      ),
    );
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('renders children directly when they do not suspend', async () => {
    await renderInAct(
      withFluent(
        <LazyBoundary>
          <div>Already loaded</div>
        </LazyBoundary>,
      ),
    );
    expect(screen.getByText('Already loaded')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('swaps the fallback for the content once the lazy chunk resolves', async () => {
    const Suspender = makeSuspender();
    await renderInAct(
      withFluent(
        <LazyBoundary>
          <Suspender />
        </LazyBoundary>,
      ),
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await act(async () => {
      resolveSuspense();
    });

    await waitFor(() => {
      expect(screen.getByText('Lazy content loaded')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });
});
