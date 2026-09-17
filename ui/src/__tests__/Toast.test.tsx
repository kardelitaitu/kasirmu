// ── useToast contract tests ──────────────────────────────────────
//
// Pins the contract for `useAnimatedToastQueue` + the canonical
// ToastProvider at `@/components/Toast`. Replaces the
// older stale `useToast.test.tsx` which imported from the dead
// `@/hooks/useToast` path against an older API.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import { ToastProvider, useToast } from '@/components/Toast';

const ftl = `
toast-dismiss-aria = Dismiss notification
toast-notifications-aria = Notifications
pos-no-barcode-match = No product or bundle matches this barcode
`;

const bundle = new FluentBundle('en');
bundle.addResource(new FluentResource(ftl));
const l10n = new ReactLocalization([bundle]);

/**
 * Test consumer that exposes the API + renders assertions.
 * Mirrors the older test consumer shape so we keep parity with
 * the API regressions we want to lock in.
 *
 * The id counter lives in `useRef` (not `let`) because React
 * re-renders this consumer on every Toast state update. A plain
 * `let` would reset on each render and produce duplicate ids
 * when the same button is clicked twice.
 */
function TestConsumer() {
  const { addToast, removeToast, clearToasts } = useToast();
  const counterRef = useRef(0);
  const next = () => `t-${++counterRef.current}`;
  return (
    <div>
      <button
        type="button"
        data-testid="add-info"
        onClick={() => addToast({ id: next(), type: 'info', message: 'Info toast' })}
      >
        Add info
      </button>
      <button
        type="button"
        data-testid="add-success"
        onClick={() => addToast({ id: next(), type: 'success', message: 'Success!' })}
      >
        Add success
      </button>
      <button
        type="button"
        data-testid="add-error"
        onClick={() => addToast({ id: next(), type: 'error', message: 'Failed!' })}
      >
        Add error
      </button>
      <button
        type="button"
        data-testid="add-warning"
        onClick={() => addToast({ id: next(), type: 'warning', message: 'Careful' })}
      >
        Add warning
      </button>
      <button
        type="button"
        data-testid="add-persistent"
        onClick={() =>
          addToast({ id: next(), type: 'info', message: 'No auto-dismiss', duration: 0 })
        }
      >
        Add persistent
      </button>
      <button type="button" data-testid="clear-all" onClick={() => clearToasts()}>
        Clear all
      </button>
      <button
        type="button"
        data-testid="remove-first"
        onClick={() => {
          const el = document.querySelector('.toast');
          const id = el?.getAttribute('data-toast-id');
          if (id) removeToast(id);
        }}
      >
        Remove first
      </button>
    </div>
  );
}

function renderToastProvider() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    </LocalizationProvider>,
  );
}

