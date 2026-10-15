// ── The close-shift guard and outstanding open tabs ─────────────────────────
//
// The guard read `lines.length > 0` and nothing else. On restaurant POS that is NOT
// the empty state: a resumed tab's lines live in the cart only while it is being
// worked on, so "no lines here" is the normal condition for "a customer has an open
// tab on this terminal". A shift closed in that state orphaned the tab with nothing
// on screen to say so — a cash-control failure on the surface whose whole purpose is
// counting cash.
//
// The cases below each guard a different over-correction:
//   1. the tab flag blocks, with its OWN message rather than the cart one;
//   2. the value is read from a ref at CLICK time, because the caller's
//      `activeOpenBillId` is produced by a hook instantiated AFTER this one;
//   3. a genuinely empty store still opens the modal, so the guard did not become
//      "close shift is always disabled".

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookInAct } from '@/test-utils/renderInAct';
import { usePosShifts, type UsePosShiftsParams } from '@/features/sales/hooks/usePosShifts';

vi.mock('@/api/shifts', () => ({
  // Resolves null = "this store has no shift open", which is the quiet-store case the
  // last test needs. Left returning undefined the load's `.then` throws inside the
  // mount effect and every case fails for a setup reason rather than the guard.
  getActiveShiftScoped: vi.fn(async () => null),
  openShiftScoped: vi.fn(async () => ({})),
  closeShiftScoped: vi.fn(async () => ({})),
}));

const base = (): UsePosShiftsParams => ({
  sessionToken: 'tok',
  userId: 'user-1',
  lines: [],
  l10nRef: { current: { getString: (id: string) => id } } as UsePosShiftsParams['l10nRef'],
  currency: 'IDR',
});

describe('usePosShifts — the close-shift guard and outstanding tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to open the close-shift modal while a tab is outstanding', async () => {
    const { result } = await renderHookInAct(() =>
      usePosShifts({ ...base(), hasOpenTab: true }),
    );

    act(() => {
      result.current.handleCloseShiftClick();
    });

    // The named message, not the cart one — "empty the cart" is wrong advice when
    // the cart IS empty, and sends the operator hunting for a problem that does not
    // exist. That distinction is the usability half of the fix.
    expect(result.current.closeShiftError).toBe('pos-close-shift-open-tab-error');
    // And the modal itself must not appear, so the operator cannot confirm past it.
    expect(result.current.closeShiftExit.shouldRender).toBe(false);
  });

  it('reads the tab flag from a ref at click time, because the value is not known at configure time', async () => {
    // The real caller's shape: `activeOpenBillId` is produced by a hook instantiated
    // AFTER this one, so it cannot be an argument. The guard must still see the
    // CURRENT value, not the one present at first render — a tab resumed between the
    // mount and the click must still block the close.
    const hasOpenTabRef = { current: false };
    const { result } = await renderHookInAct(() =>
      usePosShifts({ ...base(), hasOpenTabRef }),
    );

    // Clean at first: nothing outstanding, the modal opens normally.
    act(() => {
      result.current.handleCloseShiftClick();
    });
    expect(result.current.closeShiftError).toBeNull();

    // A tab is resumed, then Close is pressed again — the guard must notice.
    act(() => {
      hasOpenTabRef.current = true;
      result.current.handleCloseShiftClick();
    });
    expect(result.current.closeShiftError).toBe('pos-close-shift-open-tab-error');
  });

  it('still blocks on a non-empty cart, with the cart message that case needs', async () => {
    // The original guard must survive. Both conditions are checked, and each has
    // its own actionable message.
    const line = { id: 'l-1' } as never;
    const { result } = await renderHookInAct(() =>
      usePosShifts({ ...base(), lines: [line] }),
    );

    act(() => {
      result.current.handleCloseShiftClick();
    });
    expect(result.current.closeShiftError).toBe('pos-close-shift-cart-error');
  });

  it('opens the modal when the cart is empty AND no tab is outstanding', async () => {
    // The regression case for over-correcting. A guard added too broadly blocks the
    // close flow entirely, which is the same class of defect as the one above: an
    // operator unable to close a quiet shift stands at the till guessing why.
    const { result } = await renderHookInAct(() => usePosShifts(base()));
    await waitFor(() => expect(result.current.shiftLoading).toBe(false));

    act(() => {
      result.current.handleCloseShiftClick();
    });
    expect(result.current.closeShiftError).toBeNull();
    expect(result.current.closeShiftExit.shouldRender).toBe(true);
  });
});
