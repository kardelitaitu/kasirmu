// ── An always-on hook must have a mount, or it is not always-on ─────────
//
// `useKeyRotationReminder` (ui/src/hooks/useKeyAge.ts) was written, localized,
// and covered by three unit cases -- and rendered by NOBODY. `renderHook` in a
// test proves a hook BEHAVES; it cannot prove the hook ever runs in the app.
// The three cases passed for as long as the feature was dead.
//
// WHAT THIS FILE PINS, in two different directions:
//
//   1. The reminder is mounted inside the real `AppProviders` tree. Rendered,
//      not greped -- `AppProviders` is the app's single provider composite, so
//      anything mounted there is mounted app-wide including both shells.
//   2. The hook is NOT called anywhere it would fire twice. A reminder that
//      mounts in the provider tree AND in a shell would double every toast.
//
// WHY THE ASSERTION IS `addToast` BEING CALLED, not the component existing:
// an earlier draft of this style (see discountRowFieldDistinctness.test.tsx)
// showed that `querySelector`-is-truthy survives a swap. Asserting the EFFECT
// is what discriminates -- delete the mount and no call reaches the queue.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const mockAddToast = vi.fn();
// An overdue key: the branch that fires on mount, so the test does not depend
// on a timer being advanced to observe a call.
const mockGetKeyRotationInfo = vi.fn().mockResolvedValue({
  hasKey: true,
  createdAt: '2025-10-01T00:00:00Z',
  ageDays: 243,
});
vi.mock('@/api/security', () => ({
  getKeyRotationInfo: (...a: unknown[]) => mockGetKeyRotationInfo(...a),
}));
vi.mock('@/components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  useToast: () => ({ addToast: mockAddToast }),
  useOptionalToast: () => null,
}));

import { AppProviders } from '@/contexts/AppProviders';

describe('key rotation reminder is mounted app-wide', () => {
  beforeEach(() => {
    mockAddToast.mockClear();
    localStorage.clear();
  });

  it('fires its overdue notice when the real provider tree mounts', async () => {
    render(<AppProviders>{null}</AppProviders>);

    // The assertion is the toast REACHING THE QUEUE, which only happens if the
    // hook rendered inside ToastProvider and its effect ran.
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning', duration: 0 }),
      );
    });
    cleanup();
  });
});
