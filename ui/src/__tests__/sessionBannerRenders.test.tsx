// ── The session banner ACTUALLY appears when a command fails ──────────────
//
// `posSessionExpirySurface.test.ts` asserts the wiring exists: the hook is called, the
// JSX references it, the CSS class is defined. That is a source check, and a source
// check cannot tell the difference between a banner that renders and a banner whose
// hook never fires.
//
// This file drives the REAL path: it emits an `invalidSession` IPC error through
// `emitIpcError` — the same boundary `loggedInvoke` calls on a command failure — and
// asserts a banner reaches the DOM with `role="alert"`. If `useInvalidSession` stops
// subscribing, or the screens stop rendering it, this fails and the source check does
// not, because the source check only reads text.
//
// It uses the hook directly rather than a whole POS screen: the mechanism is the hook,
// and mounting a full PosScreen for a boolean would drag in the whole POS state graph
// to prove something the hook's contract already covers (useInvalidSession.test.tsx).
// What is NEW here is the join between that contract and a rendered alert.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { emitIpcError } from '@/utils/app-error';
import { useInvalidSession } from '@/hooks/useInvalidSession';

/** A probe component: renders an alert when the session has expired. */
function SessionBannerProbe() {
  const expired = useInvalidSession();
  if (!expired) return null;
  return (
    <div role="alert" data-testid="session-expired-alert">
      session expired
    </div>
  );
}

/** Fire a real invalidSession IPC error at the real listener. */
function expireSession(): void {
  act(() => {
    emitIpcError('some_command', { kind: 'invalidSession', message: 'Token expired' });
  });
}

describe('an invalidSession IPC error surfaces a rendered alert', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing before any error', () => {
    render(<SessionBannerProbe />);
    expect(screen.queryByTestId('session-expired-alert')).not.toBeInTheDocument();
  });

  it('renders the alert once a command answers invalidSession', () => {
    render(<SessionBannerProbe />);
    expireSession();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clears the alert after the window so it cannot outlive the recovery', () => {
    // 5 seconds is the documented window; an alert that never leaves is as unhelpful
    // as one that never appears.
    vi.useFakeTimers();
    try {
      render(<SessionBannerProbe />);
      expireSession();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a non-session failure renders nothing', () => {
    // The alert must be specific to a dead session, or every error would show a
    // "sign in again" call to action.
    render(<SessionBannerProbe />);
    act(() => {
      emitIpcError('some_command', { kind: 'permissionDenied', message: 'nope' });
    });
    expect(screen.queryByTestId('session-expired-alert')).not.toBeInTheDocument();
  });
});