describe('ToastProvider + useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders no container when there are zero toasts', () => {
    renderToastProvider();
    expect(document.querySelector('.toast-container')).toBeNull();
  });

  it('adds a toast of the requested type with the toast--{type} class', () => {
    renderToastProvider();
    fireEvent.click(screen.getByTestId('add-success'));
    expect(document.querySelectorAll('.toast').length).toBe(1);
    expect(document.querySelector('.toast--success')).toBeTruthy();
    expect(document.querySelector('.toast__message')?.textContent).toBe('Success!');
  });

  it('appends multiple toasts in insertion order', () => {
    renderToastProvider();
    fireEvent.click(screen.getByTestId('add-info'));
    fireEvent.click(screen.getByTestId('add-error'));
    fireEvent.click(screen.getByTestId('add-warning'));
    expect(document.querySelectorAll('.toast').length).toBe(3);
    const variants = [
      ...document.querySelectorAll('.toast'),
    ].map((el) => [...el.classList].find((c) => c.startsWith('toast--')) ?? '');
    expect(variants).toEqual(['toast--info', 'toast--error', 'toast--warning']);
  });

  it('throws when useToast is used outside a ToastProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventJsdomError = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', preventJsdomError);
    expect(() => render(<TestConsumer />)).toThrow('useToast must be used within a ToastProvider');
    window.removeEventListener('error', preventJsdomError);
    spy.mockRestore();
  });

  it('renders the dismiss button with the aria-label from FTL', () => {
    renderToastProvider();
    fireEvent.click(screen.getByTestId('add-info'));
    const btn = document.querySelector('.toast__dismiss');
    expect(btn?.getAttribute('aria-label')).toBe('Dismiss notification');
  });

  describe('manual dismiss (race-safe per-item fade)', () => {
    it('applies the toast--exiting class immediately on dismiss click', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('remove-first'));

      const toast = document.querySelector('.toast');
      expect(toast?.classList.contains('toast--exiting')).toBe(true);
      // Still in the DOM during the fade.
      expect(document.querySelectorAll('.toast').length).toBe(1);
    });

    it('removes the toast from the DOM after the 200 ms fade', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('remove-first'));

      // Mid-fade: still present with .--exiting
      act(() => { vi.advanceTimersByTime(199); });
      expect(document.querySelectorAll('.toast').length).toBe(1);

      // Timer fires at 200 ms — fade ends, toast unmounts.
      act(() => { vi.advanceTimersByTime(1); });
      expect(document.querySelectorAll('.toast').length).toBe(0);
      expect(document.querySelector('.toast-container')).toBeNull();
    });

    it('disables the dismiss button during the fade (no double-click race)', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('remove-first'));

      const btn = document.querySelector<HTMLButtonElement>('.toast__dismiss');
      expect(btn?.disabled).toBe(true);
    });

    it('marks aria-busy while the fade is playing', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('remove-first'));

      const toast = document.querySelector('.toast');
      expect(toast?.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('auto-dismiss (per-item TTL via getAutoDismissMs)', () => {
    it('keeps the toast visible until 4000 ms, then fades for 200 ms', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      expect(document.querySelectorAll('.toast').length).toBe(1);

      // 3999 ms — still in entry state (no fading class yet).
      act(() => { vi.advanceTimersByTime(3999); });
      expect(document.querySelectorAll('.toast').length).toBe(1);
      expect(document.querySelector('.toast')?.classList.contains('toast--exiting')).toBe(false);

      // +1 ms = 4000 ms TTL fires — fade begins.
      act(() => { vi.advanceTimersByTime(1); });
      expect(document.querySelector('.toast')?.classList.contains('toast--exiting')).toBe(true);

      // After 200 ms fade, toast is unmounted.
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });

    it('does not auto-dismiss when duration=0 (persistent toast)', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-persistent'));

      act(() => { vi.advanceTimersByTime(10_000); });
      expect(document.querySelectorAll('.toast').length).toBe(1);
    });

    it('cancels the auto-dismiss when the user clicks dismiss manually', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      // 3000 ms before clicking — auto-dismiss is still 1000 ms away.
      act(() => { vi.advanceTimersByTime(3000); });
      fireEvent.click(screen.getByTestId('remove-first'));

      // User-initiated fade completes at 3200 (3000 + 200).
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelectorAll('.toast').length).toBe(0);

      // Auto-dismiss timer was cancelled — advancing past the
      // original 4000 ms TTL must not throw or cause double-removal.
      act(() => { vi.advanceTimersByTime(800); });
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });
  });

  describe('clearToasts (race-safe collective fade)', () => {
    it('applies toast--exiting to all visible toasts immediately', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('add-error'));
      fireEvent.click(screen.getByTestId('add-warning'));
      expect(document.querySelectorAll('.toast').length).toBe(3);

      fireEvent.click(screen.getByTestId('clear-all'));
      const exiting = document.querySelectorAll('.toast--exiting');
      expect(exiting.length).toBe(3);
      // All toasts still in DOM (fading).
      expect(document.querySelectorAll('.toast').length).toBe(3);
    });

    it('removes all toasts after the 200 ms fade when no concurrent enqueues', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('add-error'));
      fireEvent.click(screen.getByTestId('clear-all'));

      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });

    it('preserves a toast enqueued DURING the collective fade (race-safety)', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('add-error'));
      fireEvent.click(screen.getByTestId('clear-all'));

      // Mid-fade: enqueue `add-success` whose id was NOT in the
      // dismiss-time snapshot. The id-set compare in the timer
      // body detects the divergence and the new toast survives.
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.click(screen.getByTestId('add-success'));

      act(() => { vi.advanceTimersByTime(100); });

      // Original two should be gone; the new success should survive.
      const remaining = [...document.querySelectorAll('.toast')].map(
        (el) => [...el.classList].find((c) => c.startsWith('toast--')) ?? '',
      );
      expect(remaining).toEqual(['toast--success']);
    });

    it('debounces a second clearToasts call (the new snapshot supersedes)', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('add-error'));
      fireEvent.click(screen.getByTestId('clear-all'));

      // Mid-fade (T+50): enqueue a third toast, then clearToasts
      // again. The two fireEvent.click calls are intentionally NOT
      // wrapped in an outer act(...) so each commits independently —
      // RTL internally wraps each fireEvent in its own act, so the
      // React commit + itemsRef refresh happen between the two
      // clicks. The second clearAll's snapshot then includes the
      // fresh `add-warning` and the timer removes all three.
      act(() => { vi.advanceTimersByTime(50); });
      fireEvent.click(screen.getByTestId('add-warning'));
      fireEvent.click(screen.getByTestId('clear-all'));

      // Advance past the SECOND timer's deadline (200 ms from second clearAll).
      act(() => { vi.advanceTimersByTime(300); });

      // All three (info, error, warning) were in the second snapshot, all gone.
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });
  });

  describe('parallel per-item fades', () => {
    it('fades one toast while another toast (persistent) stays put', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('add-persistent'));
      expect(document.querySelectorAll('.toast').length).toBe(2);

      // Manually dismiss the first (info) toast.
      fireEvent.click(screen.getByTestId('remove-first'));
      // Wait for the fade to complete.
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelectorAll('.toast').length).toBe(1);
      // The persistent one is still there, no exit class.
      const survivor = document.querySelector('.toast');
      expect(survivor?.classList.contains('toast--exiting')).toBe(false);
    });

    it('clears aria-busy on the surviving toast(s) after a sibling fade completes', () => {
      renderToastProvider();
      fireEvent.click(screen.getByTestId('add-info'));
      fireEvent.click(screen.getByTestId('add-persistent'));
      fireEvent.click(screen.getByTestId('remove-first'));

      const all = [...document.querySelectorAll('.toast')];
      const exitingCount = all.filter((el) => el.getAttribute('aria-busy') === 'true').length;
      expect(exitingCount).toBe(1); // only the fading one is aria-busy

      act(() => { vi.advanceTimersByTime(200); });

      const surviving = document.querySelector('.toast');
      expect(surviving?.getAttribute('aria-busy')).toBe('false');
    });
  });
});
