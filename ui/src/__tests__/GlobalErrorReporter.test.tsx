import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GlobalErrorReporter } from '@/components/GlobalErrorReporter';
import { withToastProviders } from '@/__tests__/test-utils/providers';
import sharedFtl from '@/locales/shared.ftl?raw';

/**
 * ERR-01 — global async-failure reporting layer tests.
 *
 * The React error boundary cannot catch `window.error` / `unhandledrejection`
 * failures. These tests pin the reporter's contract: expected typed API
 * failures are logged but NOT toasted (screens handle them), while unexpected
 * defects surface a recoverable toast with localized copy.
 *
 * jsdom lacks a `PromiseRejectionEvent` constructor, so rejections are
 * dispatched as plain `Event`s with the `reason` attached (the reporter
 * reads `event.reason` defensively and falls back to the event itself).
 */
describe('GlobalErrorReporter (ERR-01)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mountReporter() {
    render(withToastProviders(<GlobalErrorReporter />, sharedFtl));
  }

  /** Dispatch an `unhandledrejection`-shaped event without the jsdom-missing ctor. */
  function fireRejection(reason: unknown) {
    const evt = new Event('unhandledrejection', { cancelable: true }) as Event & { reason?: unknown };
    evt.reason = reason;
    window.dispatchEvent(evt);
  }

  it('surfaces a recoverable toast for an unhandled rejection (unexpected defect)', () => {
    mountReporter();
    act(() => {
      fireRejection(new Error('boom in a timer callback'));
    });
    expect(screen.getByText(/Something unexpected happened/)).toBeInTheDocument();
  });


  it('attaches actionable detail to the toast, not just a generic message', () => {
    // The other cases assert the toast APPEARS; none checked that it carries enough to
    // debug with. `Toast.detail` renders behind a "Show detail" toggle and is what an
    // operator can copy into a support ticket, so the reporter's contract — source,
    // timestamp, and the extracted error info — is worth pinning directly.
    //
    // Recorded in round 36 while correcting `toastErrorQuality.test.ts`, whose header
    // claimed this was covered there. It was not: that file never mounts the reporter.
    mountReporter();
    act(() => {
      fireRejection(new Error('boom in a timer callback'));
    });

    // The detail is rendered into a <pre> only once the toggle is expanded.
    const toggle = screen.getByRole('button', { name: /show detail/i });
    act(() => {
      toggle.click();
    });

    const pre = document.querySelector('.toast__detail');
    expect(pre, 'the toast rendered no detail section').not.toBeNull();
    const text = pre!.textContent ?? '';
    expect(text).toContain('Source:');
    expect(text).toContain('Time:');
    // `errorDetail()` contributes the message for a plain Error.
    expect(text).toContain('boom in a timer callback');
  });

  it('logs but does NOT toast expected typed AppError failures', () => {
    mountReporter();
    act(() => {
      fireRejection({ kind: 'permissionDenied', message: 'owner only' });
    });
    expect(screen.queryByText(/Something unexpected happened/)).not.toBeInTheDocument();
    expect(console.warn).toHaveBeenCalled();
  });

  it('surfaces a recoverable toast for an uncaught window error', () => {
    mountReporter();
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'Uncaught TypeError: cannot read properties of undefined',
        cancelable: true,
      }));
    });
    expect(screen.getByText(/Something unexpected happened/)).toBeInTheDocument();
  });

  it('skips expected validation failures logged at the IPC boundary', () => {
    mountReporter();
    act(() => {
      fireRejection({ kind: 'invalid', message: 'rate must be positive' });
    });
    expect(screen.queryByText(/Something unexpected happened/)).not.toBeInTheDocument();
  });

  it('cleans up listeners on unmount', () => {
    const { unmount } = render(withToastProviders(<GlobalErrorReporter />, sharedFtl));
    unmount();
    act(() => {
      fireRejection(new Error('after unmount'));
    });
    expect(screen.queryByText(/Something unexpected happened/)).not.toBeInTheDocument();
  });
});
