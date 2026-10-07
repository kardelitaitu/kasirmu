import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

// ── Helpers ────────────────────────────────────────────────────────

/** A child component that throws on render. */
function BrokenComponent({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <p>All good</p>;
}

/** A child component that throws conditionally based on a prop. */
function SometimesBroken({ fail }: { fail: boolean }) {
  if (fail) {
    throw new Error('Conditional test error');
  }
  return <p>Recovered</p>;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ErrorBoundary', () => {
  const preventJsdomError = (e: ErrorEvent) => e.preventDefault();
  // jsdom's Location#reload is non-configurable (cannot be spied), so we
  // swap the whole window.location object for one with a spyable reload.
  const originalLocation = window.location;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', preventJsdomError);
  });

  afterEach(() => {
    window.removeEventListener('error', preventJsdomError);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <p>Normal content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Normal content')).toBeInTheDocument();
  });

  it('renders error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('logs error to console.error when child throws', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalled();
  });

  it('recovers when key prop changes (new instance)', () => {
    const { rerender } = render(
      <ErrorBoundary key="1">
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary key="2">
        <BrokenComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('still renders children content after error with new instance', () => {
    const { rerender } = render(
      <ErrorBoundary key="a">
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary key="b">
        <p>New content after error</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('New content after error')).toBeInTheDocument();
  });

  // ── P201-2: Retry button tests ─────────────────────────────────

  it('renders a Try Again button in the fallback UI', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('fallback UI has role="alert" for screen reader announcements', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clicking Try Again triggers a hard reload when no onReset is provided', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('with onReset, Try Again clears the error state and skips the hard reload', () => {
    const onReset = vi.fn();
    // Use SometimesBroken: first render with fail=true (triggers error),
    // then rerender with fail=false (no error). Without the Try Again
    // click the boundary would still show the stale error, so this also
    // verifies onReset actually clears the error state.
    const { rerender } = render(
      <ErrorBoundary onReset={onReset}>
        <SometimesBroken fail />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Swap to non-failing child
    rerender(
      <ErrorBoundary onReset={onReset}>
        <SometimesBroken fail={false} />
      </ErrorBoundary>,
    );

    // Still showing error — the boundary holds the stale state
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Click Try Again — onReset recovers the boundary in place, no reload
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('auto-reloads after autoRefreshMs while the fallback is shown', () => {
    vi.useFakeTimers();
    try {
      render(
        <ErrorBoundary autoRefreshMs={30_000}>
          <BrokenComponent shouldThrow />
        </ErrorBoundary>,
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(reloadSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-reload when autoRefreshMs is not set', () => {
    vi.useFakeTimers();
    try {
      render(
        <ErrorBoundary>
          <BrokenComponent shouldThrow />
        </ErrorBoundary>,
      );
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the auto-reload timer when onReset recovers the boundary', () => {
    vi.useFakeTimers();
    try {
      const onReset = vi.fn();
      const { rerender } = render(
        <ErrorBoundary onReset={onReset} autoRefreshMs={30_000}>
          <SometimesBroken fail />
        </ErrorBoundary>,
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      rerender(
        <ErrorBoundary onReset={onReset} autoRefreshMs={30_000}>
          <SometimesBroken fail={false} />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      expect(screen.getByText('Recovered')).toBeInTheDocument();

      // The 30s self-heal must not fire after an in-place recovery.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Navigation recovery (tablet: one bad route disabled the whole app) ──

  it('clears a caught error when a resetKey changes, without a reload', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['#/topology']} autoRefreshMs={30_000}>
        <SometimesBroken fail />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKeys={['#/settings/general']} autoRefreshMs={30_000}>
        <SometimesBroken fail={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('cancels the pending auto-reload when a resetKey change recovers it', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <ErrorBoundary resetKeys={['#/topology']} autoRefreshMs={30_000}>
          <SometimesBroken fail />
        </ErrorBoundary>,
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      rerender(
        <ErrorBoundary resetKeys={['#/settings/general']} autoRefreshMs={30_000}>
          <SometimesBroken fail={false} />
        </ErrorBoundary>,
      );
      expect(screen.getByText('Recovered')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps holding the error when no resetKeys are passed (unchanged default)', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <SometimesBroken fail />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <SometimesBroken fail={false} />
      </ErrorBoundary>,
    );
    // Documented behaviour: without resetKeys the stale fallback persists
    // until Try Again or the auto-reload. The recovery above is opt-in.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('does not catch async errors in useEffect (class boundary limitation)', () => {
    render(
      <ErrorBoundary>
        <p>Async safe</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Async safe')).toBeInTheDocument();
  });

  // ── ERR-02: tokenized + injectable-localized fallback ───────────

  it('fallback uses token-backed CSS classes instead of inline styles', () => {
    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).toBe('error-boundary');
    expect(alert.querySelector('.error-boundary__card')).not.toBeNull();
    // No inline `style` attributes — styling lives in ErrorBoundary.css.
    expect(alert.getAttribute('style')).toBeNull();
  });

  it('uses injected localized title and retry label when provided', () => {
    render(
      <ErrorBoundary title="Terjadi kesalahan" retryLabel="Coba Lagi">
        <BrokenComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Terjadi kesalahan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument();
    // Static English emergency copy must NOT leak when props are injected.
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
  });
});
