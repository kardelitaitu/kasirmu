// ── usePosShifts store-switch guard ───────────────────────────────
//
// Pins the guard added in 1aead7518: the deps name sessionToken, so a store
// switch starts a second read while the first is in flight, and a slower earlier
// one must not land last.
//
// WHY THIS HOOK IS THE CHEAP ONE TO TEST: `sessionToken` arrives as a PARAMETER
// rather than through a context mock, and the hook returns `activeShift` and
// `shiftUnavailable` directly. So a store switch is a re-render with a new prop
// and the sink is a readable return value -- no provider stack, no DOM, no
// mutable module-level token.
//
// The consequence is money: `activeShiftRef` GATES A SALE (PosScreen refuses to
// add a product or open a payment when it is null), so both directions are wrong
// -- a stale null refuses a sale that a shift is open for, and a stale shift from
// the previous store leaves the POS believing a shift is open elsewhere.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookInAct } from '@/test-utils/renderInAct';
import { usePosShifts, type UsePosShiftsParams } from '@/features/sales/hooks/usePosShifts';
import { getActiveShiftScoped } from '@/api/shifts';

vi.mock('@/api/shifts', () => ({
  getActiveShiftScoped: vi.fn(),
  openShiftScoped: vi.fn(async () => ({})),
  closeShiftScoped: vi.fn(async () => ({})),
}));

const mockGetActiveShift = getActiveShiftScoped as ReturnType<typeof vi.fn>;

const params: UsePosShiftsParams = {
  sessionToken: 'token-1',
  userId: 'user-1',
  lines: [],
  l10nRef: { current: { getString: (id: string) => id } } as UsePosShiftsParams['l10nRef'],
  currency: 'IDR',
};

describe('usePosShifts — store switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores a slower earlier shift read after the token changes', async () => {
    let releaseStale: (v: unknown) => void = () => {};
    const stalePending = new Promise((resolve) => { releaseStale = resolve; });

    // Read 1 (store A) held open; it will answer LAST with a shift.
    // `mockImplementationOnce` then `mockImplementation` keeps the two arms
    // DISTINCT -- the second read must answer null, or the late write would be
    // indistinguishable from the correct one and the test would pass either way.
    mockGetActiveShift.mockImplementationOnce(() => stalePending);
    mockGetActiveShift.mockImplementation(() => Promise.resolve(null));

    const { result, rerender } = await renderHookInAct(
      (props?: UsePosShiftsParams) => usePosShifts(props as UsePosShiftsParams),
      { initialProps: params },
    );
    await waitFor(() => expect(mockGetActiveShift).toHaveBeenCalledTimes(1));

    // Switch stores. The second read answers null at once and wins.
    await act(async () => {
      rerender({ ...params, sessionToken: 'token-2' } as never);
    });
    await waitFor(() => expect(mockGetActiveShift).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.activeShift).toBeNull());

    // Only NOW does store A's read settle, after store B already won.
    await act(async () => {
      releaseStale({ id: 'shift-from-store-a' });
      await stalePending;
    });

    // The guard held: the stale shift was discarded.
    expect(result.current.activeShift).toBeNull();
  });
});
